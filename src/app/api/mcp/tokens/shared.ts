import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { ApiError } from '@/lib/api/errors';
import { McpDbError } from '@/lib/mcp/db';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function tokenJson(body: unknown, status = 200): NextResponse {
    return NextResponse.json(body, { status, headers: NO_STORE });
}

export function tokenError(status: number, code: string, message: string): NextResponse {
    return tokenJson({ error: message, code }, status);
}

/**
 * Refuses a browser request sent from another site. A same-origin fetch from
 * the app carries an Origin equal to the request's own; a request with no
 * Origin (not a browser cross-site call) is left to the session check.
 */
export function rejectCrossOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get('origin');
    if (origin === null) {
        return null;
    }
    let expected: string;
    try {
        expected = new URL(request.url).origin;
    } catch {
        return tokenError(403, 'FORBIDDEN', 'Forbidden');
    }
    return origin === expected ? null : tokenError(403, 'FORBIDDEN', 'Forbidden');
}

/** Every failure answers with fixed text. Nothing the caller sent is echoed. */
export function tokenRouteError(context: string, error: unknown): NextResponse {
    if (error instanceof ZodError) {
        return tokenError(400, 'INVALID_INPUT', 'Invalid request data');
    }
    if (error instanceof ApiError) {
        return tokenError(error.status, error.status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST', error.message);
    }
    if (error instanceof McpDbError && error.kind === 'not_ready') {
        return tokenError(503, 'MCP_NOT_READY', 'MCP server is not ready.');
    }
    console.error(`${context}:`, error);
    return tokenError(500, 'INTERNAL_ERROR', 'Internal Server Error');
}
