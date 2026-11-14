import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

import {
    authenticateMcpTokenHash,
    createMcpDb,
    createTokenAdminDb,
    McpDbError,
    resetMcpDbForTests,
} from './db';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';
const HASH = 'a'.repeat(64);

const taskRow = {
    id: TASK,
    title: '請求書を送る',
    status: 'open',
    date: '2026-11-15',
    scheduled_start: '10:00',
    section_id: SECTION,
    section: 'Morning',
    estimated_minutes: 15,
    actual_minutes: 0,
    routine_id: null,
    completed_at: null,
};

function ok(data: unknown) {
    return { data, error: null };
}

function fail(code: string, message = 'boom') {
    return { data: null, error: { code, message, details: null, hint: null } };
}

async function rejection(promise: Promise<unknown>): Promise<McpDbError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(McpDbError);
        return error as McpDbError;
    }
    throw new Error('expected a rejection');
}

beforeEach(() => {
    rpc.mockReset();
    createAdminClient.mockReset();
    createAdminClient.mockReturnValue({ rpc });
    resetMcpDbForTests();
});

describe('authenticateMcpTokenHash', () => {
    it('maps an ok row and sends only the hash', async () => {
        rpc.mockResolvedValue(
            ok({
                status: 'ok',
                token_id: TOKEN,
                user_id: USER,
                name: 'Beacon',
                prefix: 'tsk_mcp_AbCdEfGh',
                scopes: ['tasks:read', 'tasks:create'],
                timezone: 'Asia/Tokyo',
                expires_at: '2027-02-13T01:00:00+00:00',
            })
        );

        await expect(authenticateMcpTokenHash(HASH)).resolves.toEqual({
            status: 'ok',
            auth: {
                userId: USER,
                tokenId: TOKEN,
                tokenName: 'Beacon',
                tokenPrefix: 'tsk_mcp_AbCdEfGh',
                scopes: ['tasks:read', 'tasks:create'],
                timezone: 'Asia/Tokyo',
                expiresAt: '2027-02-13T01:00:00+00:00',
            },
        });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith('mcp_authenticate', { p_token_hash: HASH });
    });

    it('maps the refusal statuses', async () => {
        for (const status of ['unknown', 'revoked', 'expired'] as const) {
            rpc.mockResolvedValueOnce(ok({ status }));
            await expect(authenticateMcpTokenHash(HASH)).resolves.toEqual({ status });
        }
        rpc.mockResolvedValueOnce(ok({ status: 'rate_limited', retry_after_s: 23 }));
        await expect(authenticateMcpTokenHash(HASH)).resolves.toEqual({ status: 'rate_limited', retryAfterSeconds: 23 });
    });

    it('reports a missing function as not ready', async () => {
        for (const code of ['PGRST202', '42883']) {
            rpc.mockResolvedValueOnce(fail(code));
            await expect(authenticateMcpTokenHash(HASH)).resolves.toEqual({ status: 'not_ready' });
        }
    });

    it('throws a fixed message for any other database error', async () => {
        rpc.mockResolvedValue(fail('XX000', 'relation "secret_table" does not exist'));
        const error = await rejection(authenticateMcpTokenHash(HASH));
        expect(error.kind).toBe('internal');
        expect(error.message).toBe('MCP database call failed.');
        expect(error.message).not.toContain('secret_table');
    });

    it('refuses a row that does not match the contract', async () => {
        for (const row of [
            null,
            { status: 'ok' },
            { status: 'admin' },
            { status: 'ok', token_id: TOKEN, user_id: 'not-a-uuid', name: 'x', prefix: 'tsk_mcp_AbCdEfGh', scopes: ['tasks:read'], timezone: 'UTC', expires_at: 'x' },
            { status: 'ok', token_id: TOKEN, user_id: USER, name: 'x', prefix: 'tsk_mcp_AbCdEfGh', scopes: ['tasks:delete'], timezone: 'UTC', expires_at: 'x' },
            { status: 'ok', token_id: TOKEN, user_id: USER, name: 'x', prefix: 'tsk_mcp_AbCdEfGh', scopes: [], timezone: 'UTC', expires_at: 'x' },
        ]) {
            rpc.mockResolvedValueOnce(ok(row));
            expect((await rejection(authenticateMcpTokenHash(HASH))).kind).toBe('internal');
        }
    });
});

