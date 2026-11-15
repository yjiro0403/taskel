import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import {
    addDays,
    assertLoopbackUrl,
    deleteFixtureUsers,
    generateToken,
    issueToken,
    seedFixture,
} from './mcp-e2e-seed.mjs';

/**
 * HTTP smoke test for the local MCP endpoint. Seeds its own fixture and
 * deletes those users afterwards. Refuses any URL that is not loopback.
 */

const BODY_BYTES = 70000;
const TIMEZONE = 'Asia/Tokyo';
const A_TITLES = ['請求書を送る', '消したルーチン', '歯医者の予約', 'SHARED-MARKER 共有タスク', '日報'];
const IPS = {
    r7: '10.99.0.1',
    r9: '10.99.0.2',
    r10: '10.99.0.3',
    r10b: '10.99.0.15',
    r11: '10.99.0.4',
    r12: '10.99.0.5',
    r13: '10.99.0.6',
    r14: '10.99.0.7',
    r17: '10.99.0.8',
    r19: '10.99.0.9',
    s1: '10.99.0.10',
    s2: '10.99.0.11',
    s3: '10.99.0.12',
    r15: '10.99.0.13',
    r16: '10.99.0.14',
};

let mcpEndpoint = '';

function expect(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function safeReason(error) {
    const message = error instanceof Error ? error.message : 'failed';
    return message.replace(/tsk_mcp_[A-Za-z0-9_-]*/g, '[redacted]').replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]');
}

function isNotFound(error) {
    if (!error) {
        return false;
    }
    if (error.status === 404 || error.code === 'user_not_found') {
        return true;
    }
    return typeof error.message === 'string' && /not found/i.test(error.message);
}

function isMissingMigration(error) {
    return error?.code === 'PGRST202' || error?.code === '42883';
}

function readSupabaseConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const missing = [];
    if (!url) {
        missing.push('NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!anonKey) {
        missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    if (!serviceRoleKey) {
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    if (missing.length > 0) {
        for (const name of missing) {
            console.error(`Missing ${name}`);
        }
        process.exit(2);
    }
    assertLoopbackUrl(url, 'Supabase URL');
    return { url, anonKey, serviceRoleKey };
}

function jsonOfByteLength(size) {
    const prefix = '{"pad":"';
    const suffix = '"}';
    const fillerLength = size - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
    if (fillerLength < 0) {
        throw new Error('body size is too small');
    }
    return `${prefix}${'a'.repeat(fillerLength)}${suffix}`;
}

function idempotencyKey() {
    const key = randomBytes(32).toString('base64url');
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
        throw new Error('idempotency key has an unexpected shape');
    }
    return key;
}

async function readJson(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function call(token, name, args, { ip }) {
    const response = await fetch(mcpEndpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'x-forwarded-for': ip,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    });
    const json = await readJson(response);
    return { status: response.status, headers: response.headers, json };
}

async function postBody(token, body, { ip, asStream }) {
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-forwarded-for': ip,
    };
    const init = {
        method: 'POST',
        redirect: 'manual',
        headers,
    };
    if (asStream) {
        const bytes = Buffer.from(body);
        init.body = new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            },
        });
        init.duplex = 'half';
    } else {
        init.body = body;
    }
    const response = await fetch(mcpEndpoint, init);
    const json = await readJson(response);
    return { status: response.status, headers: response.headers, json };
}

function httpCode(response) {
    return response.json?.error?.data?.code ?? 'none';
}

function toolCode(response) {
    return response.json?.result?.structuredContent?.error?.code ?? 'none';
}

function toolData(response) {
    const structured = response.json?.result?.structuredContent;
    if (response.status !== 200 || !structured || structured.ok !== true) {
        throw new Error(`tool failed (${response.status} ${structured?.ok === false ? toolCode(response) : httpCode(response)})`);
    }
    return structured.data;
}

function assertToolError(response, code) {
    expect(response.status === 200, `status ${response.status}`);
    expect(response.json?.result?.isError === true, 'not isError');
    expect(toolCode(response) === code, `code ${toolCode(response)}`);
}

async function exactCount(query) {
    const { count, error } = await query;
    if (error) {
        throw new Error(`count failed (${error.code ?? 'error'})`);
    }
    expect(typeof count === 'number', 'count missing');
    return count;
}

async function createConfirmedUser(admin, email) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
        throw new Error(`list users: ${error.message}`);
    }
    const existing = (data?.users ?? []).find((user) => user.email === email);
    if (existing) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
        if (deleteError && !isNotFound(deleteError)) {
            throw new Error(`delete user: ${deleteError.message}`);
        }
    }
    const password = `${randomBytes(18).toString('base64url')}aA1!`;
    const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (created.error || !created.data?.user?.id) {
        throw new Error(`create user: ${created.error?.message ?? 'no user'}`);
    }
    return { id: created.data.user.id, email, password };
}

