import { requireAuth } from '@/lib/api/auth';
import { createTokenAdminDb } from '@/lib/mcp/db';
import { mcpTokenIdSchema } from '@/lib/validations/mcpToken';

import { rejectCrossOrigin, tokenError, tokenJson, tokenRouteError } from '../shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revokes one of the signed-in user's tokens. Revocation is one-way and takes
 * effect on the token's next request. Another user's token id answers 404.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const crossOrigin = rejectCrossOrigin(request);
        if (crossOrigin) {
            return crossOrigin;
        }

        const user = await requireAuth();
        const { id } = await params;
        const tokenId = mcpTokenIdSchema.safeParse(id);
        if (!tokenId.success) {
            return tokenError(404, 'NOT_FOUND', 'Token not found');
        }

        const result = await createTokenAdminDb(user.id).revoke(tokenId.data.toLowerCase());
        if (!result.ok) {
            return result.code === 'NOT_FOUND'
                ? tokenError(404, 'NOT_FOUND', 'Token not found')
                : tokenError(409, 'ALREADY_REVOKED', 'Token already revoked');
        }

        return tokenJson({ ok: true });
    } catch (error) {
        return tokenRouteError('Error revoking MCP token', error);
    }
}
