import { requireAuth } from '@/lib/api/auth';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { createTokenAdminDb } from '@/lib/mcp/db';
import { generateMcpToken } from '@/lib/mcp/token';
import { MCP_TOKEN_ACCESS_SCOPES, mcpTokenIssueSchema } from '@/lib/validations/mcpToken';

import { rejectCrossOrigin, tokenError, tokenJson, tokenRouteError } from './shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP personal access tokens of the signed-in user (cookie session).
 * The browser session has no privilege on the token tables; everything goes
 * through the mcp_* functions, bound to the session's user id.
 */

/** The user's tokens (never a hash or a secret) and the last audit rows. */
export async function GET() {
    try {
        const user = await requireAuth();
        const list = await createTokenAdminDb(user.id).list();

        if (!list.ready) {
            return tokenJson({ ready: false, tokens: [], recent: [] });
        }
        return tokenJson({ ready: true, tokens: list.tokens, recent: list.recent });
    } catch (error) {
        return tokenRouteError('Error listing MCP tokens', error);
    }
}

/**
 * Issues a token. The plaintext is in this one response and nowhere else:
 * only its SHA-256 and its 16-character display prefix reach the database,
 * and it is never logged.
 */
export async function POST(request: Request) {
    try {
        const crossOrigin = rejectCrossOrigin(request);
        if (crossOrigin) {
            return crossOrigin;
        }

        const limited = applyRateLimit(request, { key: 'mcp-token-issue', limit: 10, windowMs: 60_000 });
        if (limited) {
            return limited;
        }

        const user = await requireAuth();
        const input = await parseJsonBody(request, mcpTokenIssueSchema);
        const generated = generateMcpToken();

        const result = await createTokenAdminDb(user.id).issue({
            name: input.name,
            tokenHash: generated.hash,
            tokenPrefix: generated.prefix,
            scopes: [...MCP_TOKEN_ACCESS_SCOPES[input.access]],
            expiresDays: input.expiresInDays,
            timezone: input.timezone,
        });

        if (!result.ok) {
            return result.code === 'TOKEN_LIMIT'
                ? tokenError(409, 'TOKEN_LIMIT', 'Token limit reached. Revoke a token first.')
                : tokenError(400, 'INVALID_INPUT', 'Invalid request data');
        }

        return tokenJson({ token: generated.token, record: result.token }, 201);
    } catch (error) {
        return tokenRouteError('Error issuing MCP token', error);
    }
}