async function issueNamed(admin, userId, name, scopes) {
    const issued = await issueToken(admin, {
        userId,
        name,
        scopes,
        days: 90,
        timezone: TIMEZONE,
    });
    if (!issued.result?.ok || !issued.result.token?.id) {
        throw new Error(`issue token failed (${issued.result?.code ?? 'none'})`);
    }
    return {
        id: issued.result.token.id,
        token: issued.token,
        prefix: issued.prefix,
        hash: issued.hash,
    };
}

function userClient(url, anonKey) {
    return createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

async function signIn(client, email, password, label) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        throw new Error(`sign in ${label} failed (${error.status ?? error.code ?? 'error'})`);
    }
}

function assertDenied(result, step) {
    expect(result?.error?.code === '42501', `${step} code ${result?.error?.code ?? 'none'}`);
}

/**
 * Only 42501 (permission denied) proves the execute revoke. PGRST202 or 42883
 * (function not found) means the migration is missing, which must fail the
 * check rather than pass it, so the caller first confirms the function exists.
 */
function assertFunctionDenied(result, step) {
    const code = result?.error?.code ?? 'none';
    expect(!isMissingMigration(result?.error), `${step} is missing (migration not applied)`);
    expect(code === '42501', `${step} code ${code}`);
    expect(result?.data == null, `${step} returned data`);
}

/**
 * Calls the function as service_role with arguments it refuses or that touch
 * no row (an unknown user or hash), so the call writes nothing.
 */
async function assertFunctionExists(admin, name, args) {
    const result = await admin.rpc(name, args);
    expect(!isMissingMigration(result.error), `${name} is missing (migration not applied)`);
}

function titlesOf(data) {
    return (data?.tasks ?? []).map((task) => task.title);
}

function assertNoPrivateFields(payload, label) {
    const text = JSON.stringify(payload);
    for (const needle of ['MEMO-MARKER', '"memo"', '"checklist"', '"tags"', '"project_id"']) {
        expect(!text.includes(needle), `${label} contained ${needle}`);
    }
}

async function activeTokenCount(admin, userId) {
    return exactCount(
        admin.from('mcp_tokens').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('revoked_at', null)
    );
}

async function taskCount(admin, userId) {
    return exactCount(admin.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId));
}

async function waitForRateWindow() {
    const seconds = new Date().getSeconds();
    if (seconds <= 40) {
        return;
    }
    const target = Date.now() + (60 - seconds) * 1000 + 50;
    console.log('Waiting until the next minute before the rate-limit check.');
    while (Date.now() < target) {
        const remaining = target - Date.now();
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
    }
}

function disconnect(client) {
    if (client?.realtime && typeof client.realtime.disconnect === 'function') {
        client.realtime.disconnect();
    }
}

