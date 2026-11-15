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

function firstHeaderValue(request: Request, name: string): string | null {
    const value = request.headers.get(name)?.split(',')[0]?.trim();
    return value ? value : null;
}

/**
 * The origin the browser reached. Next builds `request.url` from the address
 * the server is bound to (`-H` host and port), not from the Host the browser
 * used, so a page on http://localhost:3210 served by a server bound to
 * 127.0.0.1:3210, or a page behind a TLS proxy, would never match it. A
 * browser cannot set Host or X-Forwarded-* on a cross-site fetch without a
 * preflight this route never answers.
 */
function browserOrigin(request: Request): string {
    const url = new URL(request.url);
    const host = firstHeaderValue(request, 'x-forwarded-host') ?? firstHeaderValue(request, 'host') ?? url.host;
    const proto = firstHeaderValue(request, 'x-forwarded-proto') ?? url.protocol.replace(/:$/, '');
    return new URL(`${proto}://${host}`).origin;
}

/**
 * Refuses a browser request sent from another site. A same-origin fetch from
 * the app carries an Origin equal to the one the browser reached; a request
 * with no Origin (not a browser cross-site call) is left to the session check.
 */
export function rejectCrossOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get('origin');
    if (origin === null) {
        return null;
    }
    try {
        if (new URL(origin).origin === browserOrigin(request)) {
            return null;
        }
    } catch {
        // An unparsable Origin, Host or protocol is refused below.
    }
    return tokenError(403, 'FORBIDDEN', 'Forbidden');
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
