import { z } from 'zod';

import { isIanaTimeZone } from '@/lib/mcp/dates';
import { hasForbiddenTextChars } from '@/lib/mcp/sanitize';
import type { McpScope } from '@/lib/mcp/scopes';

export const MCP_TOKEN_EXPIRY_DAYS = [30, 90, 180, 365] as const;
export const MCP_TOKEN_DEFAULT_EXPIRY_DAYS = 90;

export const MCP_TOKEN_ACCESS = ['read', 'read_create'] as const;
export type McpTokenAccess = (typeof MCP_TOKEN_ACCESS)[number];

/** What each access choice of the settings screen grants. */
export const MCP_TOKEN_ACCESS_SCOPES: Readonly<Record<McpTokenAccess, McpScope[]>> = Object.freeze({
    read: ['tasks:read'],
    read_create: ['tasks:read', 'tasks:create'],
});

/**
 * Body of POST /api/mcp/tokens. There is no expiry choice outside the four
 * listed and no way to send scopes, dates or a user directly.
 */
export const mcpTokenIssueSchema = z.strictObject({
    name: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .refine((value) => !hasForbiddenTextChars(value)),
    access: z.enum(MCP_TOKEN_ACCESS),
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
    timezone: z.string().min(1).max(64).refine(isIanaTimeZone),
});
export type McpTokenIssueInput = z.infer<typeof mcpTokenIssueSchema>;

// Shape only, like the database boundary: older ids need not carry RFC version bits.
export const mcpTokenIdSchema = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