describe('createMcpDb', () => {
    const bound = { p_user_id: USER, p_token_id: TOKEN, p_request_id: 'req-1' };
    const emptySnapshot = { tasks: [], tasks_truncated: false, goals: [], routines: [], sections: [] };

    function db() {
        return createMcpDb({ userId: USER, tokenId: TOKEN, requestId: 'req-1' });
    }

    it('is frozen and exposes only the bound methods', () => {
        const instance = db();
        expect(Object.isFrozen(instance)).toBe(true);
        expect(Object.keys(instance).sort()).toEqual(
            ['createTask', 'daySnapshot', 'getTask', 'logEvent', 'revokeSelf', 'search', 'sectionsForCreate'].sort()
        );
        expect(createAdminClient).not.toHaveBeenCalled();
    });

    it('daySnapshot binds the user and token', async () => {
        rpc.mockResolvedValue(ok(emptySnapshot));
        await expect(db().daySnapshot('2026-11-15', ['date'])).resolves.toEqual(emptySnapshot);
        expect(rpc).toHaveBeenCalledWith('mcp_day_snapshot', {
            ...bound,
            p_arg_keys: ['date'],
            p_date: '2026-11-15',
            p_tool: 'taskel_list_tasks_for_day',
        });
    });

    it('drops every key the contract does not list', async () => {
        rpc.mockResolvedValue(
            ok({
                ...emptySnapshot,
                tasks: [
                    {
                        id: TASK,
                        title: null,
                        status: 'skipped',
                        date: '2026-11-15',
                        scheduled_start: null,
                        section_id: null,
                        estimated_minutes: 0,
                        actual_minutes: 0,
                        routine_id: null,
                        order: 1,
                        in_scope: false,
                        memo: 'MEMOMARKER',
                        project_id: OTHER_USER,
                        checklist: [],
                        tags: ['x'],
                    },
                ],
                secret: 'MEMOMARKER',
            })
        );
        const snapshot = await db().daySnapshot('2026-11-15', []);
        expect(JSON.stringify(snapshot)).not.toMatch(/MEMOMARKER|memo|project_id|checklist|tags|secret/);
        expect(snapshot.tasks[0]).toMatchObject({ id: TASK, title: null, in_scope: false });
    });

    it('sectionsForCreate asks on behalf of the create tool and returns sections only', async () => {
        const sections = [{ id: SECTION, name: 'Morning', start_time: '06:00', end_time: '12:00', order: 1 }];
        rpc.mockResolvedValue(ok({ ...emptySnapshot, sections }));
        await expect(db().sectionsForCreate('2026-11-15')).resolves.toEqual(sections);
        expect(rpc).toHaveBeenCalledWith('mcp_day_snapshot', {
            ...bound,
            p_arg_keys: [],
            p_date: '2026-11-15',
            p_tool: 'taskel_create_task',
        });
    });

    it('search passes bound parameters, never a filter string', async () => {
        rpc.mockResolvedValue(ok({ tasks: [taskRow], truncated: false, routine_matches: [] }));
        const result = await db().search({
            argKeys: ['query', 'range'],
            terms: ['請求書', '%'],
            dateFrom: '2026-11-02',
            dateTo: '2026-11-08',
            statuses: ['open', 'done'],
            includeUndated: false,
            limit: 20,
        });
        expect(result.tasks).toEqual([taskRow]);
        expect(rpc).toHaveBeenCalledWith('mcp_search_tasks', {
            ...bound,
            p_arg_keys: ['query', 'range'],
            p_terms: ['請求書', '%'],
            p_date_from: '2026-11-02',
            p_date_to: '2026-11-08',
            p_statuses: ['open', 'done'],
            p_include_undated: false,
            p_limit: 20,
        });
    });

    it('getTask returns the row or null', async () => {
        rpc.mockResolvedValueOnce(ok({ task: taskRow }));
        await expect(db().getTask(TASK)).resolves.toEqual(taskRow);
        expect(rpc).toHaveBeenCalledWith('mcp_get_task', { ...bound, p_task_id: TASK });

        rpc.mockResolvedValueOnce(ok({ task: null }));
        await expect(db().getTask(TASK)).resolves.toBeNull();
    });

    it('createTask cannot be pointed at another user or given a row id', async () => {
        rpc.mockResolvedValue(ok({ ok: true, created: true, task: taskRow }));
        const hostile = {
            idempotencyKey: 'k'.repeat(43),
            requestHash: HASH,
            title: '請求書を送る',
            date: '2026-11-15',
            scheduledStart: '10:00',
            estimatedMinutes: null,
            sectionId: SECTION,
            // Extra keys a buggy or hostile caller might add.
            p_user_id: OTHER_USER,
            userId: OTHER_USER,
            id: OTHER_USER,
            projectId: OTHER_USER,
            status: 'done',
        };
        await expect(db().createTask(hostile)).resolves.toEqual({ ok: true, created: true, task: taskRow });
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc.mock.calls[0]).toEqual([
            'mcp_create_task',
            {
                ...bound,
                p_idempotency_key: 'k'.repeat(43),
                p_request_hash: HASH,
                p_title: '請求書を送る',
                p_date: '2026-11-15',
                p_scheduled_start: '10:00',
                p_estimated_minutes: null,
                p_section_id: SECTION,
            },
        ]);
    });

    it('createTask passes through the refusal codes', async () => {
        for (const code of ['INVALID_INPUT', 'CONFLICT', 'RATE_LIMITED'] as const) {
            rpc.mockResolvedValueOnce(ok({ ok: false, code }));
            await expect(
                db().createTask({
                    idempotencyKey: null,
                    requestHash: HASH,
                    title: 'x',
                    date: '2026-11-15',
                    scheduledStart: null,
                    estimatedMinutes: 15,
                    sectionId: null,
                })
            ).resolves.toEqual({ ok: false, code });
        }
    });

    it('revokeSelf revokes only the bound token', async () => {
        rpc.mockResolvedValue(ok({ ok: true }));
        await expect(db().revokeSelf()).resolves.toEqual({ ok: true });
        expect(rpc).toHaveBeenCalledWith('mcp_revoke_token', { p_user_id: USER, p_token_id: TOKEN, p_via: 'self' });
    });

    it('logEvent records a denial', async () => {
        rpc.mockResolvedValue(ok({ ok: true }));
        await db().logEvent('taskel_create_task', 'SCOPE_FORBIDDEN');
        expect(rpc).toHaveBeenCalledWith('mcp_log_event', {
            ...bound,
            p_event: 'denied',
            p_tool: 'taskel_create_task',
            p_error_code: 'SCOPE_FORBIDDEN',
        });
    });

    it('classifies database refusals without leaking their text', async () => {
        const cases = [
            ['42501', 'MCP_TOKEN_NOT_ACTIVE', 'token_not_active'],
            ['42501', 'MCP_SCOPE_FORBIDDEN', 'scope_forbidden'],
            ['42501', 'permission denied for function mcp_get_task', 'internal'],
            ['PGRST202', 'Could not find the function', 'not_ready'],
            ['22023', 'MCP_SEARCH_NEEDS_FILTER', 'internal'],
        ] as const;
        for (const [code, message, kind] of cases) {
            rpc.mockResolvedValueOnce(fail(code, message));
            const error = await rejection(db().getTask(TASK));
            expect(error.kind).toBe(kind);
            expect(error.message).not.toContain(message);
        }
    });

    it('refuses a malformed result', async () => {
        rpc.mockResolvedValueOnce(ok({ task: { ...taskRow, status: 'skipped' } }));
        expect((await rejection(db().getTask(TASK))).kind).toBe('internal');
        rpc.mockResolvedValueOnce(ok({ ok: true, created: true }));
        expect(
            (
                await rejection(
                    db().createTask({
                        idempotencyKey: null,
                        requestHash: HASH,
                        title: 'x',
                        date: '2026-11-15',
                        scheduledStart: null,
                        estimatedMinutes: null,
                        sectionId: null,
                    })
                )
            ).kind
        ).toBe('internal');
    });
});

