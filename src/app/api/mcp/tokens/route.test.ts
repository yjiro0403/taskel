import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { McpDbError, type McpTokenAdminDb, type McpTokenRecord } from '@/lib/mcp/db';
import { hashMcpToken, MCP_TOKEN_PATTERN } from '@/lib/mcp/token';

const authModule = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const dbModule = vi.hoisted(() => ({ createTokenAdminDb: vi.fn() }));

vi.mock('@/lib/api/auth', () => authModule);
vi.mock('@/lib/mcp/db', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mcp/db')>();
    return { ...actual, createTokenAdminDb: dbModule.createTokenAdminDb };
});

import { DELETE } from './[id]/route';
import { GET, POST } from './route';

const ORIGIN = 'http://localhost:3210';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN_ID = '22222222-2222-4222-8222-222222222222';

const RECORD: McpTokenRecord = {
    id: TOKEN_ID,
    name: 'Beacon',
    prefix: 'tsk_mcp_AbCdEfGh',
    scopes: ['tasks:read', 'tasks:create'],
    timezone: 'Asia/Tokyo',
    created_at: '2026-11-15T01:00:00+00:00',
    expires_at: '2027-02-13T01:00:00+00:00',
    last_used_at: null,
    revoked_at: null,
    revoked_via: null,
};

const VALID_BODY = { name: 'Beacon', access: 'read_create', expiresInDays: 90, timezone: 'Asia/Tokyo' };

let adminDb: { [K in keyof McpTokenAdminDb]: ReturnType<typeof vi.fn<McpTokenAdminDb[K]>> };
let ipCounter = 0;
let logged: unknown[][];

