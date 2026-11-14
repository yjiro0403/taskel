import type { McpHttpErrorCode } from '@/lib/mcp/errors';

export const MCP_MAX_BODY_BYTES = 65_536;

export type McpBodyResult =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; code: McpHttpErrorCode; status: number };

function fail(code: McpHttpErrorCode, status: number): McpBodyResult {
    return { ok: false, code, status };
}

function isJsonContentType(header: string | null): boolean {
    if (!header) {
        return false;
    }
    return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

/**
 * Reads one JSON-RPC message from the request.
 *
 * The size cap is enforced twice: a declared Content-Length over the limit is
 * refused without reading, and the stream is counted and cancelled as soon as
 * it passes the limit, so a missing or false Content-Length cannot get a large
 * body buffered. A JSON array is refused: the MCP transport would dispatch
 * every element of a batch.
 */
export async function readMcpJsonBody(request: Request, maxBytes = MCP_MAX_BODY_BYTES): Promise<McpBodyResult> {
    if (!isJsonContentType(request.headers.get('content-type'))) {
        return fail('MCP_BAD_REQUEST', 415);
    }

    const declared = request.headers.get('content-length');
    if (declared !== null) {
        if (!/^\d{1,15}$/.test(declared.trim())) {
            return fail('MCP_BAD_REQUEST', 400);
        }
        if (Number(declared.trim()) > maxBytes) {
            return fail('MCP_BODY_TOO_LARGE', 413);
        }
    }

    if (!request.body) {
        return fail('MCP_BAD_REQUEST', 400);
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                return fail('MCP_BODY_TOO_LARGE', 413);
            }
            chunks.push(value);
        }
    } catch {
        return fail('MCP_BAD_REQUEST', 400);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return fail('MCP_BAD_REQUEST', 400);
    }

    if (Array.isArray(parsed)) {
        return fail('MCP_BATCH_UNSUPPORTED', 400);
    }
    if (parsed === null || typeof parsed !== 'object') {
        return fail('MCP_BAD_REQUEST', 400);
    }

    return { ok: true, value: parsed as Record<string, unknown> };
}
