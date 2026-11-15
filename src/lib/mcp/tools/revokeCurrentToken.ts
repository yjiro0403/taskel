import { mcpToolSuccess } from '@/lib/mcp/errors';
import { mcpNoArgsSchema } from '@/lib/validations/mcp';

import { invalidInput, toolFailure, type McpToolModule } from './shared';

/** Revokes the token that made this call. The next request with it gets 401. */
export const revokeCurrentTokenTool: McpToolModule = {
    definition: {
        name: 'taskel_revoke_current_token',
        description:
            'Revoke the token used for this call. It stops working immediately and cannot be restored; a new token must be issued in Taskel settings. Use it when unlinking or replacing a token. ' +
            'この呼び出しに使ったトークンを取り消します。直ちに使えなくなり、元に戻せません（Taskel の設定で発行し直します）。連携の解除やトークンの入れ替えのときに使います。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },

    async handle(args, ctx) {
        if (!mcpNoArgsSchema.safeParse(args).success) {
            return invalidInput();
        }

        const result = await ctx.db.revokeSelf();
        // ALREADY_REVOKED: another request revoked it a moment ago. Either way it is revoked now.
        if (!result.ok && result.code !== 'ALREADY_REVOKED') {
            return toolFailure('INTERNAL_ERROR');
        }
        return mcpToolSuccess({ revoked: true });
    },
};
