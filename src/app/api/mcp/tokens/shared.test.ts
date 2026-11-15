import { describe, expect, it } from 'vitest';

import { rejectCrossOrigin } from './shared';

/**
 * Next builds a route handler's request.url from the address the server is
 * bound to, so these requests carry a URL whose origin differs from the one
 * the browser used, with the browser's Host (or a proxy's X-Forwarded-*).
 */
function request(url: string, headers: Record<string, string>): Request {
    return new Request(url, { method: 'POST', headers });
}

const BOUND_LOCAL = 'http://127.0.0.1:3210/api/mcp/tokens';
const BOUND_PROXY = 'http://127.0.0.1:3000/api/mcp/tokens';
const PROXY_HEADERS = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com', host: '127.0.0.1:3000' };

async function expectForbidden(response: Response | null) {
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
}

describe('rejectCrossOrigin', () => {
    it('allows the browser origin when the server is bound to another loopback host', () => {
        const allowed = rejectCrossOrigin(
            request(BOUND_LOCAL, { host: 'localhost:3210', origin: 'http://localhost:3210' })
        );
        expect(allowed).toBeNull();
    });

    it('allows the public origin behind a TLS-terminating proxy', () => {
        expect(rejectCrossOrigin(request(BOUND_PROXY, { ...PROXY_HEADERS, origin: 'https://app.example.com' }))).toBeNull();
    });

    it('compares parsed origins, so a default port or upper-case host still matches', () => {
        expect(
            rejectCrossOrigin(request(BOUND_PROXY, { ...PROXY_HEADERS, origin: 'https://APP.example.com:443' }))
        ).toBeNull();
    });

    it('uses the first value of a comma-separated forwarded header', () => {
        const headers = { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'app.example.com, inner.local' };
        expect(rejectCrossOrigin(request(BOUND_PROXY, { ...headers, origin: 'https://app.example.com' }))).toBeNull();
    });

    it.each([
        ['loopback', BOUND_LOCAL, { host: 'localhost:3210' }],
        ['proxy', BOUND_PROXY, PROXY_HEADERS],
    ])('403 for a foreign Origin (%s)', async (_label, url, headers) => {
        await expectForbidden(rejectCrossOrigin(request(url, { ...headers, origin: 'https://evil.example' })));
    });

    it('403 when the scheme differs from the forwarded protocol', async () => {
        await expectForbidden(rejectCrossOrigin(request(BOUND_PROXY, { ...PROXY_HEADERS, origin: 'http://app.example.com' })));
    });

    it('403 for the bound address when the browser reached another host', async () => {
        await expectForbidden(
            rejectCrossOrigin(request(BOUND_LOCAL, { host: 'localhost:3210', origin: 'http://127.0.0.1:3210' }))
        );
    });

    it.each(['null', 'not a url'])('403 for the unparsable Origin %s', async (origin) => {
        await expectForbidden(rejectCrossOrigin(request(BOUND_LOCAL, { host: 'localhost:3210', origin })));
    });

    it('passes a request with no Origin through', () => {
        expect(rejectCrossOrigin(request(BOUND_LOCAL, { host: 'localhost:3210' }))).toBeNull();
        expect(rejectCrossOrigin(request(BOUND_PROXY, PROXY_HEADERS))).toBeNull();
    });
});
