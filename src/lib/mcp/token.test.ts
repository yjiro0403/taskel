import { describe, expect, it } from 'vitest';

import { MCP_TOKEN_PATTERN, generateMcpToken, hashMcpToken, isMcpTokenShape, mcpTokenPrefix } from './token';

const stricterTokenPattern = /^tsk_mcp_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/;

describe('generateMcpToken', () => {
    it('returns a 60 character token, its 16 character prefix, and a sha256 hash', () => {
        const generated = generateMcpToken();

        expect(generated.token).toHaveLength(60);
        expect(generated.token).toMatch(MCP_TOKEN_PATTERN);
        expect(generated.token).toMatch(stricterTokenPattern);
        expect(generated.prefix).toBe(generated.token.slice(0, 16));
        expect(generated.prefix).toBe(mcpTokenPrefix(generated.token));
        expect(generated.prefix).toHaveLength(16);
        expect(generated.hash).toBe(hashMcpToken(generated.token));
        expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('draws 200 distinct tokens whose prefixes are 16 characters', () => {
        const generated = Array.from({ length: 200 }, () => generateMcpToken());

        expect(new Set(generated.map((item) => item.token)).size).toBe(200);
        for (const item of generated) {
            expect(item.prefix).toHaveLength(16);
            expect(item.token.slice(0, 16)).toHaveLength(16);
        }
    });
});

describe('hashMcpToken', () => {
    it('is stable for the same input and differs for a different input', () => {
        expect(hashMcpToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(hashMcpToken('abc')).toBe(hashMcpToken('abc'));
        expect(hashMcpToken('abcd')).not.toBe(hashMcpToken('abc'));
    });
});

describe('isMcpTokenShape', () => {
    it('accepts a generated token and rejects empty, edited, and relabeled strings', () => {
        const { token } = generateMcpToken();
        const shortened = token.slice(0, -1);
        const lengthened = `${token}a`;
        const relabeled = `tsk_pat_${token.slice('tsk_mcp_'.length)}`;
        const withDot = `${token.slice(0, 20)}.${token.slice(21)}`;
        const withSpace = `${token.slice(0, 20)} ${token.slice(21)}`;

        expect(isMcpTokenShape(token)).toBe(true);
        expect(isMcpTokenShape('')).toBe(false);
        expect(isMcpTokenShape(shortened)).toBe(false);
        expect(isMcpTokenShape(lengthened)).toBe(false);
        expect(relabeled).toHaveLength(token.length);
        expect(isMcpTokenShape(relabeled)).toBe(false);
        expect(isMcpTokenShape(withDot)).toBe(false);
        expect(isMcpTokenShape(withSpace)).toBe(false);
    });
});
