import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

import { applyRateLimit } from '@/lib/api/rateLimit';
import { buildMcpContext, readBearerToken, resolveRequestId } from '@/lib/mcp/auth';
import { readMcpJsonBody } from '@/lib/mcp/body';
import { authenticateMcpTokenHash, createMcpDb } from '@/lib/mcp/db';
import { mcpHttpError, mcpMethodNotAllowed } from '@/lib/mcp/errors';
import { createTaskelMcpServer } from '@/lib/mcp/serverFactory';
import { hashMcpToken, mcpTokenPrefix } from '@/lib/mcp/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stateless Streamable HTTP MCP endpoint: one JSON-RPC message per POST,
 * authenticated by a personal access token. It never reads cookies and sends
 * no CORS headers.
 */

function isDisabled(): boolean {
    return process.env.TASKEL_MCP_DISABLED === '1';
}

/**
 * The request handed to the MCP transport. The transport exposes request
 * headers to tool handlers, so the Authorization header (and anything else
 * the caller sent) is left behind here.
 */
function transportRequest(request: Request): Request {
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'mcp-protocol-version']) {
        const value = request.headers.get(name);
        if (value !== null) {
            headers.set(name, value);
        }
    }
    return new Request(request.url, { method: 'POST', headers });
}

export async function POST(request: Request): Promise<Response> {
    if (isDisabled()) {
        return mcpHttpError('MCP_DISABLED');
    }

    try {
        const limited = applyRateLimit(request, { key: 'mcp', limit: 120, windowMs: 60_000 });
        if (limited) {
            return mcpHttpError('MCP_RATE_LIMITED', {
                retryAfterSeconds: Number(limited.headers.get('Retry-After')),
            });
        }

        const bearer = readBearerToken(request);
        if (!bearer.ok) {
            return mcpHttpError(bearer.code);
        }

        const body = await readMcpJsonBody(request);
        if (!body.ok) {
            return mcpHttpError(body.code, { status: body.status });
        }
        if (!JSONRPCMessageSchema.safeParse(body.value).success) {
            return mcpHttpError('MCP_BAD_REQUEST');
        }

        const outcome = await authenticateMcpTokenHash(hashMcpToken(bearer.token));
        switch (outcome.status) {
            case 'ok':
                break;
            case 'not_ready':
                return mcpHttpError('MCP_NOT_READY');
            case 'unknown':
                console.warn('[mcp] unknown token', mcpTokenPrefix(bearer.token));
                return mcpHttpError('MCP_TOKEN_INVALID');
            case 'revoked':
                return mcpHttpError('MCP_TOKEN_REVOKED');
            case 'expired':
                return mcpHttpError('MCP_TOKEN_EXPIRED');
            case 'rate_limited':
                return mcpHttpError('MCP_RATE_LIMITED', { retryAfterSeconds: outcome.retryAfterSeconds });
        }

        const requestId = resolveRequestId(request);
        const db = createMcpDb({ userId: outcome.auth.userId, tokenId: outcome.auth.tokenId, requestId });
        const server = createTaskelMcpServer(buildMcpContext(outcome.auth, requestId, db));
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        try {
            await server.connect(transport);
            return await transport.handleRequest(transportRequest(request), { parsedBody: body.value });
        } finally {
            await server.close().catch(() => undefined);
        }
    } catch (error) {
        // The response carries a fixed message; the cause stays in the server log.
        console.error('[mcp] request failed', error);
        return mcpHttpError('MCP_INTERNAL');
    }
}

export async function GET(): Promise<Response> {
    return isDisabled() ? mcpHttpError('MCP_DISABLED') : mcpMethodNotAllowed();
}

export async function DELETE(): Promise<Response> {
    return isDisabled() ? mcpHttpError('MCP_DISABLED') : mcpMethodNotAllowed();
}
