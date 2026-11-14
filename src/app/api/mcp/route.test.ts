import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpContext } from '@/lib/mcp/auth';
import type { McpAuth, McpAuthOutcome, McpDb } from '@/lib/mcp/db';
import { MCP_HTTP_ERRORS, type McpHttpErrorCode } from '@/lib/mcp/errors';
import { generateMcpToken, hashMcpToken } from '@/lib/mcp/token';

const dbModule = vi.hoisted(() => ({
    authenticateMcpTokenHash: vi.fn(),
    createMcpDb: vi.fn(),
}));
const factory = vi.hoisted(() => ({
    override: null as null | ((ctx: unknown) => unknown),
    contexts: [] as unknown[],
}));

vi.mock('@/lib/mcp/db', () => dbModule);
vi.mock('@/lib/mcp/serverFactory', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mcp/serverFactory')>();
    return {
        ...actual,
        createTaskelMcpServer: (ctx: McpContext) => {
            factory.contexts.push(ctx);
            return factory.override ? factory.override(ctx) : actual.createTaskelMcpServer(ctx);
        },
    };
});

import { DELETE, GET, POST } from './route';

const URL_ = 'http://localhost/api/mcp';
const AUTH: McpAuth = {
    userId: '11111111-1111-4111-8111-111111111111',
    tokenId: '22222222-2222-4222-8222-222222222222',
    tokenName: 'Beacon',
    tokenPrefix: 'tsk_mcp_AbCdEfGh',
    scopes: ['tasks:read', 'tasks:create'],
    timezone: 'Asia/Tokyo',
    expiresAt: '2027-02-13T01:00:00+00:00',
};
const fakeDb = { marker: 'fake-db' } as unknown as McpDb;
const TOOLS_LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

let token: string;

function authenticateAs(outcome: McpAuthOutcome) {
    dbModule.authenticateMcpTokenHash.mockResolvedValue(outcome);
}

type PostOptions = {
    headers?: Record<string, string | null>;
    body?: BodyInit | null;
    bearer?: string | null;
};

function post(message: unknown, options: PostOptions = {}): Promise<Response> {
    const headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
    });
    const bearer = options.bearer === undefined ? token : options.bearer;
    if (bearer !== null) {
        headers.set('authorization', `Bearer ${bearer}`);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (value === null) {
            headers.delete(name);
        } else {
            headers.set(name, value);
        }
    }
    const body = options.body === undefined ? JSON.stringify(message) : options.body;
    const init = { method: 'POST', headers, body, duplex: 'half' } as RequestInit;
    return POST(new Request(URL_, init));
}

async function expectHttpError(response: Response, status: number, code: McpHttpErrorCode) {
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32001, message: MCP_HTTP_ERRORS[code].message, data: { code } },
        id: null,
    });
}

function expectNoDatabaseCall() {
    expect(dbModule.authenticateMcpTokenHash).not.toHaveBeenCalled();
    expect(dbModule.createMcpDb).not.toHaveBeenCalled();
}

