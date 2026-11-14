import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { McpContext } from '@/lib/mcp/auth';
import { mcpToolFailure } from '@/lib/mcp/errors';

export const TASKEL_MCP_SERVER_INFO = { name: 'taskel-mcp-server', version: '1.0.0' } as const;

/**
 * One server per request, bound to the authenticated token.
 *
 * Placeholder until the tool handlers land: it lists no tools and answers
 * every call with TOOL_UNKNOWN.
 */
export function createTaskelMcpServer(ctx: McpContext): Server {
    void ctx;

    const server = new Server(TASKEL_MCP_SERVER_INFO, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    server.setRequestHandler(CallToolRequestSchema, async () => mcpToolFailure('TOOL_UNKNOWN', 'Unknown tool.'));

    return server;
}
