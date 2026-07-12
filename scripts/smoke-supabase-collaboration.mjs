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

const runId = Date.now();
const password = `Taskel-collaboration-${runId}!`;
const actors = [];
const storagePaths = [];
let projectId;
let memberProjectId;

function createUserClient() {
    return createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

function assertNoError(error, step) {
    if (error) {
        throw new Error(`${step}: ${error.message}`);
    }
}

function assertRejected(error, data, step) {
    if (!error && (!Array.isArray(data) || data.length > 0)) {
        throw new Error(`${step}: operation unexpectedly succeeded`);
    }
}

async function createActor(name) {
    const email = `taskel-${name}-${runId}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    assertNoError(error, `create ${name} auth user`);

    const client = createUserClient();
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    assertNoError(signInError, `sign in ${name}`);

    const actor = { client, email, id: data.user.id, name };
    actors.push(actor);
    return actor;
}

try {
    const owner = await createActor('owner');
    const projectAdmin = await createActor('admin');
    const member = await createActor('member');
    const viewer = await createActor('viewer');
    const outsider = await createActor('outsider');

    const { data: ownerSection, error: ownerSectionError } = await owner.client
        .from('sections')
        .insert({ user_id: owner.id, name: `Owner ${runId}`, order: 0 })
        .select('id')
        .single();
    assertNoError(ownerSectionError, 'create owner section');

    const { data: outsiderSection, error: outsiderSectionError } = await outsider.client
        .from('sections')
        .insert({ user_id: outsider.id, name: `Outsider ${runId}`, order: 0 })
        .select('id')
        .single();
    assertNoError(outsiderSectionError, 'create outsider section');

    projectId = crypto.randomUUID();
    const { error: projectError } = await owner.client.from('projects').insert({
        id: projectId,
        owner_id: owner.id,
        title: `Collaboration ${runId}`,
        description: '',
        status: 'active',
    });
    assertNoError(projectError, 'create project');

    const { error: ownerMembershipError } = await owner.client.from('project_members').insert({
        project_id: projectId,
        user_id: owner.id,
        role: 'owner',
    });
    assertNoError(ownerMembershipError, 'create owner membership');

    const { error: membershipError } = await admin.from('project_members').insert([
        { project_id: projectId, user_id: projectAdmin.id, role: 'admin' },
        { project_id: projectId, user_id: member.id, role: 'member' },
        { project_id: projectId, user_id: viewer.id, role: 'viewer' },
    ]);
    assertNoError(membershipError, 'create collaboration memberships');

    const memberOwnerEscalationAttempt = await projectAdmin.client
        .from('project_members')
        .update({ role: 'owner' })
        .eq('project_id', projectId)
        .eq('user_id', member.id)
        .select('user_id');
    assertRejected(
        memberOwnerEscalationAttempt.error,
        memberOwnerEscalationAttempt.data,
        'admin grants a second owner role'
    );

    const canonicalOwnerDemotionAttempt = await projectAdmin.client
        .from('project_members')
        .update({ role: 'member' })
        .eq('project_id', projectId)
        .eq('user_id', owner.id)
        .select('user_id');
    assertRejected(
        canonicalOwnerDemotionAttempt.error,
        canonicalOwnerDemotionAttempt.data,
        'admin demotes the canonical owner'
    );

    const canonicalOwnerDeletionAttempt = await projectAdmin.client
        .from('project_members')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', owner.id)
        .select('user_id');
    assertRejected(
        canonicalOwnerDeletionAttempt.error,
        canonicalOwnerDeletionAttempt.data,
        'admin deletes the canonical owner membership'
    );

    memberProjectId = crypto.randomUUID();
    const { error: memberProjectError } = await member.client.from('projects').insert({
        id: memberProjectId,
        owner_id: member.id,
        title: `Member project ${runId}`,
        description: '',
        status: 'active',
    });
    assertNoError(memberProjectError, 'member creates a second project');

    const { error: memberOwnerMembershipError } = await member.client
        .from('project_members')
        .insert({
            project_id: memberProjectId,
            user_id: member.id,
            role: 'owner',
        });
    assertNoError(memberOwnerMembershipError, 'member creates canonical owner membership');

    const taskId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const { error: taskError } = await owner.client.from('tasks').insert({
        id: taskId,
        user_id: owner.id,
        title: `Shared task ${runId}`,
        section_id: ownerSection.id,
        project_id: projectId,
        date: today,
        status: 'open',
        order: 0,
    });
    assertNoError(taskError, 'create shared task');

    const taskOwnershipAttempt = await member.client
        .from('tasks')
        .update({ user_id: member.id, project_id: null })
        .eq('id', taskId)
        .select('id');
    assertRejected(taskOwnershipAttempt.error, taskOwnershipAttempt.data, 'member takes task ownership');

    const { data: viewerTask, error: viewerReadError } = await viewer.client
        .from('tasks')
        .select('id')
        .eq('id', taskId)
        .single();
    assertNoError(viewerReadError, 'viewer reads shared task');
    if (viewerTask.id !== taskId) {
        throw new Error('viewer read returned the wrong task');
    }

    const { data: adminProjectUpdate, error: adminProjectError } = await projectAdmin.client
        .from('projects')
        .update({ description: 'Updated by admin' })
        .eq('id', projectId)
        .select('id');
    assertNoError(adminProjectError, 'admin updates project metadata');
    if (adminProjectUpdate.length !== 1) {
        throw new Error('admin project update affected no rows');
    }

    const memberProjectAttempt = await member.client
        .from('projects')
        .update({ description: 'Member must not update this' })
        .eq('id', projectId)
        .select('id');
    assertRejected(memberProjectAttempt.error, memberProjectAttempt.data, 'member project update');

    const viewerProjectAttempt = await viewer.client
        .from('projects')
        .update({ description: 'Viewer must not update this' })
        .eq('id', projectId)
        .select('id');
    assertRejected(viewerProjectAttempt.error, viewerProjectAttempt.data, 'viewer project update');

    const ownerTakeoverAttempt = await projectAdmin.client
        .from('projects')
        .update({ owner_id: projectAdmin.id })
        .eq('id', projectId)
        .select('id');
    assertRejected(ownerTakeoverAttempt.error, ownerTakeoverAttempt.data, 'project owner takeover');

    const { data: memberTaskUpdate, error: memberTaskError } = await member.client
        .from('tasks')
        .update({ title: `Member edit ${runId}` })
        .eq('id', taskId)
        .select('id');
    assertNoError(memberTaskError, 'member updates task');
    if (memberTaskUpdate.length !== 1) {
        throw new Error('member task update affected no rows');
    }

    const viewerTaskAttempt = await viewer.client
        .from('tasks')
        .update({ title: 'Viewer must not edit this' })
        .eq('id', taskId)
        .select('id');
    assertRejected(viewerTaskAttempt.error, viewerTaskAttempt.data, 'viewer task update');

    const outsiderInjectionAttempt = await outsider.client.from('tasks').insert({
        id: crypto.randomUUID(),
        user_id: outsider.id,
        title: 'Outsider injection',
        section_id: outsiderSection.id,
        project_id: projectId,
        date: today,
        status: 'open',
        order: 0,
    });
    assertRejected(outsiderInjectionAttempt.error, outsiderInjectionAttempt.data, 'outsider task injection');

    const { error: memberCommentError } = await member.client.from('task_comments').insert({
        task_id: taskId,
        user_id: member.id,
        author_type: 'user',
        content: 'Member comment',
    });
    assertNoError(memberCommentError, 'member creates comment');

    const viewerCommentAttempt = await viewer.client.from('task_comments').insert({
        task_id: taskId,
        user_id: viewer.id,
        author_type: 'user',
        content: 'Viewer comment',
    });
    assertRejected(viewerCommentAttempt.error, viewerCommentAttempt.data, 'viewer creates comment');

    const storagePath = `users/${owner.id}/attachments/collaboration-${runId}.txt`;
    storagePaths.push(storagePath);
    const { error: uploadError } = await owner.client.storage
        .from('attachments')
        .upload(storagePath, new TextEncoder().encode('shared attachment'), {
            contentType: 'text/plain',
            upsert: false,
        });
    assertNoError(uploadError, 'owner uploads shared attachment');

    const attachmentId = crypto.randomUUID();
    const { error: attachmentError } = await owner.client.from('attachments').insert({
        id: attachmentId,
        task_id: taskId,
        url: storagePath,
        storage_path: storagePath,
        name: 'collaboration.txt',
        file_type: 'file',
        size: 17,
    });
    assertNoError(attachmentError, 'owner creates attachment metadata');

    const outsiderStoragePath = `users/${outsider.id}/attachments/private-${runId}.txt`;
    storagePaths.push(outsiderStoragePath);
    const { error: outsiderUploadError } = await outsider.client.storage
        .from('attachments')
        .upload(outsiderStoragePath, new TextEncoder().encode('outsider private attachment'), {
            contentType: 'text/plain',
            upsert: false,
        });
    assertNoError(outsiderUploadError, 'outsider uploads an unlinked private attachment');

    const stolenPathAttempt = await member.client.from('attachments').insert({
        id: crypto.randomUUID(),
        task_id: taskId,
        uploader_id: member.id,
        url: outsiderStoragePath,
        storage_path: outsiderStoragePath,
        name: 'stolen.txt',
        file_type: 'file',
        size: 27,
    });
    assertRejected(
        stolenPathAttempt.error,
        stolenPathAttempt.data,
        'member links another uploader storage path'
    );

    const outsiderSignedUrlAttempt = await member.client.storage
        .from('attachments')
        .createSignedUrl(outsiderStoragePath, 60);
    if (!outsiderSignedUrlAttempt.error || outsiderSignedUrlAttempt.data) {
        throw new Error('member unexpectedly signed an unlinked outsider attachment');
    }

    const attachmentMutationAttempt = await member.client
        .from('attachments')
        .update({ storage_path: `users/${member.id}/attachments/rebound.txt` })
        .eq('id', attachmentId)
        .select('id');
    assertRejected(
        attachmentMutationAttempt.error,
        attachmentMutationAttempt.data,
        'member mutates immutable attachment metadata'
    );

    const memberStoragePath = `users/${member.id}/attachments/member-${runId}.txt`;
    storagePaths.push(memberStoragePath);
    const { error: memberUploadError } = await member.client.storage
        .from('attachments')
        .upload(memberStoragePath, new TextEncoder().encode('member attachment'), {
            contentType: 'text/plain',
            upsert: false,
        });
    assertNoError(memberUploadError, 'member uploads own shared attachment');

    const { error: memberAttachmentError } = await member.client.from('attachments').insert({
        id: crypto.randomUUID(),
        task_id: taskId,
        url: memberStoragePath,
        storage_path: memberStoragePath,
        name: 'member.txt',
        file_type: 'file',
        size: 17,
    });
    assertNoError(memberAttachmentError, 'member creates metadata for own shared attachment');

    const foreignAttachmentScopeMoveAttempt = await member.client
        .from('tasks')
        .update({ project_id: memberProjectId })
        .eq('id', taskId)
        .select('id');
    assertRejected(
        foreignAttachmentScopeMoveAttempt.error,
        foreignAttachmentScopeMoveAttempt.data,
        'member moves a task containing another uploader attachment'
    );

    const { data: viewerSignedUrl, error: viewerSignedUrlError } = await viewer.client.storage
        .from('attachments')
        .createSignedUrl(storagePath, 60);
    assertNoError(viewerSignedUrlError, 'viewer creates signed URL for shared attachment');
    const sharedResponse = await fetch(viewerSignedUrl.signedUrl);
    if (!sharedResponse.ok || (await sharedResponse.text()) !== 'shared attachment') {
        throw new Error('viewer signed URL did not return the shared attachment');
    }

    const { data: invitation, error: invitationError } = await owner.client
        .from('invitations')
        .insert({
            project_id: projectId,
            email: outsider.email,
            role: 'member',
            inviter_id: owner.id,
            status: 'pending',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            is_reusable: false,
        })
        .select('id')
        .single();
    assertNoError(invitationError, 'owner creates invitation');

    const invitationTamperAttempt = await outsider.client
        .from('invitations')
        .update({ role: 'admin', is_reusable: true })
        .eq('id', invitation.id)
        .select('id');
    assertRejected(
        invitationTamperAttempt.error,
        invitationTamperAttempt.data,
        'invitee tampers with invitation'
    );

    const { data: acceptedProjectId, error: acceptError } = await outsider.client.rpc('accept_invitation', {
        invite_token: invitation.id,
    });
    assertNoError(acceptError, 'invitee accepts invitation');
    if (acceptedProjectId !== projectId) {
        throw new Error('invitation returned the wrong project');
    }

    const { data: acceptedMembership, error: acceptedMembershipError } = await admin
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', outsider.id)
        .single();
    assertNoError(acceptedMembershipError, 'read accepted membership');
    if (acceptedMembership.role !== 'member') {
        throw new Error(`invitation granted unexpected role: ${acceptedMembership.role}`);
    }

    const ownerInvitationAttempt = await owner.client.from('invitations').insert({
        project_id: projectId,
        email: `co-owner-${runId}@example.com`,
        role: 'owner',
        inviter_id: owner.id,
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        is_reusable: false,
    });
    assertRejected(ownerInvitationAttempt.error, ownerInvitationAttempt.data, 'owner-role invitation');

    const rateLimitResults = await Promise.all(
        Array.from({ length: 11 }, () => owner.client.rpc('consume_invitation_send_attempt'))
    );
    for (const [index, result] of rateLimitResults.entries()) {
        assertNoError(result.error, `consume invitation rate limit ${index + 1}`);
    }
    const allowedAttempts = rateLimitResults.filter((result) => result.data === true).length;
    if (allowedAttempts !== 10) {
        throw new Error(`invitation limiter allowed ${allowedAttempts} attempts instead of 10`);
    }

    console.log(
        'Supabase collaboration smoke test passed: role RLS, invitation integrity, and attachment ownership.'
    );
} finally {
    if (storagePaths.length > 0) {
        const { error } = await admin.storage.from('attachments').remove(storagePaths);
        if (error) {
            console.error(`Storage cleanup failed: ${error.message}`);
        }
    }

    if (actors.length > 0) {
        const { error } = await admin
            .from('tasks')
            .delete()
            .in('user_id', actors.map((actor) => actor.id));
        if (error) {
            console.error(`Task cleanup failed: ${error.message}`);
        }
    }

    if (projectId) {
        const { error } = await admin.from('projects').delete().eq('id', projectId);
        if (error) {
            console.error(`Project cleanup failed: ${error.message}`);
        }
    }

    if (memberProjectId) {
        const { error } = await admin.from('projects').delete().eq('id', memberProjectId);
        if (error) {
            console.error(`Member project cleanup failed: ${error.message}`);
        }
    }

    for (const actor of actors.reverse()) {
        const { error } = await admin.auth.admin.deleteUser(actor.id);
        if (error) {
            console.error(`${actor.name} cleanup failed: ${error.message}`);
        }
        actor.client.realtime.disconnect();
    }
    admin.realtime.disconnect();
}