beforeEach(() => {
    token = generateMcpToken().token;
    dbModule.authenticateMcpTokenHash.mockReset();
    dbModule.createMcpDb.mockReset();
    dbModule.createMcpDb.mockReturnValue(fakeDb);
    factory.override = null;
    factory.contexts = [];
    authenticateAs({ status: 'ok', auth: AUTH });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('POST /api/mcp: protocol', () => {
    it('answers initialize with the server info and the tools capability only', async () => {
        const response = await post({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('mcp-session-id')).toBeNull();
        const body = await response.json();
        expect(body.result.serverInfo).toEqual({ name: 'taskel-mcp-server', version: '1.0.0' });
        expect(body.result.capabilities).toEqual({ tools: {} });
    });

    it('answers a request without a prior initialize (stateless)', async () => {
        const response = await post(TOOLS_LIST);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    });

    it('answers tools/call for an unknown tool with the tool error envelope', async () => {
        const response = await post({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: { name: 'taskel_delete_everything', arguments: {} },
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe(7);
        expect(body.result.isError).toBe(true);
        expect(body.result.structuredContent).toEqual({
            ok: false,
            error: { code: 'TOOL_UNKNOWN', message: 'Unknown tool.', retryable: false },
        });
    });

    it('accepts a notification with 202', async () => {
        const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(response.status).toBe(202);
    });

    it('authenticates with the SHA-256 of the token and binds the database to that token', async () => {
        await post(TOOLS_LIST, { headers: { 'x-taskel-request-id': 'beacon-call-1' } });

        expect(dbModule.authenticateMcpTokenHash).toHaveBeenCalledTimes(1);
        expect(dbModule.authenticateMcpTokenHash).toHaveBeenCalledWith(hashMcpToken(token));
        expect(dbModule.createMcpDb).toHaveBeenCalledTimes(1);
        expect(dbModule.createMcpDb).toHaveBeenCalledWith({
            userId: AUTH.userId,
            tokenId: AUTH.tokenId,
            requestId: 'beacon-call-1',
        });
        expect(factory.contexts).toHaveLength(1);
        const ctx = factory.contexts[0] as McpContext;
        expect(ctx).toMatchObject({ ...AUTH, requestId: 'beacon-call-1' });
        expect(ctx.db).toBe(fakeDb);
        expect(JSON.stringify(ctx)).not.toContain(token);
    });

    it('replaces an unsafe request id with a UUID', async () => {
        await post(TOOLS_LIST, { headers: { 'x-taskel-request-id': 'bad id; drop' } });
        const { requestId } = dbModule.createMcpDb.mock.calls[0][0] as { requestId: string };
        expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('does not hand the Authorization header or cookies to tool handlers', async () => {
        let seen: Record<string, unknown> | undefined;
        factory.override = () => {
            const server = new Server({ name: 'probe', version: '0' }, { capabilities: { tools: {} } });
            server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
                seen = extra.requestInfo?.headers as Record<string, unknown> | undefined;
                return { content: [{ type: 'text', text: 'ok' }] };
            });
            return server;
        };

        const response = await post(
            { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'probe', arguments: {} } },
            { headers: { cookie: 'sb-access-token=session-value', 'x-custom': 'value' } }
        );

        expect(response.status).toBe(200);
        expect(seen).toBeDefined();
        expect(Object.keys(seen ?? {}).sort()).toEqual(['accept', 'content-type']);
        expect(JSON.stringify(seen)).not.toContain(token);
        expect(JSON.stringify(seen)).not.toContain('session-value');
    });

    it('sends no CORS headers', async () => {
        const responses = [
            await post(TOOLS_LIST, { headers: { origin: 'https://evil.example' } }),
            await post(TOOLS_LIST, { bearer: null, headers: { origin: 'https://evil.example' } }),
        ];
        for (const response of responses) {
            for (const name of response.headers.keys()) {
                expect(name.toLowerCase()).not.toContain('access-control');
            }
        }
    });
});

describe('POST /api/mcp: authentication', () => {
    it('401 MCP_UNAUTHORIZED without a bearer token, and no database call', async () => {
        const response = await post(TOOLS_LIST, { bearer: null });
        expect(response.headers.get('www-authenticate')).toBe('Bearer realm="taskel-mcp"');
        await expectHttpError(response, 401, 'MCP_UNAUTHORIZED');
        expectNoDatabaseCall();
    });

    it('never falls back to a cookie session', async () => {
        const response = await post(TOOLS_LIST, {
            bearer: null,
            headers: { cookie: `sb-localhost-auth-token=${token}; sb-access-token=${token}` },
        });
        await expectHttpError(response, 401, 'MCP_UNAUTHORIZED');
        expectNoDatabaseCall();

        const source = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');
        expect(source).not.toMatch(/cookies\s*\(|next\/headers|supabase\/server|Access-Control/);
    });

    it('401 MCP_TOKEN_INVALID for a malformed token, and no database call', async () => {
        for (const bad of [token.slice(0, -1), `${token}x`, token.replace('tsk_mcp_', 'tsk_pat_'), 'abc']) {
            const response = await post(TOOLS_LIST, { bearer: bad });
            expect(response.headers.get('www-authenticate')).toBe('Bearer realm="taskel-mcp"');
            await expectHttpError(response, 401, 'MCP_TOKEN_INVALID');
        }
        expectNoDatabaseCall();
    });

    it('401 MCP_TOKEN_INVALID for an unknown token: one read, nothing else, prefix-only log', async () => {
        authenticateAs({ status: 'unknown' });
        const response = await post(TOOLS_LIST);

        await expectHttpError(response, 401, 'MCP_TOKEN_INVALID');
        expect(dbModule.authenticateMcpTokenHash).toHaveBeenCalledTimes(1);
        expect(dbModule.createMcpDb).not.toHaveBeenCalled();
        expect(factory.contexts).toHaveLength(0);

        const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
        expect(logged).toContain(token.slice(0, 16));
        expect(logged).not.toContain(token.slice(16));
        expect(logged).not.toContain(hashMcpToken(token));
    });

    it('401 MCP_TOKEN_REVOKED and MCP_TOKEN_EXPIRED', async () => {
        authenticateAs({ status: 'revoked' });
        let response = await post(TOOLS_LIST);
        expect(response.headers.get('www-authenticate')).toBe('Bearer realm="taskel-mcp"');
        await expectHttpError(response, 401, 'MCP_TOKEN_REVOKED');

        authenticateAs({ status: 'expired' });
        response = await post(TOOLS_LIST);
        await expectHttpError(response, 401, 'MCP_TOKEN_EXPIRED');

        expect(dbModule.createMcpDb).not.toHaveBeenCalled();
        expect(factory.contexts).toHaveLength(0);
    });

    it('a revoked token is refused on the very next request', async () => {
        expect((await post(TOOLS_LIST)).status).toBe(200);
        authenticateAs({ status: 'revoked' });
        await expectHttpError(await post(TOOLS_LIST), 401, 'MCP_TOKEN_REVOKED');
        // No cache: every request asks the database.
        expect(dbModule.authenticateMcpTokenHash).toHaveBeenCalledTimes(2);
    });

    it('429 MCP_RATE_LIMITED with Retry-After when the token is over its limit', async () => {
        authenticateAs({ status: 'rate_limited', retryAfterSeconds: 23 });
        const response = await post(TOOLS_LIST);
        expect(response.headers.get('retry-after')).toBe('23');
        await expectHttpError(response, 429, 'MCP_RATE_LIMITED');
        expect(dbModule.createMcpDb).not.toHaveBeenCalled();
    });

    it('429 MCP_RATE_LIMITED from the per-IP limiter after 120 requests in a minute', async () => {
        const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        for (let i = 0; i < 120; i += 1) {
            const response = await post(TOOLS_LIST, { bearer: null, headers: { 'x-forwarded-for': ip } });
            expect(response.status).toBe(401);
        }
        const limited = await post(TOOLS_LIST, { headers: { 'x-forwarded-for': ip } });
        expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        await expectHttpError(limited, 429, 'MCP_RATE_LIMITED');
        expectNoDatabaseCall();

        const other = await post(TOOLS_LIST, { headers: { 'x-forwarded-for': '198.51.100.7' } });
        expect(other.status).toBe(200);
    });

    it('503 MCP_NOT_READY while the migration is missing', async () => {
        authenticateAs({ status: 'not_ready' });
        await expectHttpError(await post(TOOLS_LIST), 503, 'MCP_NOT_READY');
        expect(dbModule.createMcpDb).not.toHaveBeenCalled();
    });
});

describe('POST /api/mcp: body', () => {
    it('400 MCP_BAD_REQUEST for invalid JSON', async () => {
        await expectHttpError(await post(null, { body: '{not json' }), 400, 'MCP_BAD_REQUEST');
        expectNoDatabaseCall();
    });

    it('400 MCP_BAD_REQUEST for JSON that is not a JSON-RPC message', async () => {
        for (const body of ['{"hello":"world"}', '"text"', 'null', '{"jsonrpc":"1.0","id":1,"method":"x"}']) {
            await expectHttpError(await post(null, { body }), 400, 'MCP_BAD_REQUEST');
        }
        expectNoDatabaseCall();
    });

    it('400 MCP_BATCH_UNSUPPORTED for an array body, and nothing runs', async () => {
        const create = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'taskel_create_task', arguments: { title: 'batched' } },
        };
        for (const batch of [[], [create], [create, { ...create, id: 2 }]]) {
            await expectHttpError(await post(batch), 400, 'MCP_BATCH_UNSUPPORTED');
        }
        expectNoDatabaseCall();
        expect(factory.contexts).toHaveLength(0);
    });

    it('415 for a content type other than application/json', async () => {
        await expectHttpError(
            await post(TOOLS_LIST, { headers: { 'content-type': 'text/plain' } }),
            415,
            'MCP_BAD_REQUEST'
        );
        expectNoDatabaseCall();
    });

    it('413 MCP_BODY_TOO_LARGE when Content-Length declares more than 65,536 bytes', async () => {
        const response = await post(TOOLS_LIST, { headers: { 'content-length': '65537' } });
        await expectHttpError(response, 413, 'MCP_BODY_TOO_LARGE');
        expectNoDatabaseCall();
    });

    it('413 MCP_BODY_TOO_LARGE for an oversized body with no Content-Length', async () => {
        const oversized = JSON.stringify({ ...TOOLS_LIST, params: { pad: 'x'.repeat(65_536) } });
        await expectHttpError(await post(null, { body: oversized }), 413, 'MCP_BODY_TOO_LARGE');

        let pulls = 0;
        let cancelled = false;
        const chunk = new TextEncoder().encode('x'.repeat(8_192));
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;
                if (pulls > 1_000) {
                    controller.close();
                    return;
                }
                controller.enqueue(chunk);
            },
            cancel() {
                cancelled = true;
            },
        });
        const response = await post(null, { body: stream });
        expect(response.headers.get('content-length')).toBeNull();
        await expectHttpError(response, 413, 'MCP_BODY_TOO_LARGE');
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThan(20);
        expectNoDatabaseCall();
    });

    it('accepts a body just under the limit', async () => {
        const base = JSON.stringify({ ...TOOLS_LIST, params: { _meta: { pad: '' } } });
        const body = JSON.stringify({ ...TOOLS_LIST, params: { _meta: { pad: 'x'.repeat(65_536 - base.length) } } });
        expect(new TextEncoder().encode(body).byteLength).toBe(65_536);
        expect((await post(null, { body })).status).toBe(200);
    });
});