function request(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) {
    // A fresh address per request keeps the per-IP limiter out of unrelated tests.
    ipCounter += 1;
    const headers = new Headers({ 'x-forwarded-for': `10.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, ...options.headers });
    let body: string | undefined;
    if (options.body !== undefined) {
        headers.set('content-type', 'application/json');
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    return new Request(`${ORIGIN}${path}`, { method, headers, body });
}

const issue = (body: unknown = VALID_BODY, headers?: Record<string, string>) =>
    POST(request('POST', '/api/mcp/tokens', { body, headers }));

const revoke = (id: string, headers?: Record<string, string>) =>
    DELETE(request('DELETE', `/api/mcp/tokens/${id}`, { headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
    logged = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            logged.push(args);
        });
    }
    authModule.requireAuth.mockReset();
    authModule.requireAuth.mockResolvedValue({ id: USER_ID });
    adminDb = {
        issue: vi.fn<McpTokenAdminDb['issue']>(async () => ({ ok: true as const, token: RECORD })),
        list: vi.fn<McpTokenAdminDb['list']>(async () => ({ ready: true as const, tokens: [RECORD], recent: [] })),
        revoke: vi.fn<McpTokenAdminDb['revoke']>(async () => ({ ok: true as const })),
    };
    dbModule.createTokenAdminDb.mockReset();
    dbModule.createTokenAdminDb.mockReturnValue(adminDb);
});

afterEach(() => {
    vi.restoreAllMocks();
});

function expectNoDatabase() {
    expect(dbModule.createTokenAdminDb).not.toHaveBeenCalled();
}

describe('GET /api/mcp/tokens', () => {
    it('lists the signed-in user\'s tokens and recent events', async () => {
        const recent = [{ created_at: '2026-11-15T02:00:00+00:00', event: 'tool_call' as const, tool: 'taskel_whoami', ok: true, error_code: null, token_id: TOKEN_ID, token_prefix: RECORD.prefix }];
        adminDb.list.mockResolvedValue({ ready: true, tokens: [RECORD], recent });
        const response = await GET();
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ ready: true, tokens: [RECORD], recent });
        expect(dbModule.createTokenAdminDb).toHaveBeenCalledWith(USER_ID);
    });

    it('says ready:false while the migration is missing', async () => {
        adminDb.list.mockResolvedValue({ ready: false });
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ready: false, tokens: [], recent: [] });
    });

    it('401 without a session, and no database call', async () => {
        authModule.requireAuth.mockRejectedValue(new ApiError(401, 'Unauthorized'));
        const response = await GET();
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        expectNoDatabase();
    });

    it('500 with fixed text when the database fails', async () => {
        adminDb.list.mockRejectedValue(new McpDbError('internal', { message: 'secret detail' }));
        const response = await GET();
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
        expect(text).not.toContain('secret detail');
    });
});

describe('POST /api/mcp/tokens', () => {
    it('issues a token: 201, shown once, no-store', async () => {
        const response = await issue();
        expect(response.status).toBe(201);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const body = await response.json();
        expect(Object.keys(body).sort()).toEqual(['record', 'token']);
        expect(body.token).toMatch(MCP_TOKEN_PATTERN);
        expect(body.record).toEqual(RECORD);
    });

    it('stores only the SHA-256 and the 16-character prefix; the plaintext is not logged', async () => {
        const body = await (await issue()).json();
        const token: string = body.token;

        expect(dbModule.createTokenAdminDb).toHaveBeenCalledWith(USER_ID);
        expect(adminDb.issue).toHaveBeenCalledTimes(1);
        const stored = adminDb.issue.mock.calls[0][0];
        expect(stored).toEqual({
            name: 'Beacon',
            tokenHash: hashMcpToken(token),
            tokenPrefix: token.slice(0, 16),
            scopes: ['tasks:read', 'tasks:create'],
            expiresDays: 90,
            timezone: 'Asia/Tokyo',
        });
        expect(JSON.stringify(stored)).not.toContain(token);
        expect(JSON.stringify(stored)).not.toContain(token.slice(17));
        expect(JSON.stringify(body.record)).not.toContain(token);
        expect(JSON.stringify(logged)).not.toContain(token.slice(17));
    });

    it('issues a different token every time', async () => {
        const first = (await (await issue()).json()).token;
        const second = (await (await issue()).json()).token;
        expect(first).not.toBe(second);
    });

    it('maps the access choice to scopes', async () => {
        await issue({ ...VALID_BODY, access: 'read' });
        expect(adminDb.issue.mock.calls[0][0].scopes).toEqual(['tasks:read']);
    });

    it.each([30, 90, 180, 365])('accepts an expiry of %i days', async (expiresInDays) => {
        expect((await issue({ ...VALID_BODY, expiresInDays })).status).toBe(201);
        expect(adminDb.issue.mock.calls[0][0].expiresDays).toBe(expiresInDays);
    });

    it('trims the name', async () => {
        await issue({ ...VALID_BODY, name: '  Beacon Mac  ' });
        expect(adminDb.issue.mock.calls[0][0].name).toBe('Beacon Mac');
    });

    it.each([
        [{ ...VALID_BODY, expiresInDays: 366 }, 'expiry over 365'],
        [{ ...VALID_BODY, expiresInDays: 0 }, 'no expiry'],
        [{ ...VALID_BODY, expiresInDays: 3650 }, 'ten years'],
        [{ ...VALID_BODY, expiresInDays: 60 }, 'expiry outside the choices'],
        [{ ...VALID_BODY, expiresInDays: '90' }, 'string expiry'],
        [{ ...VALID_BODY, expiresInDays: null }, 'null expiry'],
        [{ name: 'Beacon', access: 'read', timezone: 'Asia/Tokyo' }, 'missing expiry'],
        [{ ...VALID_BODY, access: 'admin' }, 'unknown access'],
        [{ ...VALID_BODY, access: 'create' }, 'create without read'],
        [{ ...VALID_BODY, name: '' }, 'empty name'],
        [{ ...VALID_BODY, name: '   ' }, 'blank name'],
        [{ ...VALID_BODY, name: 'x'.repeat(61) }, 'name over 60'],
        [{ ...VALID_BODY, name: 'bad‮name' }, 'bidi override in name'],
        [{ ...VALID_BODY, name: 'bad\nname' }, 'newline in name'],
        [{ ...VALID_BODY, timezone: 'Mars/Olympus' }, 'unknown time zone'],
        [{ ...VALID_BODY, timezone: '' }, 'empty time zone'],
        [{ ...VALID_BODY, scopes: ['tasks:read', 'tasks:admin'] }, 'caller-chosen scopes'],
        [{ ...VALID_BODY, created_at: '2020-01-01T00:00:00Z' }, 'caller-chosen created_at'],
        [{ ...VALID_BODY, expires_at: '2099-01-01T00:00:00Z' }, 'caller-chosen expires_at'],
        [{ ...VALID_BODY, expiresAt: '2099-01-01T00:00:00Z' }, 'caller-chosen expiresAt'],
        [{ ...VALID_BODY, user_id: TOKEN_ID }, 'caller-chosen user'],
        [{ ...VALID_BODY, token: 'chosen-by-caller' }, 'caller-chosen token'],
        [{ ...VALID_BODY, token_hash: 'a'.repeat(64) }, 'caller-chosen hash'],
        [[VALID_BODY], 'an array'],
        ['not json', 'invalid JSON'],
    ])('400 for %j (%s), and nothing is issued', async (body, reason) => {
        expect(typeof reason).toBe('string');
        const response = await issue(body);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(
            body === 'not json'
                ? { error: 'Invalid JSON body', code: 'BAD_REQUEST' }
                : { error: 'Invalid request data', code: 'INVALID_INPUT' }
        );
        expectNoDatabase();
    });

    it('409 when the user already has five active tokens', async () => {
        adminDb.issue.mockResolvedValue({ ok: false, code: 'TOKEN_LIMIT' });
        const response = await issue();
        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.code).toBe('TOKEN_LIMIT');
        expect(body.token).toBeUndefined();
    });

    it('400 when the database refuses the input', async () => {
        adminDb.issue.mockResolvedValue({ ok: false, code: 'INVALID_INPUT' });
        const response = await issue();
        expect(response.status).toBe(400);
        expect((await response.json()).token).toBeUndefined();
    });

    it('503 MCP_NOT_READY while the migration is missing', async () => {
        adminDb.issue.mockRejectedValue(new McpDbError('not_ready'));
        const response = await issue();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'MCP server is not ready.', code: 'MCP_NOT_READY' });
    });

    it('500 with fixed text and no token when the database fails', async () => {
        adminDb.issue.mockRejectedValue(new McpDbError('internal', { message: 'secret detail' }));
        const response = await issue();
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' });
        expect(text).not.toContain('secret detail');
        expect(text).not.toContain('tsk_mcp_');
    });

    it('401 without a session, and no database call', async () => {
        authModule.requireAuth.mockRejectedValue(new ApiError(401, 'Unauthorized'));
        const response = await issue();
        expect(response.status).toBe(401);
        expectNoDatabase();
    });

    it('binds the token to the session user, whatever the request says', async () => {
        await issue(VALID_BODY, { 'x-user-id': TOKEN_ID, authorization: 'Bearer something' });
        expect(dbModule.createTokenAdminDb).toHaveBeenCalledTimes(1);
        expect(dbModule.createTokenAdminDb).toHaveBeenCalledWith(USER_ID);
    });

    it('accepts a same-origin request and one without an Origin header', async () => {
        expect((await issue(VALID_BODY, { origin: ORIGIN })).status).toBe(201);
        expect((await issue(VALID_BODY)).status).toBe(201);
    });

    it.each(['https://evil.example', 'http://localhost:3000', 'https://localhost:3210', 'null'])(
        '403 for the foreign Origin %s, before the session is read',
        async (origin) => {
            const response = await issue(VALID_BODY, { origin });
            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
            expect(authModule.requireAuth).not.toHaveBeenCalled();
            expectNoDatabase();
        }
    );

    it('429 after ten issues in a minute from one address', async () => {
        const headers = { 'x-forwarded-for': '10.200.0.1' };
        for (let i = 0; i < 10; i += 1) {
            expect((await issue(VALID_BODY, headers)).status).toBe(201);
        }
        const response = await issue(VALID_BODY, headers);
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).not.toBeNull();
        expect(adminDb.issue).toHaveBeenCalledTimes(10);
    });
});

describe('DELETE /api/mcp/tokens/[id]', () => {
    it('revokes the user\'s token through the ui path', async () => {
        const response = await revoke(TOKEN_ID);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(dbModule.createTokenAdminDb).toHaveBeenCalledWith(USER_ID);
        expect(adminDb.revoke).toHaveBeenCalledWith(TOKEN_ID);
    });

    it('404 for a token that is not the user\'s (or does not exist)', async () => {
        adminDb.revoke.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
        const response = await revoke(TOKEN_ID);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Token not found', code: 'NOT_FOUND' });
    });

    it('409 for a token that is already revoked', async () => {
        adminDb.revoke.mockResolvedValue({ ok: false, code: 'ALREADY_REVOKED' });
        const response = await revoke(TOKEN_ID);
        expect(response.status).toBe(409);
        expect((await response.json()).code).toBe('ALREADY_REVOKED');
    });

    it.each(['not-a-uuid', '1', `${TOKEN_ID}x`, '..'])('404 for the malformed id %s, without a database call', async (id) => {
        const response = await revoke(id);
        expect(response.status).toBe(404);
        expectNoDatabase();
    });

    it('401 without a session', async () => {
        authModule.requireAuth.mockRejectedValue(new ApiError(401, 'Unauthorized'));
        expect((await revoke(TOKEN_ID)).status).toBe(401);
        expectNoDatabase();
    });

    it('403 for a foreign Origin', async () => {
        const response = await revoke(TOKEN_ID, { origin: 'https://evil.example' });
        expect(response.status).toBe(403);
        expect(authModule.requireAuth).not.toHaveBeenCalled();
        expectNoDatabase();
    });

    it('accepts a same-origin request', async () => {
        expect((await revoke(TOKEN_ID, { origin: ORIGIN })).status).toBe(200);
    });

    it('503 while the migration is missing, 500 with fixed text otherwise', async () => {
        adminDb.revoke.mockRejectedValue(new McpDbError('not_ready'));
        expect((await revoke(TOKEN_ID)).status).toBe(503);
        adminDb.revoke.mockRejectedValue(new Error('secret detail'));
        const response = await revoke(TOKEN_ID);
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain('secret detail');
    });
});

describe('the token routes and the browser session', () => {
    it('have no way to un-revoke or edit a token', async () => {
        const collection = await import('./route');
        const item = await import('./[id]/route');
        expect(Object.keys(collection).filter((key) => /^[A-Z]+$/.test(key)).sort()).toEqual(['GET', 'POST']);
        expect(Object.keys(item).filter((key) => /^[A-Z]+$/.test(key)).sort()).toEqual(['DELETE']);
    });
});
