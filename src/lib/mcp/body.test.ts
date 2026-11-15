import { describe, expect, it } from 'vitest';

import { MCP_MAX_BODY_BYTES, readMcpJsonBody } from './body';

const MCP_URL = 'http://localhost/api/mcp';

function jsonObjectBytes(byteLength: number): string {
    const prefix = '{"pad":"';
    const suffix = '"}';
    return `${prefix}${'a'.repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
}

function postJson(body: BodyInit, contentType: string, extraHeaders: Record<string, string> = {}): Request {
    return new Request(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': contentType, ...extraHeaders },
        body,
    });
}

describe('readMcpJsonBody', () => {
    it('accepts a JSON object for application/json, with a charset, and in any case', async () => {
        const value = { jsonrpc: '2.0', id: 1, method: 'ping' };
        const contentTypes = ['application/json', 'application/json; charset=utf-8', 'Application/JSON'];

        for (const contentType of contentTypes) {
            const request = postJson(JSON.stringify(value), contentType);
            expect(await readMcpJsonBody(request)).toEqual({ ok: true, value });
        }
    });

    it('rejects a missing, plain, or lookalike content type with 415', async () => {
        const missing = postJson('{"ok":true}', 'application/json');
        missing.headers.delete('content-type');
        const plain = postJson('{"ok":true}', 'text/plain');
        const lookalike = postJson('{"ok":true}', 'application/jsonx');

        expect(missing.headers.get('content-type')).toBeNull();
        expect(await readMcpJsonBody(missing)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 415 });
        expect(await readMcpJsonBody(plain)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 415 });
        expect(await readMcpJsonBody(lookalike)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 415 });
    });

    it('rejects invalid JSON with 400', async () => {
        const request = postJson('{not json', 'application/json');
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 400 });
    });

    it('rejects a JSON array with MCP_BATCH_UNSUPPORTED', async () => {
        const bodies = ['[]', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'];

        for (const body of bodies) {
            const request = postJson(body, 'application/json');
            expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BATCH_UNSUPPORTED', status: 400 });
        }
    });

    it('rejects JSON null, a number, and a string', async () => {
        for (const body of ['null', '42', '"text"']) {
            const request = postJson(body, 'application/json');
            expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 400 });
        }
    });

    it('rejects an empty body', async () => {
        const request = postJson('', 'application/json');
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 400 });
    });

    it('accepts a JSON object of exactly MCP_MAX_BODY_BYTES', async () => {
        expect(MCP_MAX_BODY_BYTES).toBe(65536);
        const body = jsonObjectBytes(65536);
        expect(new TextEncoder().encode(body).byteLength).toBe(65536);

        const request = postJson(body, 'application/json');
        expect(await readMcpJsonBody(request)).toEqual({ ok: true, value: JSON.parse(body) });
    });

    it('rejects a 65537 byte string body', async () => {
        const body = jsonObjectBytes(65537);
        expect(new TextEncoder().encode(body).byteLength).toBe(65537);

        const request = postJson(body, 'application/json');
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BODY_TOO_LARGE', status: 413 });
    });

    it('rejects a declared Content-Length over the limit without reading the body', async () => {
        const request = postJson('{"a":1}', 'application/json', { 'content-length': '70000' });

        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BODY_TOO_LARGE', status: 413 });
        expect(request.bodyUsed).toBe(false);
    });

    it('cancels a stream with no Content-Length once the body passes the limit', async () => {
        let pulls = 0;
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls += 1;
                if (pulls > 100) {
                    controller.close();
                    return;
                }
                controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
                cancelled = true;
            },
        });
        const request = new Request(MCP_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: stream,
            duplex: 'half',
        } as RequestInit);

        expect(request.headers.get('content-length')).toBeNull();
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BODY_TOO_LARGE', status: 413 });
        expect(cancelled).toBe(true);
        expect(pulls).toBeLessThan(100);
    });

    it('rejects a non-numeric Content-Length', async () => {
        const request = postJson('{"a":1}', 'application/json', { 'content-length': 'abc' });
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 400 });
    });

    it('rejects invalid UTF-8 bytes', async () => {
        const request = postJson(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]), 'application/json');
        expect(await readMcpJsonBody(request)).toEqual({ ok: false, code: 'MCP_BAD_REQUEST', status: 400 });
    });

    it('honors a custom byte limit', async () => {
        const body = '{"pad":"1234567890"}';
        expect(new TextEncoder().encode(body).byteLength).toBe(20);

        const request = postJson(body, 'application/json');
        expect(await readMcpJsonBody(request, 10)).toEqual({ ok: false, code: 'MCP_BODY_TOO_LARGE', status: 413 });
    });
});