describe('POST /api/mcp: failures and switches', () => {
    it('500 MCP_INTERNAL with a fixed message when authentication throws', async () => {
        dbModule.authenticateMcpTokenHash.mockRejectedValue(
            new Error(`connection to db.internal:5432 failed for ${token}`)
        );
        const response = await post(TOOLS_LIST);
        const text = await response.clone().text();
        await expectHttpError(response, 500, 'MCP_INTERNAL');
        expect(text).not.toContain('db.internal');
        expect(text).not.toContain(token);
    });

    it('500 MCP_INTERNAL with a fixed message when the server cannot be built', async () => {
        dbModule.createMcpDb.mockImplementation(() => {
            throw new Error('Missing required Supabase environment variable: SUPABASE_SERVICE_ROLE_KEY');
        });
        const response = await post(TOOLS_LIST);
        const text = await response.clone().text();
        await expectHttpError(response, 500, 'MCP_INTERNAL');
        expect(text).not.toContain('SUPABASE');

        factory.override = () => {
            throw new TypeError('factory exploded: secret detail');
        };
        dbModule.createMcpDb.mockReturnValue(fakeDb);
        const second = await post(TOOLS_LIST);
        const secondText = await second.clone().text();
        await expectHttpError(second, 500, 'MCP_INTERNAL');
        expect(secondText).not.toContain('secret detail');
    });

    it('every error response carries only fixed text', async () => {
        const marker = 'CALLER-SUPPLIED-MARKER';
        const responses = [
            await post(null, { body: `{"${marker}"` }),
            await post([{ marker }]),
            await post({ marker }),
            await post(TOOLS_LIST, { bearer: marker }),
            await post(TOOLS_LIST, { bearer: null, headers: { authorization: `Basic ${marker}` } }),
            await post(TOOLS_LIST, { headers: { 'content-type': marker } }),
        ];
        for (const response of responses) {
            expect(response.status).toBeGreaterThanOrEqual(400);
            expect(response.status).toBeLessThan(500);
            expect(await response.text()).not.toContain(marker);
        }
    });

    it('503 MCP_DISABLED when TASKEL_MCP_DISABLED is 1, before anything else', async () => {
        vi.stubEnv('TASKEL_MCP_DISABLED', '1');

        await expectHttpError(await post(TOOLS_LIST), 503, 'MCP_DISABLED');
        await expectHttpError(await post(TOOLS_LIST, { bearer: null }), 503, 'MCP_DISABLED');
        await expectHttpError(await GET(), 503, 'MCP_DISABLED');
        await expectHttpError(await DELETE(), 503, 'MCP_DISABLED');
        expectNoDatabaseCall();

        vi.stubEnv('TASKEL_MCP_DISABLED', 'true');
        expect((await post(TOOLS_LIST)).status).toBe(200);
    });
});

describe('GET and DELETE /api/mcp', () => {
    it('405 with Allow: POST', async () => {
        for (const response of [await GET(), await DELETE()]) {
            expect(response.status).toBe(405);
            expect(response.headers.get('allow')).toBe('POST');
            expect(await response.json()).toEqual({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Method not allowed.' },
                id: null,
            });
        }
        expectNoDatabaseCall();
    });
});
