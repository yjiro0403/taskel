import { describe, expect, it } from 'vitest';

import { buildMcpContext, readBearerToken, resolveRequestId } from './auth';
import type { McpAuth, McpDb } from './db';
import { generateMcpToken } from './token';

function requestWith(headers: Record<string, string>) {
    return new Request('http://localhost/api/mcp', { method: 'POST', headers });
}

describe('readBearerToken', () => {
    it('accepts a well-formed bearer token', () => {
        const { token } = generateMcpToken();
        expect(readBearerToken(requestWith({ authorization: `Bearer ${token}` }))).toEqual({ ok: true, token });
        expect(readBearerToken(requestWith({ authorization: `bearer   ${token}  ` }))).toEqual({ ok: true, token });
    });

    it('reports a missing or non-bearer header as unauthorized', () => {
        const { token } = generateMcpToken();
        for (const headers of [
            {},
            { authorization: '' },
            { authorization: 'Bearer' },
            { authorization: `Basic ${token}` },
            { authorization: `Bearer ${token} extra` },
            { cookie: `sb-access-token=${token}` },
        ] as Record<string, string>[]) {
            expect(readBearerToken(requestWith(headers))).toEqual({ ok: false, code: 'MCP_UNAUTHORIZED' });
        }
    });

    it('reports a malformed token as invalid', () => {
        const { token } = generateMcpToken();
        for (const bad of [
            token.slice(0, -1),
            `${token}a`,
            token.replace('tsk_mcp_', 'tsk_pat_'),
            `${token.slice(0, 30)}.${token.slice(31)}`,
            'not-a-token',
        ]) {
            expect(readBearerToken(requestWith({ authorization: `Bearer ${bad}` }))).toEqual({
                ok: false,
                code: 'MCP_TOKEN_INVALID',
            });
        }
    });

    it('does not read the token from a query string or a custom header', () => {
        const { token } = generateMcpToken();
        const request = new Request(`http://localhost/api/mcp?token=${token}`, {
            method: 'POST',
            headers: { 'x-api-key': token },
        });
        expect(readBearerToken(request)).toEqual({ ok: false, code: 'MCP_UNAUTHORIZED' });
    });
});

describe('resolveRequestId', () => {
    it('keeps a plain caller id', () => {
        expect(resolveRequestId(requestWith({ 'x-taskel-request-id': 'abc-123' }))).toBe('abc-123');
        const longest = 'a'.repeat(64);
        expect(resolveRequestId(requestWith({ 'x-taskel-request-id': longest }))).toBe(longest);
    });

    it('replaces a missing or unsafe id with a new UUID', () => {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        const first = resolveRequestId(requestWith({}));
        expect(first).toMatch(uuid);
        expect(resolveRequestId(requestWith({}))).not.toBe(first);
        for (const bad of ['a'.repeat(65), 'has space', 'semi;colon', 'under_score', 'line\tbreak']) {
            expect(resolveRequestId(requestWith({ 'x-taskel-request-id': bad }))).toMatch(uuid);
        }
    });
});

describe('buildMcpContext', () => {
    it('returns a frozen context that does not share the scopes array', () => {
        const auth: McpAuth = {
            userId: '11111111-1111-4111-8111-111111111111',
            tokenId: '22222222-2222-4222-8222-222222222222',
            tokenName: 'Beacon',
            tokenPrefix: 'tsk_mcp_AbCdEfGh',
            scopes: ['tasks:read'],
            timezone: 'Asia/Tokyo',
            expiresAt: '2027-02-13T01:00:00+00:00',
        };
        const db = {} as McpDb;
        const ctx = buildMcpContext(auth, 'req-1', db);

        expect(ctx).toMatchObject({ ...auth, requestId: 'req-1' });
        expect(ctx.db).toBe(db);
        expect(Object.isFrozen(ctx)).toBe(true);
        auth.scopes.push('tasks:create');
        expect(ctx.scopes).toEqual(['tasks:read']);
    });
});