describe('createTokenAdminDb', () => {
    const record = {
        id: TOKEN,
        name: 'Beacon',
        prefix: 'tsk_mcp_AbCdEfGh',
        scopes: ['tasks:read'],
        timezone: 'Asia/Tokyo',
        created_at: '2026-11-15T01:00:00+00:00',
        expires_at: '2027-02-13T01:00:00+00:00',
        last_used_at: null,
        revoked_at: null,
        revoked_via: null,
    };

    it('issues for the session user only', async () => {
        rpc.mockResolvedValue(ok({ ok: true, token: record }));
        const result = await createTokenAdminDb(USER).issue({
            name: 'Beacon',
            tokenHash: HASH,
            tokenPrefix: 'tsk_mcp_AbCdEfGh',
            scopes: ['tasks:read'],
            expiresDays: 90,
            timezone: 'Asia/Tokyo',
        });
        expect(result).toEqual({ ok: true, token: record });
        expect(rpc).toHaveBeenCalledWith('mcp_issue_token', {
            p_user_id: USER,
            p_name: 'Beacon',
            p_token_hash: HASH,
            p_token_prefix: 'tsk_mcp_AbCdEfGh',
            p_scopes: ['tasks:read'],
            p_expires_days: 90,
            p_timezone: 'Asia/Tokyo',
        });
    });

    it('reports the token limit and a missing migration', async () => {
        rpc.mockResolvedValueOnce(ok({ ok: false, code: 'TOKEN_LIMIT' }));
        const input = {
            name: 'Beacon',
            tokenHash: HASH,
            tokenPrefix: 'tsk_mcp_AbCdEfGh',
            scopes: ['tasks:read' as const],
            expiresDays: 90,
            timezone: 'Asia/Tokyo',
        };
        await expect(createTokenAdminDb(USER).issue(input)).resolves.toEqual({ ok: false, code: 'TOKEN_LIMIT' });

        rpc.mockResolvedValueOnce(fail('PGRST202'));
        expect((await rejection(createTokenAdminDb(USER).issue(input))).kind).toBe('not_ready');
    });

    it('lists without a hash and reports not ready', async () => {
        rpc.mockResolvedValueOnce(ok({ tokens: [{ ...record, token_hash: HASH }], recent: [] }));
        const listed = await createTokenAdminDb(USER).list();
        expect(listed).toEqual({ ready: true, tokens: [record], recent: [] });
        expect(JSON.stringify(listed)).not.toContain(HASH);
        expect(rpc).toHaveBeenCalledWith('mcp_list_tokens', { p_user_id: USER });

        rpc.mockResolvedValueOnce(fail('PGRST202'));
        await expect(createTokenAdminDb(USER).list()).resolves.toEqual({ ready: false });
    });

    it('revokes through the ui path for the session user', async () => {
        rpc.mockResolvedValueOnce(ok({ ok: false, code: 'NOT_FOUND' }));
        await expect(createTokenAdminDb(USER).revoke(TOKEN)).resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
        expect(rpc).toHaveBeenCalledWith('mcp_revoke_token', { p_user_id: USER, p_token_id: TOKEN, p_via: 'ui' });
    });
});
