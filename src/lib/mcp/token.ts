import { createHash, randomBytes } from 'node:crypto';

/**
 * MCP personal access token: `tsk_mcp_<8 id chars>_<43 secret chars>`, 60 chars.
 * Only the SHA-256 of the whole token is stored. The first 16 chars are the
 * display prefix; they hold no secret bits.
 */
export const MCP_TOKEN_PATTERN = /^tsk_mcp_[A-Za-z0-9_-]{52}$/;
export const MCP_TOKEN_LENGTH = 60;
export const MCP_TOKEN_PREFIX_LENGTH = 16;

export type GeneratedMcpToken = {
    token: string;
    prefix: string;
    hash: string;
};

export function isMcpTokenShape(value: string): boolean {
    return MCP_TOKEN_PATTERN.test(value);
}

export function hashMcpToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function mcpTokenPrefix(token: string): string {
    return token.slice(0, MCP_TOKEN_PREFIX_LENGTH);
}

export function generateMcpToken(): GeneratedMcpToken {
    const token = `tsk_mcp_${randomBytes(6).toString('base64url')}_${randomBytes(32).toString('base64url')}`;
    return { token, prefix: mcpTokenPrefix(token), hash: hashMcpToken(token) };
}
