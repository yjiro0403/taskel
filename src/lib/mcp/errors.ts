/**
 * Error shapes of the MCP endpoint. Every message is fixed text: nothing a
 * caller sent and nothing an exception said is ever echoed back.
 */

export const MCP_HTTP_ERRORS = {
    MCP_BAD_REQUEST: { status: 400, message: 'Bad request.' },
    MCP_BATCH_UNSUPPORTED: { status: 400, message: 'Batch requests are not supported.' },
    MCP_UNAUTHORIZED: { status: 401, message: 'Authentication required.' },
    MCP_TOKEN_INVALID: { status: 401, message: 'Invalid token.' },
    MCP_TOKEN_REVOKED: { status: 401, message: 'Token revoked.' },
    MCP_TOKEN_EXPIRED: { status: 401, message: 'Token expired.' },
    MCP_BODY_TOO_LARGE: { status: 413, message: 'Request body too large.' },
    MCP_RATE_LIMITED: { status: 429, message: 'Too many requests.' },
    MCP_INTERNAL: { status: 500, message: 'Internal error.' },
    MCP_NOT_READY: { status: 503, message: 'MCP server is not ready.' },
    MCP_DISABLED: { status: 503, message: 'MCP server is disabled.' },
} as const;

export type McpHttpErrorCode = keyof typeof MCP_HTTP_ERRORS;

const JSON_RPC_SERVER_ERROR = -32001;
const WWW_AUTHENTICATE = 'Bearer realm="taskel-mcp"';

type HttpErrorOptions = {
    /** Overrides the default status of the code (415 uses MCP_BAD_REQUEST). */
    status?: number;
    retryAfterSeconds?: number;
};

function jsonRpcErrorResponse(
    status: number,
    message: string,
    code: McpHttpErrorCode | null,
    headers: Record<string, string>
): Response {
    return new Response(
        JSON.stringify({
            jsonrpc: '2.0',
            error: {
                code: JSON_RPC_SERVER_ERROR,
                message,
                ...(code ? { data: { code } } : {}),
            },
            id: null,
        }),
        {
            status,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                ...headers,
            },
        }
    );
}

export function mcpHttpError(code: McpHttpErrorCode, options: HttpErrorOptions = {}): Response {
    const spec = MCP_HTTP_ERRORS[code];
    const status = options.status ?? spec.status;
    const headers: Record<string, string> = {};

    if (status === 401) {
        headers['WWW-Authenticate'] = WWW_AUTHENTICATE;
    }
    if (code === 'MCP_RATE_LIMITED') {
        const seconds = options.retryAfterSeconds;
        headers['Retry-After'] = String(
            typeof seconds === 'number' && Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds), 1), 3600) : 60
        );
    }

    return jsonRpcErrorResponse(status, spec.message, code, headers);
}

export function mcpMethodNotAllowed(): Response {
    return jsonRpcErrorResponse(405, 'Method not allowed.', null, { Allow: 'POST' });
}

/** Tool-level codes, carried in `structuredContent.error.code`. */
export const MCP_TOOL_ERROR_CODES = [
    'INVALID_INPUT',
    'SCOPE_FORBIDDEN',
    'TOOL_UNKNOWN',
    'NOT_FOUND',
    'CONFLICT',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
] as const;
export type McpToolErrorCode = (typeof MCP_TOOL_ERROR_CODES)[number];

const RETRYABLE_TOOL_ERRORS: ReadonlySet<McpToolErrorCode> = new Set(['RATE_LIMITED', 'INTERNAL_ERROR']);

export type McpToolResult = {
    content: { type: 'text'; text: string }[];
    structuredContent: Record<string, unknown>;
    isError?: boolean;
};

export function mcpToolSuccess(data: Record<string, unknown>): McpToolResult {
    const structuredContent = { ok: true, data };
    return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
    };
}

/** `message` must be fixed text chosen by the server, never caller input. */
export function mcpToolFailure(code: McpToolErrorCode, message: string): McpToolResult {
    return {
        content: [{ type: 'text', text: `[${code}] ${message}` }],
        structuredContent: {
            ok: false,
            error: { code, message, retryable: RETRYABLE_TOOL_ERRORS.has(code) },
        },
        isError: true,
    };
}
