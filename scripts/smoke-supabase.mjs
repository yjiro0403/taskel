import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
}

const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});
const userClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const runId = Date.now();
const email = `taskel-smoke-${runId}@example.com`;
const password = `Taskel-smoke-${runId}!`;
let userId;
let channel;
let storagePath;

function assertNoError(error, step) {
    if (error) {
        throw new Error(`${step}: ${error.message}`);
    }
}

function waitForRealtimeSubscription(realtimeChannel) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 15_000);
        realtimeChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                clearTimeout(timer);
                resolve();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                clearTimeout(timer);
                reject(new Error(`Realtime subscription failed: ${status}`));
            }
        });
    });
}

try {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    assertNoError(createUserError, 'create auth user');
    userId = createdUser.user.id;

    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('id,email')
        .eq('id', userId)
        .single();
    assertNoError(profileError, 'profile trigger');
    if (profile.email !== email) {
        throw new Error('profile trigger created an unexpected email');
    }

    const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    assertNoError(signInError, 'sign in');

    const { data: section, error: sectionError } = await userClient
        .from('sections')
        .insert({ user_id: userId, name: `Smoke ${runId}`, order: 0 })
        .select('id')
        .single();
    assertNoError(sectionError, 'insert section through RLS');

    const realtimeTaskId = crypto.randomUUID();
    const realtimeEvent = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Realtime INSERT event timed out')), 15_000);
        channel = userClient
            .channel(`taskel-smoke-${runId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'tasks',
                    filter: `user_id=eq.${userId}`,
                },
                (payload) => {
                    if (payload.new.id === realtimeTaskId) {
                        clearTimeout(timer);
                        resolve(payload);
                    }
                }
            );
    });
    await waitForRealtimeSubscription(channel);
    // A freshly started local Realtime tenant reports SUBSCRIBED before its CDC replication
    // connection has finished warming up. Give that connection a short readiness window.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const today = new Date().toISOString().slice(0, 10);
    const { data: task, error: taskError } = await userClient
        .from('tasks')
        .insert({
            id: realtimeTaskId,
            user_id: userId,
            title: `Smoke task ${runId}`,
            section_id: section.id,
            date: today,
            assigned_date: today,
            status: 'open',
            order: 0,
        })
        .select('id,title')
        .single();
    assertNoError(taskError, 'insert task through RLS');
    await realtimeEvent;

    const { data: fetchedTask, error: fetchTaskError } = await userClient
        .from('tasks')
        .select('id,title')
        .eq('id', task.id)
        .single();
    assertNoError(fetchTaskError, 'read task through RLS');
    if (fetchedTask.title !== task.title) {
        throw new Error('task round-trip returned unexpected data');
    }

    storagePath = `users/${userId}/attachments/smoke-${runId}.txt`;
    const { error: uploadError } = await userClient.storage
        .from('attachments')
        .upload(storagePath, new TextEncoder().encode('taskel smoke test'), {
            contentType: 'text/plain',
            upsert: false,
        });
    assertNoError(uploadError, 'upload attachment through Storage RLS');

    const { data: signedUrl, error: signedUrlError } = await userClient.storage
        .from('attachments')
        .createSignedUrl(storagePath, 60);
    assertNoError(signedUrlError, 'create private attachment signed URL');
    const response = await fetch(signedUrl.signedUrl);
    if (!response.ok || (await response.text()) !== 'taskel smoke test') {
        throw new Error('signed attachment URL did not return the uploaded content');
    }

    console.log('Supabase smoke test passed: Auth, profile trigger, RLS CRUD, Realtime, and Storage.');
} finally {
    if (channel) {
        await userClient.removeChannel(channel);
    }
    if (storagePath) {
        await userClient.storage.from('attachments').remove([storagePath]);
    }
    if (userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) {
            console.error(`Smoke-test cleanup failed: ${error.message}`);
        }
    }
    userClient.realtime.disconnect();
    admin.realtime.disconnect();
}
