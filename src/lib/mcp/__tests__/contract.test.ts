import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCP_TOOL_ERROR_CODES, mcpHttpError, mcpMethodNotAllowed, type McpHttpErrorCode } from '@/lib/mcp/errors';
import { MCP_TOOL_NAMES, MCP_TOOL_SCOPES, type McpToolName } from '@/lib/mcp/scopes';
import { toolFailure } from '@/lib/mcp/tools/shared';
import { generateMcpToken } from '@/lib/mcp/token';

import { FIXTURE_AUTH, FIXTURE_NOW, createFixtureDb } from './fixtureDb';

const dbModule = vi.hoisted(() => ({
    authenticateMcpTokenHash: vi.fn(),
    createMcpDb: vi.fn(),
}));

vi.mock('@/lib/mcp/db', () => dbModule);

import { DELETE, GET, POST } from '@/app/api/mcp/route';

const CONTRACT_PATH = fileURLToPath(new URL('../../../../contracts/taskel-mcp.v1.json', import.meta.url));

type HttpExample = {
    layer: 'http';
    status: number;
    code: string | null;
    headers?: Record<string, string>;
    body: unknown;
};

type ToolExample = {
    layer: 'tool';
    code: string;
    result: unknown;
};

type Contract = {
    tools: {
        name: string;
        scope: string | null;
        inputSchema: unknown;
        example: { request: Record<string, unknown>; data: unknown };
    }[];
    errors: (HttpExample | ToolExample)[];
};

const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as Contract;

const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'proxy-connection',
    'te',
    'trailer',
    'host',
    'content-length',
]);

let server: http.Server;
let port = 0;
let token = '';
let client: Client;
let transport: StreamableHTTPClientTransport;

function installDbMocks() {
    dbModule.authenticateMcpTokenHash.mockReset();
    dbModule.createMcpDb.mockReset();
    dbModule.authenticateMcpTokenHash.mockResolvedValue({ status: 'ok', auth: FIXTURE_AUTH });
    dbModule.createMcpDb.mockReturnValue(createFixtureDb());
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function headersFromNode(req: http.IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                headers.append(name, item);
            }
        } else {
            headers.set(name, value);
        }
    }
    return headers;
}

async function writeWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
    const body = Buffer.from(await response.arrayBuffer());
    const headers: http.OutgoingHttpHeaders = {};
    response.headers.forEach((value, key) => {
        if (key === 'transfer-encoding' || key === 'content-length' || key === 'connection') {
            return;
        }
        headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(body);
}

async function handleNodeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const raw = await readRawBody(req);
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const request = new Request(`http://127.0.0.1:${port}${req.url ?? '/'}`, {
        method,
        headers: headersFromNode(req),
        body: hasBody ? Uint8Array.from(raw) : undefined,
        ...(hasBody ? { duplex: 'half' as const } : {}),
    });

    let response: Response;
    if (method === 'GET') {
        response = await GET();
    } else if (method === 'DELETE') {
        response = await DELETE();
    } else {
        response = await POST(request);
    }
    await writeWebResponse(res, response);
}

function isHttpExample(entry: HttpExample | ToolExample): entry is HttpExample {
    return entry.layer === 'http';
}

function isToolExample(entry: HttpExample | ToolExample): entry is ToolExample {
    return entry.layer === 'tool';
}

function isToolName(name: string): name is McpToolName {
    return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}

beforeAll(async () => {
    token = generateMcpToken().token;
    installDbMocks();
    server = http.createServer((req, res) => {
        handleNodeRequest(req, res).catch((error: unknown) => {
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            }
            res.end(error instanceof Error ? error.message : 'request failed');
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeAllListeners('error');
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('MCP test server has no port');
    }
    port = address.port;

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXTURE_NOW);

    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
});

beforeEach(() => {
    installDbMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXTURE_NOW);
});

afterAll(async () => {
    await client?.close().catch(() => undefined);
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
    vi.useRealTimers();
});

describe('C1', () => {
    it('lists the contract tools through the SDK client', async () => {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }))).toEqual(
            contract.tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }))
        );
    });

    it('returns each contract example through the SDK client', async () => {
        for (const tool of contract.tools) {
            const result = await client.callTool({ name: tool.name, arguments: tool.example.request });
            expect(result.structuredContent).toEqual({ ok: true, data: tool.example.data });
        }
    });

    it('records the tool scopes and names from the server', () => {
        expect(contract.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
        for (const tool of contract.tools) {
            expect(isToolName(tool.name)).toBe(true);
            if (isToolName(tool.name)) {
                expect(tool.scope).toBe(MCP_TOOL_SCOPES[tool.name]);
            }
        }
    });

    it('answers tools/call with no initialize from a raw client', async () => {
        const listTool = contract.tools.find((tool) => tool.name === 'taskel_list_tasks_for_day');
        expect(listTool).toBeDefined();
        const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'taskel_list_tasks_for_day', arguments: { date: '2026-11-15' } },
            }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        const body = (await response.json()) as { result: { structuredContent: unknown } };
        expect(body.result.structuredContent).toEqual({ ok: true, data: listTool?.example.data });
    });

    it('matches every HTTP error example', async () => {
        for (const entry of contract.errors.filter(isHttpExample)) {
            if (entry.code === null) {
                const response = mcpMethodNotAllowed();
                expect(response.status).toBe(entry.status);
                expect(response.headers.get('allow')).toBe('POST');
                expect(await response.json()).toEqual(entry.body);
                continue;
            }
            const response = mcpHttpError(entry.code as McpHttpErrorCode, entry.status === 415 ? { status: 415 } : {});
            expect(response.status).toBe(entry.status);
            for (const [name, value] of Object.entries(entry.headers ?? {})) {
                expect(response.headers.get(name)).toBe(value);
            }
            // The headers a client acts on are part of the example whenever the response has them.
            expect(response.headers.has('www-authenticate')).toBe(entry.headers?.['WWW-Authenticate'] !== undefined);
            expect(response.headers.has('retry-after')).toBe(entry.headers?.['Retry-After'] !== undefined);
            expect(await response.json()).toEqual(entry.body);
        }

        const raw = await fetch(`http://127.0.0.1:${port}/api/mcp`);
        expect(raw.status).toBe(405);
        expect(raw.headers.get('allow')).toBe('POST');
    });

    it('matches every tool error example', () => {
        const toolErrors = contract.errors.filter(isToolExample);
        expect(new Set(toolErrors.map((entry) => entry.code))).toEqual(new Set(MCP_TOOL_ERROR_CODES));
        expect(toolErrors).toHaveLength(MCP_TOOL_ERROR_CODES.length);
        for (const entry of toolErrors) {
            expect((MCP_TOOL_ERROR_CODES as readonly string[]).includes(entry.code)).toBe(true);
            if ((MCP_TOOL_ERROR_CODES as readonly string[]).includes(entry.code)) {
                expect(entry.result).toEqual(toolFailure(entry.code as (typeof MCP_TOOL_ERROR_CODES)[number]));
            }
        }
    });

    it('returns the contract MCP_UNAUTHORIZED body when Authorization is missing', async () => {
        const unauthorized = contract.errors.find(
            (entry): entry is HttpExample => entry.layer === 'http' && entry.code === 'MCP_UNAUTHORIZED'
        );
        expect(unauthorized).toBeDefined();
        const response = await fetch(`http://127.0.0.1:${port}/api/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual(unauthorized?.body);
    });
});
