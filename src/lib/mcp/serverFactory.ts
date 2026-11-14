import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { McpContext } from '@/lib/mcp/auth';
import { McpDbError } from '@/lib/mcp/db';
import type { McpToolErrorCode, McpToolResult } from '@/lib/mcp/errors';
import { canCallTool, isMcpToolName, toolsForScopes } from '@/lib/mcp/scopes';
import { MCP_TOOLS } from '@/lib/mcp/tools';
import { toolFailure } from '@/lib/mcp/tools/shared';
import { TASKEL_MCP_SERVER_INFO } from '@/lib/mcp/tools/whoami';

export { TASKEL_MCP_SERVER_INFO };

const TOOL_NAME_SHAPE = /^[A-Za-z0-9_]{1,64}$/;

/** A denial is still answered when its audit row cannot be written. */
async function logDenial(ctx: McpContext, tool: unknown, code: 'SCOPE_FORBIDDEN' | 'TOOL_UNKNOWN'): Promise<void> {
    try {
        await ctx.db.logEvent(typeof tool === 'string' && TOOL_NAME_SHAPE.test(tool) ? tool : null, code);
    } catch (error) {
        console.error('[mcp] could not record a denial', error);
    }
}

function failureFor(error: unknown): McpToolErrorCode {
    // The scope is checked again in SQL; this is that check answering.
    return error instanceof McpDbError && error.kind === 'scope_forbidden' ? 'SCOPE_FORBIDDEN' : 'INTERNAL_ERROR';
}

/** Runs one tool call for the token in `ctx`. Never throws; failures carry fixed text. */
export async function callTaskelMcpTool(ctx: McpContext, name: unknown, args: unknown): Promise<McpToolResult> {
    if (!isMcpToolName(name)) {
        await logDenial(ctx, name, 'TOOL_UNKNOWN');
        return toolFailure('TOOL_UNKNOWN');
    }
    if (!canCallTool(ctx.scopes, name)) {
        await logDenial(ctx, name, 'SCOPE_FORBIDDEN');
        return toolFailure('SCOPE_FORBIDDEN');
    }

    try {
        return await MCP_TOOLS[name].handle(args ?? {}, ctx);
    } catch (error) {
        // The cause stays in the server log; the caller gets a fixed message.
        console.error('[mcp] tool failed', name, error);
        return toolFailure(failureFor(error));
    }
}

/**
 * One server per request, bound to the authenticated token. `tools/list`
 * shows only the tools the token's scopes allow; `tools/call` checks the
 * scope again before the handler runs.
 */
export function createTaskelMcpServer(ctx: McpContext): Server {
    const server = new Server(TASKEL_MCP_SERVER_INFO, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: toolsForScopes(ctx.scopes).map((name) => MCP_TOOLS[name].definition),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) =>
        callTaskelMcpTool(ctx, request.params.name, request.params.arguments)
    );

    return server;
}
