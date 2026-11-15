import { randomUUID } from 'node:crypto';

import type { McpAuth, McpDb } from '@/lib/mcp/db';
import type { McpHttpErrorCode } from '@/lib/mcp/errors';
import { isMcpTokenShape } from '@/lib/mcp/token';

/**
 * What a tool handler receives. `db` is already bound to this user and token;
 * its methods take no user id.
 */
export type McpContext = McpAuth & {
    requestId: string;
    db: McpDb;
};

export type BearerResult = { ok: true; token: string } | { ok: false; code: McpHttpErrorCode };

/**
 * Reads the bearer token from the Authorization header and checks its shape.
 * No database call: a malformed token is refused here. Cookies are never read.
 */
export function readBearerToken(request: Request): BearerResult {
    const header = request.headers.get('authorization');
    if (!header) {
        return { ok: false, code: 'MCP_UNAUTHORIZED' };
    }

    const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
    if (!match) {
        return { ok: false, code: 'MCP_UNAUTHORIZED' };
    }

    if (!isMcpTokenShape(match[1])) {
        return { ok: false, code: 'MCP_TOKEN_INVALID' };
    }

    return { ok: true, token: match[1] };
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The caller's `x-taskel-request-id` when it is a plain id, otherwise a new UUID. */
export function resolveRequestId(request: Request): string {
    const header = request.headers.get('x-taskel-request-id');
    return header !== null && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

export function buildMcpContext(auth: McpAuth, requestId: string, db: McpDb): McpContext {
    return Object.freeze({ ...auth, scopes: [...auth.scopes], requestId, db });
}
