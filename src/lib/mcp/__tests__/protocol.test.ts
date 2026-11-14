import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpContext } from '@/lib/mcp/auth';
import { MCP_TOOL_NAMES, type McpScope } from '@/lib/mcp/scopes';
import { createTaskelMcpServer } from '@/lib/mcp/serverFactory';
import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';

import { FIXTURE_NOW, FIXTURE_ROUTINE_REPORT_ID, createFixtureContext } from './fixtureDb';

type ToolCallResult = Awaited<ReturnType<Client['callTool']>>;

type AnsweredToolResult = {
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
};

type ContractTool = {
    name: string;
    example: { request: Record<string, unknown>; data: unknown };
};

const contract = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../../contracts/taskel-mcp.v1.json', import.meta.url)), 'utf8')
) as { tools: ContractTool[] };

const READ_ONLY_TOOLS = [
    'taskel_whoami',
    'taskel_list_tasks_for_day',
    'taskel_search_tasks',
    'taskel_get_task',
] as const;

function answered(result: ToolCallResult): AnsweredToolResult {
    if (!('content' in result) || !Array.isArray(result.content) || !('structuredContent' in result)) {
        throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
    }
    return result as AnsweredToolResult;
}

async function withServer(ctx: McpContext, run: (client: Client) => Promise<void>): Promise<void> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createTaskelMcpServer(ctx);
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientTransport);
    try {
        await run(client);
    } finally {
        await client.close();
        await server.close();
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXTURE_NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('taskel MCP protocol', () => {
    it.each([
        {
            scopes: ['tasks:read', 'tasks:create'] as McpScope[],
            names: [...MCP_TOOL_NAMES],
        },
        {
            scopes: ['tasks:read'] as McpScope[],
            names: [
                'taskel_whoami',
                'taskel_list_tasks_for_day',
                'taskel_search_tasks',
                'taskel_get_task',
                'taskel_revoke_current_token',
            ],
        },
        {
            scopes: ['tasks:create'] as McpScope[],
            names: ['taskel_whoami', 'taskel_create_task', 'taskel_revoke_current_token'],
        },
    ])('lists the tools for scopes $scopes', async ({ scopes, names }) => {
        const { ctx } = createFixtureContext(scopes);
        await withServer(ctx, async (client) => {
            const { tools } = await client.listTools();
            expect(tools.map((tool) => tool.name)).toEqual(names);
        });
    });

    it('publishes object schemas, descriptions, and read-only hints', async () => {
        const { ctx } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const { tools } = await client.listTools();
            expect(tools).toHaveLength(MCP_TOOL_NAMES.length);
            for (const tool of tools) {
                expect(tool.inputSchema.type).toBe('object');
                expect(tool.inputSchema.additionalProperties).toBe(false);
                expect(tool.description?.length).toBeGreaterThan(0);
            }
            for (const name of READ_ONLY_TOOLS) {
                const tool = tools.find((item) => item.name === name);
                expect(tool?.annotations?.readOnlyHint).toBe(true);
            }
        });
    });

    it('returns SCOPE_FORBIDDEN for create without tasks:create and does not write', async () => {
        const { ctx, db } = createFixtureContext(['tasks:read']);
        await withServer(ctx, async (client) => {
            const result = answered(
                await client.callTool({ name: 'taskel_create_task', arguments: { title: 'x' } })
            );
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toEqual({
                ok: false,
                error: {
                    code: 'SCOPE_FORBIDDEN',
                    message: expect.any(String),
                    retryable: false,
                },
            });
            expect(db.calls).toContainEqual({
                method: 'logEvent',
                args: ['taskel_create_task', 'SCOPE_FORBIDDEN'],
            });
            expect(db.calls.some((call) => call.method === 'createTask' || call.method === 'sectionsForCreate')).toBe(
                false
            );
        });
    });

    it('returns SCOPE_FORBIDDEN for list without tasks:read and does not read the day', async () => {
        const { ctx, db } = createFixtureContext(['tasks:create']);
        await withServer(ctx, async (client) => {
            const result = answered(
                await client.callTool({ name: 'taskel_list_tasks_for_day', arguments: { date: '2026-11-15' } })
            );
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                ok: false,
                error: { code: 'SCOPE_FORBIDDEN', message: expect.any(String), retryable: false },
            });
            expect(db.calls).toContainEqual({
                method: 'logEvent',
                args: ['taskel_list_tasks_for_day', 'SCOPE_FORBIDDEN'],
            });
            expect(db.calls.some((call) => call.method === 'daySnapshot')).toBe(false);
        });
    });

    it('returns TOOL_UNKNOWN for a tool this server does not have', async () => {
        const { ctx, db } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const result = answered(await client.callTool({ name: 'taskel_delete_task', arguments: {} }));
            expect(result.structuredContent).toMatchObject({
                ok: false,
                error: { code: 'TOOL_UNKNOWN' },
            });
            expect(db.calls).toContainEqual({ method: 'logEvent', args: ['taskel_delete_task', 'TOOL_UNKNOWN'] });
        });
    });

    it('returns the contract example for each tool', async () => {
        const { ctx } = createFixtureContext();
        await withServer(ctx, async (client) => {
            for (const tool of contract.tools) {
                const result = answered(await client.callTool({ name: tool.name, arguments: tool.example.request }));
                expect(result.isError).toBeFalsy();
                expect(result.structuredContent).toEqual({ ok: true, data: tool.example.data });
                expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
            }
        });
    });

    it('lists the fixture day as stored tasks plus the untouched routine', async () => {
        const { ctx } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const result = answered(
                await client.callTool({
                    name: 'taskel_list_tasks_for_day',
                    arguments: { date: '2026-11-15' },
                })
            );
            const data = (result.structuredContent as { data: Record<string, unknown> }).data;
            expect(data.tasks).toEqual([
                expect.objectContaining({
                    title: '朝のストレッチ',
                    status: 'done',
                    is_routine: true,
                    is_virtual: false,
                }),
                expect.objectContaining({ title: '請求書を送る', status: 'open', is_routine: false, is_virtual: false }),
                expect.objectContaining({
                    id: createVirtualRoutineTaskId(FIXTURE_ROUTINE_REPORT_ID, '2026-11-15'),
                    title: '日報',
                    status: 'open',
                    is_routine: true,
                    is_virtual: true,
                }),
            ]);
            expect(data.hidden_shared_count).toBe(1);
            expect(data.summary).toEqual({
                total: 3,
                open: 2,
                in_progress: 0,
                done: 1,
                estimated_minutes_total: 75,
                estimated_minutes_remaining: 45,
                actual_minutes_total: 32,
            });
        });
    });

    it('returns the NOT_FOUND envelope for an unknown task id', async () => {
        const { ctx } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const result = answered(
                await client.callTool({
                    name: 'taskel_get_task',
                    arguments: { id: 'aaaaaaaa-0000-4000-8000-000000000099' },
                })
            );
            expect(result.isError).toBe(true);
            const error = (result.structuredContent as { error: { message: string; retryable: boolean } }).error;
            expect(result.content[0]).toMatchObject({ type: 'text', text: `[NOT_FOUND] ${error.message}` });
            expect(error.retryable).toBe(false);
        });
    });

    it.each([
        { title: 'x', id: 'aaaaaaaa-0000-4000-8000-000000000099' },
        { title: 'x', project_id: 'aaaaaaaa-0000-4000-8000-000000000098' },
        { title: 'x', section_id: 'aaaaaaaa-0000-4000-8000-000000000097' },
        { title: 'x', user_id: 'aaaaaaaa-0000-4000-8000-000000000096' },
        { title: 'x', status: 'done' },
    ])('rejects extra create properties %#', async (args) => {
        const { ctx, db } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const result = answered(await client.callTool({ name: 'taskel_create_task', arguments: args }));
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                ok: false,
                error: { code: 'INVALID_INPUT' },
            });
            expect(db.calls.some((call) => call.method === 'createTask')).toBe(false);
        });
    });

    it('hides a thrown database error behind INTERNAL_ERROR', async () => {
        const { ctx, db } = createFixtureContext();
        db.search = () => Promise.reject(new Error('relation "secret_table" does not exist'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await withServer(ctx, async (client) => {
            const result = answered(
                await client.callTool({
                    name: 'taskel_search_tasks',
                    arguments: { query: '請求書', range: 'last_week' },
                })
            );
            expect(result.isError).toBe(true);
            expect(result.structuredContent).toMatchObject({
                ok: false,
                error: { code: 'INTERNAL_ERROR', retryable: true },
            });
            expect(JSON.stringify(result)).not.toContain('secret_table');
        });
    });

    it('answers whoami without a database call', async () => {
        const { ctx, db } = createFixtureContext();
        await withServer(ctx, async (client) => {
            const result = answered(await client.callTool({ name: 'taskel_whoami', arguments: {} }));
            expect(result.isError).toBeFalsy();
            expect(db.calls).toEqual([]);
        });
    });
});
