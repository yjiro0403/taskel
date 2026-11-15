import { describe, expect, it } from 'vitest';

import {
    MCP_HTTP_ERRORS,
    MCP_TOOL_ERROR_CODES,
    mcpHttpError,
    mcpMethodNotAllowed,
    mcpToolFailure,
    mcpToolSuccess,
} from './errors';

const statusByCode: Record<string, number> = {
    MCP_BAD_REQUEST: 400,
    MCP_BATCH_UNSUPPORTED: 400,
    MCP_UNAUTHORIZED: 401,
    MCP_TOKEN_INVALID: 401,
    MCP_TOKEN_REVOKED: 401,
    MCP_TOKEN_EXPIRED: 401,
    MCP_BODY_TOO_LARGE: 413,
    MCP_RATE_LIMITED: 429,
    MCP_INTERNAL: 500,
    MCP_NOT_READY: 503,
    MCP_DISABLED: 503,
};

describe('mcpHttpError', () => {
    it('returns the fixed JSON-RPC error for every code', async () => {
        expect(Object.keys(MCP_HTTP_ERRORS).sort()).toEqual(Object.keys(statusByCode).sort());

        for (const code of Object.keys(MCP_HTTP_ERRORS) as (keyof typeof MCP_HTTP_ERRORS)[]) {
            const response = mcpHttpError(code);

            expect(response.status).toBe(MCP_HTTP_ERRORS[code].status);
            expect(response.status).toBe(statusByCode[code]);
            expect(response.headers.get('Content-Type')).toBe('application/json');
            expect(response.headers.get('Cache-Control')).toBe('no-store');
            expect(await response.json()).toEqual({
                jsonrpc: '2.0',
                error: {
                    code: -32001,
                    message: MCP_HTTP_ERRORS[code].message,
                    data: { code },
                },
                id: null,
            });

            if (statusByCode[code] === 401) {
                expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="taskel-mcp"');
            } else {
                expect(response.headers.get('WWW-Authenticate')).toBeNull();
            }
        }
    });

    it('sets Retry-After only for MCP_RATE_LIMITED, clamped to the allowed range', () => {
        expect(mcpHttpError('MCP_RATE_LIMITED', { retryAfterSeconds: 17 }).headers.get('Retry-After')).toBe('17');
        expect(mcpHttpError('MCP_RATE_LIMITED').headers.get('Retry-After')).toBe('60');
        expect(mcpHttpError('MCP_RATE_LIMITED', { retryAfterSeconds: Number.NaN }).headers.get('Retry-After')).toBe('60');
        expect(mcpHttpError('MCP_RATE_LIMITED', { retryAfterSeconds: 0 }).headers.get('Retry-After')).toBe('1');
        expect(mcpHttpError('MCP_RATE_LIMITED', { retryAfterSeconds: 999999 }).headers.get('Retry-After')).toBe('3600');

        for (const code of Object.keys(MCP_HTTP_ERRORS) as (keyof typeof MCP_HTTP_ERRORS)[]) {
            if (code === 'MCP_RATE_LIMITED') {
                continue;
            }
            expect(mcpHttpError(code).headers.get('Retry-After')).toBeNull();
        }
    });

    it('lets a caller override the status while keeping the error code', async () => {
        const response = mcpHttpError('MCP_BAD_REQUEST', { status: 415 });

        expect(response.status).toBe(415);
        expect(response.headers.get('WWW-Authenticate')).toBeNull();
        expect(await response.json()).toEqual({
            jsonrpc: '2.0',
            error: {
                code: -32001,
                message: MCP_HTTP_ERRORS.MCP_BAD_REQUEST.message,
                data: { code: 'MCP_BAD_REQUEST' },
            },
            id: null,
        });
    });
});

describe('mcpMethodNotAllowed', () => {
    it('returns 405 with Allow POST and no data key', async () => {
        const response = mcpMethodNotAllowed();

        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST');
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('Cache-Control')).toBe('no-store');

        const body = await response.json();
        expect(body).toEqual({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Method not allowed.' },
            id: null,
        });
        expect(body.error).not.toHaveProperty('data');
    });
});

describe('mcpToolSuccess', () => {
    it('wraps data in one text block and structured content', () => {
        const result = mcpToolSuccess({ a: 1 });

        expect(result.structuredContent).toEqual({ ok: true, data: { a: 1 } });
        expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
        expect(result.isError).toBeUndefined();
    });
});

describe('mcpToolFailure', () => {
    it('marks the tool result as an error with a fixed text line', () => {
        const result = mcpToolFailure('NOT_FOUND', 'Task not found.');

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: 'text', text: '[NOT_FOUND] Task not found.' }]);
        expect(result.structuredContent).toEqual({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Task not found.', retryable: false },
        });
    });

    it('marks only rate limited and internal errors as retryable', () => {
        for (const code of MCP_TOOL_ERROR_CODES) {
            const result = mcpToolFailure(code, 'Fixed message.');
            const retryable = code === 'RATE_LIMITED' || code === 'INTERNAL_ERROR';

            expect(result.isError).toBe(true);
            expect(result.content).toEqual([{ type: 'text', text: `[${code}] Fixed message.` }]);
            expect(result.structuredContent).toEqual({
                ok: false,
                error: { code, message: 'Fixed message.', retryable },
            });
        }
    });
});
