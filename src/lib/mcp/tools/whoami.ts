import { todayInTimeZone } from '@/lib/mcp/dates';
import { mcpToolSuccess } from '@/lib/mcp/errors';
import { mcpNoArgsSchema } from '@/lib/validations/mcp';

import { invalidInput, type McpToolModule } from './shared';

export const TASKEL_MCP_SERVER_INFO = { name: 'taskel-mcp-server', version: '1.0.0' } as const;
export const TASKEL_MCP_CONTRACT_VERSION = 1;

/**
 * Answered from the authentication result alone: no database call and no
 * audit row, because a client may call it often as a health check.
 */
export const whoamiTool: McpToolModule = {
    definition: {
        name: 'taskel_whoami',
        description:
            'Show which Taskel token is in use: its name, scopes, expiry, the time zone that defines "today", and the server version. Returns no task data. ' +
            '使用中の Taskel トークンの名前・権限・有効期限、「今日」を決めるタイムゾーン、サーバーのバージョンを返します。タスクの内容は返しません。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
    },

    async handle(args, ctx) {
        if (!mcpNoArgsSchema.safeParse(args).success) {
            return invalidInput();
        }

        const now = new Date();
        const expiresAt = new Date(ctx.expiresAt);
        const msLeft = expiresAt.getTime() - now.getTime();

        return mcpToolSuccess({
            token: {
                name: ctx.tokenName,
                prefix: ctx.tokenPrefix,
                scopes: [...ctx.scopes],
                expires_at: Number.isNaN(expiresAt.getTime()) ? ctx.expiresAt : expiresAt.toISOString(),
                days_until_expiry: Number.isNaN(msLeft) ? 0 : Math.max(0, Math.ceil(msLeft / 86_400_000)),
            },
            timezone: ctx.timezone,
            today: todayInTimeZone(ctx.timezone, now),
            server: { ...TASKEL_MCP_SERVER_INFO, contract: TASKEL_MCP_CONTRACT_VERSION },
        });
    },
};