async function main() {
    const { url, anonKey, serviceRoleKey } = readSupabaseConfig();
    mcpEndpoint = process.env.TASKEL_MCP_URL ?? 'http://127.0.0.1:3210/api/mcp';
    assertLoopbackUrl(mcpEndpoint, 'MCP URL');

    const tag = `smoke-${Date.now().toString(36)}`;
    if (!/^[a-z0-9-]{1,20}$/.test(tag)) {
        throw new Error('smoke tag has an unexpected shape');
    }

    const results = [];
    const userIds = [];
    const clients = [];
    let setupFailed = false;
    let cleanupFailed = false;

    async function check(id, title, fn) {
        try {
            await fn();
            console.log(`ok   ${id} ${title}`);
            results.push({ id, title, ok: true });
        } catch (error) {
            console.log(`FAIL ${id} ${title}: ${safeReason(error)}`);
            results.push({ id, title, ok: false });
        }
    }

    const admin = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    clients.push(admin);

    try {
        const fx = await seedFixture(admin, { tag, timezone: TIMEZONE });
        userIds.push(fx.userA.id, fx.userB.id);
        const userC = await createConfirmedUser(admin, `mcp-e2e-${tag}-c@example.test`);
        userIds.push(userC.id);

        const aRw = await issueNamed(admin, fx.userA.id, 'A rw', ['tasks:read', 'tasks:create']);
        const aRo = await issueNamed(admin, fx.userA.id, 'A ro', ['tasks:read']);
        const aCap = await issueNamed(admin, fx.userA.id, 'A cap', ['tasks:read', 'tasks:create']);
        const aRate = await issueNamed(admin, fx.userA.id, 'A rate', ['tasks:read']);
        const aRev = await issueNamed(admin, fx.userA.id, 'A rev', ['tasks:read']);
        const bRw = await issueNamed(admin, fx.userB.id, 'B rw', ['tasks:read', 'tasks:create']);

        const signedA = userClient(url, anonKey);
        const signedB = userClient(url, anonKey);
        const anon = userClient(url, anonKey);
        clients.push(signedA, signedB, anon);
        await signIn(signedA, fx.userA.email, fx.userA.password, 'A');
        await signIn(signedB, fx.userB.email, fx.userB.password, 'B');

        const deniedToken = generateToken();
        const deniedId = '00000000-0000-4000-8000-000000000001';

        await check('R1', 'no table privilege for a signed-in user', async () => {
            const tables = [
                {
                    name: 'mcp_tokens',
                    row: {
                        user_id: fx.userA.id,
                        name: 'denied',
                        token_prefix: deniedToken.prefix,
                        token_hash: deniedToken.hash,
                        scopes: ['tasks:read'],
                        timezone: TIMEZONE,
                        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                    },
                    patch: { name: 'no' },
                    column: 'id',
                    value: deniedId,
                },
                {
                    name: 'mcp_audit_logs',
                    row: { event: 'denied', ok: false, arg_keys: [] },
                    patch: { ok: false },
                    column: 'id',
                    value: 0,
                },
                {
                    name: 'mcp_rate_windows',
                    row: { token_id: aRw.id, window_start: new Date().toISOString(), count: 1 },
                    patch: { count: 1 },
                    column: 'token_id',
                    value: deniedId,
                },
                {
                    name: 'mcp_task_creations',
                    row: {
                        token_id: aRw.id,
                        idempotency_key: 'denied-key-00000001',
                        request_hash: 'ab'.repeat(32),
                    },
                    patch: { request_hash: 'cd'.repeat(32) },
                    column: 'token_id',
                    value: deniedId,
                },
            ];

            for (const table of tables) {
                assertDenied(await signedA.from(table.name).select('*').limit(1), `${table.name} select`);
                assertDenied(await signedA.from(table.name).insert(table.row), `${table.name} insert`);
                assertDenied(
                    await signedA.from(table.name).update(table.patch).eq(table.column, table.value),
                    `${table.name} update`
                );
                assertDenied(
                    await signedA.from(table.name).delete().eq(table.column, table.value),
                    `${table.name} delete`
                );
                assertDenied(await anon.from(table.name).select('*').limit(1), `${table.name} anon select`);
            }
        });

        await check('R2', 'mcp functions are service-role only', async () => {
            const forged = generateToken();
            const nobody = randomUUID();
            await assertFunctionExists(admin, 'mcp_issue_token', {
                p_user_id: nobody,
                p_name: 'exists',
                p_token_hash: forged.hash,
                p_token_prefix: forged.prefix,
                p_scopes: ['tasks:read'],
                p_expires_days: 0,
                p_timezone: TIMEZONE,
            });
            await assertFunctionExists(admin, 'mcp_day_snapshot', {
                p_user_id: nobody,
                p_token_id: randomUUID(),
                p_request_id: 'smoke',
                p_arg_keys: [],
                p_date: fx.today,
            });
            await assertFunctionExists(admin, 'mcp_authenticate', { p_token_hash: forged.hash });
            assertFunctionDenied(
                await signedA.rpc('mcp_issue_token', {
                    p_user_id: fx.userA.id,
                    p_name: 'denied',
                    p_token_hash: forged.hash,
                    p_token_prefix: forged.prefix,
                    p_scopes: ['tasks:read'],
                    p_expires_days: 30,
                    p_timezone: TIMEZONE,
                }),
                'mcp_issue_token'
            );
            assertFunctionDenied(
                await signedA.rpc('mcp_day_snapshot', {
                    p_user_id: fx.userA.id,
                    p_token_id: aRw.id,
                    p_request_id: 'smoke',
                    p_arg_keys: [],
                    p_date: fx.today,
                }),
                'mcp_day_snapshot'
            );
            assertFunctionDenied(await anon.rpc('mcp_authenticate', { p_token_hash: aRw.hash }), 'mcp_authenticate');
            const rows = await exactCount(
                admin.from('mcp_tokens').select('id', { count: 'exact', head: true }).eq('user_id', fx.userA.id)
            );
            expect(rows === 5, `token rows ${rows}`);
        });

        await check('R6', 'expiry and creation time are server-set', async () => {
            const tooLong = await issueToken(admin, {
                userId: userC.id,
                name: 'too long',
                scopes: ['tasks:read'],
                days: 366,
                timezone: TIMEZONE,
            });
            expect(
                tooLong.result?.ok === false && tooLong.result?.code === 'INVALID_INPUT',
                `366 code ${tooLong.result?.code ?? 'none'}`
            );
            const zero = await issueToken(admin, {
                userId: userC.id,
                name: 'zero',
                scopes: ['tasks:read'],
                days: 0,
                timezone: TIMEZONE,
            });
            expect(zero.result?.ok === false && zero.result?.code === 'INVALID_INPUT', `0 code ${zero.result?.code ?? 'none'}`);

            for (const extraName of ['p_created_at', 'p_expires_at']) {
                const forged = generateToken();
                const extra = await admin.rpc('mcp_issue_token', {
                    p_user_id: userC.id,
                    p_name: 'extra',
                    p_token_hash: forged.hash,
                    p_token_prefix: forged.prefix,
                    p_scopes: ['tasks:read'],
                    p_expires_days: 30,
                    p_timezone: TIMEZONE,
                    [extraName]: '2020-01-01T00:00:00Z',
                });
                if (extra.data?.token?.id) {
                    await admin.rpc('mcp_revoke_token', {
                        p_user_id: userC.id,
                        p_token_id: extra.data.token.id,
                        p_via: 'ui',
                    });
                }
                expect(extra.error, `${extraName} was accepted`);
            }

            const issued = await issueToken(admin, {
                userId: userC.id,
                name: 'thirty',
                scopes: ['tasks:read'],
                days: 30,
                timezone: TIMEZONE,
            });
            expect(issued.result?.ok === true, `30 code ${issued.result?.code ?? 'none'}`);
            const tokenId = issued.result.token.id;
            const row = await admin.from('mcp_tokens').select('created_at, expires_at').eq('id', tokenId).single();
            expect(!row.error, `read token code ${row.error?.code ?? 'none'}`);
            const createdAt = Date.parse(row.data.created_at);
            const expiresAt = Date.parse(row.data.expires_at);
            expect(Math.abs(createdAt - Date.now()) <= 2 * 60 * 1000, 'created_at is outside 2 minutes');
            const thirtyDays = 30 * 24 * 60 * 60 * 1000;
            expect(Math.abs(expiresAt - createdAt - thirtyDays) <= 1000, 'expiry is not 30 days');
            const revoked = await admin.rpc('mcp_revoke_token', {
                p_user_id: userC.id,
                p_token_id: tokenId,
                p_via: 'ui',
            });
            expect(
                revoked.error == null && revoked.data?.ok === true,
                `revoke code ${revoked.data?.code ?? revoked.error?.code ?? 'none'}`
            );
            const active = await activeTokenCount(admin, userC.id);
            expect(active === 0, `active after revoke ${active}`);
        });

        await check('R7', 'revocation is one-way and immediate', async () => {
            const who = await call(aRev.token, 'taskel_whoami', {}, { ip: IPS.r7 });
            expect(who.status === 200, `whoami status ${who.status}`);
            expect(who.json?.result?.structuredContent?.ok === true, 'whoami not ok');

            const revoked = await call(aRev.token, 'taskel_revoke_current_token', {}, { ip: IPS.r7 });
            const revokedData = toolData(revoked);
            expect(revokedData.revoked === true, 'revoked was not true');

            const again = await call(aRev.token, 'taskel_whoami', {}, { ip: IPS.r7 });
            expect(again.status === 401, `after status ${again.status}`);
            expect(httpCode(again) === 'MCP_TOKEN_REVOKED', `after code ${httpCode(again)}`);

            const before = await admin.from('mcp_tokens').select('revoked_at, revoked_via').eq('id', aRev.id).single();
            expect(!before.error, `read revoked code ${before.error?.code ?? 'none'}`);
            const second = await admin.rpc('mcp_revoke_token', {
                p_user_id: fx.userA.id,
                p_token_id: aRev.id,
                p_via: 'ui',
            });
            expect(
                second.error == null && second.data?.code === 'ALREADY_REVOKED',
                `second code ${second.data?.code ?? second.error?.code ?? 'none'}`
            );
            const after = await admin.from('mcp_tokens').select('revoked_at, revoked_via').eq('id', aRev.id).single();
            expect(!after.error, `reread revoked code ${after.error?.code ?? 'none'}`);
            expect(after.data.revoked_at === before.data.revoked_at, 'revoked_at changed');
            expect(after.data.revoked_via === 'self', `revoked_via ${after.data.revoked_via}`);

            const temporary = await issueNamed(admin, fx.userB.id, 'B tmp', ['tasks:read']);
            const uiRevoke = await admin.rpc('mcp_revoke_token', {
                p_user_id: fx.userB.id,
                p_token_id: temporary.id,
                p_via: 'ui',
            });
            expect(
                uiRevoke.error == null && uiRevoke.data?.ok === true,
                `ui revoke code ${uiRevoke.data?.code ?? uiRevoke.error?.code ?? 'none'}`
            );
            const blocked = await call(temporary.token, 'taskel_whoami', {}, { ip: IPS.r7 });
            expect(blocked.status === 401, `B tmp status ${blocked.status}`);
            expect(httpCode(blocked) === 'MCP_TOKEN_REVOKED', `B tmp code ${httpCode(blocked)}`);
        });

        await check('R8', 'sixth active token refused under concurrency', async () => {
            const attempts = await Promise.all(
                Array.from({ length: 10 }, (_, index) =>
                    issueToken(admin, {
                        userId: userC.id,
                        name: `slot ${index}`,
                        scopes: ['tasks:read'],
                        days: 30,
                        timezone: TIMEZONE,
                    })
                )
            );
            const okCount = attempts.filter((item) => item.result?.ok === true).length;
            const limited = attempts.filter((item) => item.result?.ok === false && item.result?.code === 'TOKEN_LIMIT').length;
            expect(okCount === 5, `ok ${okCount}`);
            expect(limited === 5, `limited ${limited}`);
            const active = await activeTokenCount(admin, userC.id);
            expect(active === 5, `active rows ${active}`);
        });

        await check('R9', 'two-user isolation', async () => {
            const dayB = toolData(await call(bRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.r9 }));
            for (const title of A_TITLES) {
                expect(!titlesOf(dayB).includes(title), 'B list contained an A title');
            }
            expect(dayB.hidden_shared_count === 0, `B hidden ${dayB.hidden_shared_count}`);

            const searchB = toolData(await call(bRw.token, 'taskel_search_tasks', { query: '歯医者' }, { ip: IPS.r9 }));
            expect(
                titlesOf(searchB).length === 1 && titlesOf(searchB)[0] === 'B-SECRET 歯医者',
                `B search count ${titlesOf(searchB).length}`
            );
            expect((searchB.routine_matches ?? []).length === 0, `B routine matches ${(searchB.routine_matches ?? []).length}`);

            assertToolError(await call(bRw.token, 'taskel_get_task', { id: fx.ids.open }, { ip: IPS.r9 }), 'NOT_FOUND');

            const created = toolData(await call(bRw.token, 'taskel_create_task', { title: 'B の買い物' }, { ip: IPS.r9 }));
            expect(created.created === true, 'B create failed');
            const createdId = created.task?.id;
            expect(typeof createdId === 'string', 'B create missing id');
            const row = await admin.from('tasks').select('user_id').eq('id', createdId).single();
            expect(!row.error, `B row code ${row.error?.code ?? 'none'}`);
            expect(row.data.user_id === fx.userB.id, 'B create user mismatch');

            const dayA = toolData(await call(aRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.r9 }));
            const dayATitles = titlesOf(dayA);
            expect(!dayATitles.includes('B-SECRET 歯医者'), 'A list contained B secret');
            expect(!dayATitles.includes('B の買い物'), 'A list contained B task');
            assertToolError(await call(aRw.token, 'taskel_get_task', { id: fx.ids.bTask }, { ip: IPS.r9 }), 'NOT_FOUND');
        });

        await check('R10', 'shared-project row is counted, never returned', async () => {
            const day = toolData(await call(aRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.r10 }));
            expect(
                !titlesOf(day).some((title) => typeof title === 'string' && title.includes('SHARED-MARKER')),
                'shared title returned'
            );
            expect(day.hidden_shared_count === 1, `hidden ${day.hidden_shared_count}`);
            const search = toolData(await call(aRw.token, 'taskel_search_tasks', { query: 'SHARED-MARKER' }, { ip: IPS.r10 }));
            expect(search.count === 0, `search count ${search.count}`);
            assertToolError(await call(aRw.token, 'taskel_get_task', { id: fx.ids.shared }, { ip: IPS.r10 }), 'NOT_FOUND');
        });

        await check('R10b', "a project editor's rows cannot push the user's own tasks out of the day", async () => {
            // Another day, so the rows planted here do not change the counts the
            // other checks expect for today.
            const day = addDays(fx.today, 5);
            const project = await signedB
                .from('projects')
                .insert({ owner_id: fx.userB.id, title: `Flood ${tag}` })
                .select('id')
                .single();
            expect(!project.error, `B project code ${project.error?.code ?? 'none'}`);
            const flood = Array.from({ length: 501 }, (_, index) => ({
                user_id: fx.userA.id,
                project_id: project.data.id,
                title: `FLOOD-HIDDEN ${index}`,
                date: day,
                status: 'open',
                estimated_minutes: 1,
                actual_minutes: 0,
                order: -1000,
            }));
            // Inserted by B through the ordinary task insert policy, as an editor of B's own project.
            const planted = await signedB.from('tasks').insert(flood);
            expect(!planted.error, `B flood code ${planted.error?.code ?? 'none'}`);

            const own = await admin
                .from('tasks')
                .insert({
                    user_id: fx.userA.id,
                    title: 'FLOOD-OWN 自分のタスク',
                    date: day,
                    status: 'open',
                    section_id: fx.sections.Morning,
                    estimated_minutes: 15,
                    actual_minutes: 0,
                    order: 0,
                })
                .select('id')
                .single();
            expect(!own.error, `own task code ${own.error?.code ?? 'none'}`);
            const routineRow = await admin
                .from('tasks')
                .insert({
                    user_id: fx.userA.id,
                    title: '日報',
                    date: day,
                    status: 'open',
                    section_id: fx.sections.Evening,
                    routine_id: fx.ids.routineDaily,
                    estimated_minutes: 30,
                    actual_minutes: 0,
                    order: 1,
                })
                .select('id')
                .single();
            expect(!routineRow.error, `routine row code ${routineRow.error?.code ?? 'none'}`);

            const snapshot = await admin.rpc('mcp_day_snapshot', {
                p_user_id: fx.userA.id,
                p_token_id: aRo.id,
                p_request_id: 'smoke-r10b',
                p_arg_keys: ['date'],
                p_date: day,
            });
            expect(!snapshot.error, `snapshot code ${snapshot.error?.code ?? 'none'}`);
            const rows = snapshot.data?.tasks ?? [];
            expect(rows.length === 500, `snapshot rows ${rows.length}`);
            expect(snapshot.data?.tasks_truncated === true, 'snapshot not truncated');
            const ownRow = rows.find((row) => row.id === own.data.id);
            expect(ownRow?.in_scope === true, 'own task missing from the snapshot');
            const materialised = rows.find((row) => row.id === routineRow.data.id);
            expect(materialised?.in_scope === true, 'routine row missing from the snapshot');
            expect(
                rows.filter((row) => row.in_scope === false).every((row) => row.title === null),
                'out-of-scope title returned'
            );

            const list = toolData(await call(aRo.token, 'taskel_list_tasks_for_day', { date: day }, { ip: IPS.r10b }));
            const listed = list.tasks ?? [];
            expect(listed.some((task) => task.title === 'FLOOD-OWN 自分のタスク'), 'own task missing from the list');
            const reports = listed.filter((task) => task.title === '日報');
            expect(reports.length === 1, `daily report rows ${reports.length}`);
            expect(reports[0].is_virtual === false, 'routine listed as a virtual duplicate');
            expect(
                !titlesOf(list).some((title) => typeof title === 'string' && title.includes('FLOOD-HIDDEN')),
                'flood title returned'
            );
            expect(list.hidden_shared_count === 498, `hidden ${list.hidden_shared_count}`);
        });

        await check('R11', 'memo is never returned or searched', async () => {
            const day = await call(aRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.r11 });
            toolData(day);
            assertNoPrivateFields(day.json.result, 'day list');
            const search = await call(aRw.token, 'taskel_search_tasks', { query: '請求書' }, { ip: IPS.r11 });
            toolData(search);
            assertNoPrivateFields(search.json.result, 'search');
            const got = await call(aRw.token, 'taskel_get_task', { id: fx.ids.open }, { ip: IPS.r11 });
            toolData(got);
            assertNoPrivateFields(got.json.result, 'get');
            const hidden = toolData(await call(aRw.token, 'taskel_search_tasks', { query: 'MEMO-MARKER' }, { ip: IPS.r11 }));
            expect(hidden.count === 0, `memo search count ${hidden.count}`);
        });

        await check('R12', 'created rows are private and server-identified', async () => {
            const created = toolData(
                await call(aRw.token, 'taskel_create_task', { title: 'スモーク作成', day: 'today' }, { ip: IPS.r12 })
            );
            expect(created.created === true, 'created was not true');
            const taskId = created.task?.id;
            expect(typeof taskId === 'string', 'missing task id');
            const row = await admin.from('tasks').select('user_id, project_id, status').eq('id', taskId).single();
            expect(!row.error, `row code ${row.error?.code ?? 'none'}`);
            expect(row.data.user_id === fx.userA.id, 'user mismatch');
            expect(row.data.project_id === null, 'project was set');
            expect(row.data.status === 'open', `status ${row.data.status}`);

            const callerId = randomUUID();
            assertToolError(
                await call(aRw.token, 'taskel_create_task', { title: 'ignored id', id: callerId }, { ip: IPS.r12 }),
                'INVALID_INPUT'
            );
            const stored = await admin.from('tasks').select('id').eq('id', callerId).maybeSingle();
            expect(!stored.error, `caller id code ${stored.error?.code ?? 'none'}`);
            expect(stored.data == null, 'caller id was stored');

            assertToolError(
                await call(
                    aRw.token,
                    'taskel_create_task',
                    { title: 'ignored project', project_id: fx.ids.project },
                    { ip: IPS.r12 }
                ),
                'INVALID_INPUT'
            );
            assertToolError(
                await call(aRw.token, 'taskel_create_task', { title: 'bad\u202etitle' }, { ip: IPS.r12 }),
                'INVALID_INPUT'
            );
        });

        await check('R13', 'batch body refused', async () => {
            const before = await taskCount(admin, fx.userA.id);
            const response = await fetch(mcpEndpoint, {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    Authorization: `Bearer ${aRw.token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    'x-forwarded-for': IPS.r13,
                },
                body: JSON.stringify([
                    {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/call',
                        params: { name: 'taskel_create_task', arguments: { title: 'batch one' } },
                    },
                    {
                        jsonrpc: '2.0',
                        id: 2,
                        method: 'tools/call',
                        params: { name: 'taskel_create_task', arguments: { title: 'batch two' } },
                    },
                ]),
            });
            const json = await readJson(response);
            expect(response.status === 400, `status ${response.status}`);
            expect(json?.error?.data?.code === 'MCP_BATCH_UNSUPPORTED', `code ${json?.error?.data?.code ?? 'none'}`);
            const after = await taskCount(admin, fx.userA.id);
            expect(after === before, `task count ${before} -> ${after}`);
        });

        await check('R14', 'body cap', async () => {
            const body = jsonOfByteLength(BODY_BYTES);
            expect(Buffer.byteLength(body) === BODY_BYTES, `body bytes ${Buffer.byteLength(body)}`);
            const declared = await postBody(aRw.token, body, { ip: IPS.r14, asStream: false });
            expect(declared.status === 413, `declared status ${declared.status}`);
            expect(httpCode(declared) === 'MCP_BODY_TOO_LARGE', `declared code ${httpCode(declared)}`);
            const streamed = await postBody(aRw.token, body, { ip: IPS.r14, asStream: true });
            expect(streamed.status === 413, `stream status ${streamed.status}`);
            expect(httpCode(streamed) === 'MCP_BODY_TOO_LARGE', `stream code ${httpCode(streamed)}`);
        });

        await check('R17', 'unknown token writes nothing', async () => {
            const beforeAudit = await exactCount(admin.from('mcp_audit_logs').select('id', { count: 'exact', head: true }));
            const beforeRate = await exactCount(
                admin.from('mcp_rate_windows').select('token_id', { count: 'exact', head: true })
            );
            const unknown = generateToken();
            const response = await call(unknown.token, 'taskel_whoami', {}, { ip: IPS.r17 });
            expect(response.status === 401, `status ${response.status}`);
            expect(httpCode(response) === 'MCP_TOKEN_INVALID', `code ${httpCode(response)}`);
            const afterAudit = await exactCount(admin.from('mcp_audit_logs').select('id', { count: 'exact', head: true }));
            const afterRate = await exactCount(
                admin.from('mcp_rate_windows').select('token_id', { count: 'exact', head: true })
            );
            expect(afterAudit === beforeAudit, `audit ${beforeAudit} -> ${afterAudit}`);
            expect(afterRate === beforeRate, `rate ${beforeRate} -> ${afterRate}`);
        });

        await check('R19', 'no bearer, no access', async () => {
            const response = await fetch(mcpEndpoint, {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    Cookie: 'sb-access-token=x',
                    'x-forwarded-for': IPS.r19,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: 'taskel_whoami', arguments: {} },
                }),
            });
            const json = await readJson(response);
            expect(response.status === 401, `status ${response.status}`);
            expect(json?.error?.data?.code === 'MCP_UNAUTHORIZED', `code ${json?.error?.data?.code ?? 'none'}`);
            const authenticate = response.headers.get('www-authenticate');
            expect(authenticate !== null && authenticate.includes('Bearer'), 'missing WWW-Authenticate');
        });

        await check('S1', "story 1: today's list", async () => {
            const day = toolData(await call(aRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.s1 }));
            expect(day.date === fx.today, `date ${day.date}`);
            const invoice = (day.tasks ?? []).find((task) => task.title === '請求書を送る');
            expect(invoice, 'missing invoice task');
            expect(invoice.scheduled_start === '10:00', `scheduled_start ${invoice.scheduled_start}`);
            const report = (day.tasks ?? []).find((task) => task.title === '日報');
            expect(report?.is_virtual === true && report?.is_routine === true, 'daily report flags');
            expect(!(day.tasks ?? []).some((task) => task.title === '消したルーチン'), 'tombstone was listed');
            expect(day.hidden_shared_count === 1, `hidden ${day.hidden_shared_count}`);
        });

        await check('S2', 'story 2: add a task', async () => {
            const key = idempotencyKey();
            const first = toolData(
                await call(
                    aRw.token,
                    'taskel_create_task',
                    { title: 'E2E 牛乳を買う', idempotency_key: key },
                    { ip: IPS.s2 }
                )
            );
            expect(first.created === true, 'created was not true');
            expect(typeof first.task?.section === 'string' && first.task.section.length > 0, 'section empty');
            expect(first.task?.date === fx.today, `date ${first.task?.date}`);
            const day = toolData(await call(aRw.token, 'taskel_list_tasks_for_day', {}, { ip: IPS.s2 }));
            expect(titlesOf(day).includes('E2E 牛乳を買う'), 'day list missing the new task');
            const second = toolData(
                await call(
                    aRw.token,
                    'taskel_create_task',
                    { title: 'E2E 牛乳を買う', idempotency_key: key },
                    { ip: IPS.s2 }
                )
            );
            expect(second.created === false, `replay created ${second.created}`);
            expect(second.task?.id === first.task?.id, 'replay id changed');
            const count = await exactCount(
                admin
                    .from('tasks')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', fx.userA.id)
                    .eq('title', 'E2E 牛乳を買う')
            );
            expect(count === 1, `title count ${count}`);
            assertToolError(
                await call(
                    aRw.token,
                    'taskel_create_task',
                    { title: 'E2E 別の題名', idempotency_key: key },
                    { ip: IPS.s2 }
                ),
                'CONFLICT'
            );
        });

        await check('S3', "story 3: last week's search", async () => {
            const search = toolData(
                await call(aRw.token, 'taskel_search_tasks', { query: '歯医者', range: 'last_week' }, { ip: IPS.s3 })
            );
            expect(search.count === 1, `count ${search.count}`);
            expect((search.tasks ?? []).length === 1, `tasks ${(search.tasks ?? []).length}`);
            const task = search.tasks[0];
            expect(task.title === '歯医者の予約', 'title mismatch');
            expect(task.status === 'done', `status ${task.status}`);
            expect(task.date === fx.lastWeekDate, `date ${task.date}`);
            expect(
                typeof task.completed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.completed_on),
                'completed_on shape'
            );
            const asReader = toolData(
                await call(aRo.token, 'taskel_search_tasks', { query: '歯医者', range: 'last_week' }, { ip: IPS.s3 })
            );
            expect(asReader.count === 1, `reader count ${asReader.count}`);
            assertToolError(await call(aRo.token, 'taskel_create_task', { title: 'nope' }, { ip: IPS.s3 }), 'SCOPE_FORBIDDEN');
        });

        await check('R15', 'create cap holds under concurrency', async () => {
            const responses = await Promise.all(
                Array.from({ length: 40 }, (_, index) =>
                    call(
                        aCap.token,
                        'taskel_create_task',
                        { title: `cap ${index}`, idempotency_key: idempotencyKey() },
                        { ip: IPS.r15 }
                    )
                )
            );
            const createdCount = responses.filter(
                (response) =>
                    response.json?.result?.structuredContent?.ok === true &&
                    response.json.result.structuredContent.data?.created === true
            ).length;
            const limitedCount = responses.filter(
                (response) => response.json?.result?.isError === true && toolCode(response) === 'RATE_LIMITED'
            ).length;
            expect(createdCount <= 30, `created ${createdCount}`);
            expect(createdCount === 30, `created ${createdCount}`);
            expect(limitedCount === responses.length - createdCount, `limited ${limitedCount}`);
            const stored = await exactCount(
                admin.from('mcp_task_creations').select('token_id', { count: 'exact', head: true }).eq('token_id', aCap.id)
            );
            expect(stored === createdCount && stored <= 30, `creations ${stored}`);
        });

        await check('R16', '61st request in a minute is refused, counted in the database', async () => {
            await waitForRateWindow();
            const httpCalls = await Promise.all(
                Array.from({ length: 30 }, () => call(aRate.token, 'taskel_whoami', {}, { ip: IPS.r16 }))
            );
            const httpOk = httpCalls.filter(
                (response) => response.status === 200 && response.json?.result?.structuredContent?.ok === true
            ).length;
            expect(httpOk === 30, `whoami ok ${httpOk}`);

            const rpcCalls = await Promise.all(
                Array.from({ length: 30 }, () => admin.rpc('mcp_authenticate', { p_token_hash: aRate.hash }))
            );
            const rpcOk = rpcCalls.filter((result) => !result.error && result.data?.status === 'ok').length;
            expect(rpcOk === 30, `rpc ok ${rpcOk}`);

            const limited = await call(aRate.token, 'taskel_whoami', {}, { ip: IPS.r16 });
            expect(limited.status === 429, `status ${limited.status}`);
            expect(httpCode(limited) === 'MCP_RATE_LIMITED', `code ${httpCode(limited)}`);
            const retryHeader = limited.headers.get('retry-after');
            const retry = Number(retryHeader);
            expect(
                Number.isInteger(retry) && retry >= 1 && retry <= 60,
                `retry-after ${String(retryHeader ?? '').slice(0, 8)}`
            );

            const rows = await exactCount(
                admin
                    .from('mcp_audit_logs')
                    .select('id', { count: 'exact', head: true })
                    .eq('token_id', aRate.id)
                    .eq('event', 'rate_limited')
            );
            expect(rows === 1, `rate_limited rows ${rows}`);
        });
    } catch (error) {
        setupFailed = true;
        if (isMissingMigration(error)) {
            console.error('The MCP migration is not applied to this database.');
        } else {
            console.error(`setup failed: ${safeReason(error)}`);
        }
    } finally {
        try {
            await deleteFixtureUsers(admin, userIds);
        } catch (error) {
            cleanupFailed = true;
            console.error(`cleanup failed: ${safeReason(error)}`);
        }
        for (const client of clients) {
            disconnect(client);
        }
    }

    console.log('');
    for (const result of results) {
        console.log(`${result.id.padEnd(4)} ${result.ok ? 'ok  ' : 'FAIL'} ${result.title}`);
    }
    const passed = results.filter((result) => result.ok).length;
    console.log(`passed ${passed} / ${results.length}`);

    if (setupFailed || cleanupFailed || results.some((result) => !result.ok)) {
        process.exit(1);
    }
    process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    main().catch((error) => {
        console.error(safeReason(error));
        process.exit(1);
    });
}
