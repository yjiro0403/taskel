import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { MCP_SCOPES, type McpScope } from '@/lib/mcp/scopes';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/supabase';

/**
 * The only place under src/lib/mcp and src/app/api/mcp that holds the
 * service-role client.
 *
 * Rules of this file:
 *   - It calls the mcp_* SQL functions and nothing else. No table is queried
 *     directly; the ownership filters live in SQL.
 *   - The client never leaves this module.
 *   - The objects it hands out are bound to one user (and, for tool calls, one
 *     token). Their methods take no user id, so a caller cannot name another
 *     user.
 */

type AdminClient = SupabaseClient<Database>;

let cachedClient: AdminClient | null = null;

function admin(): AdminClient {
    cachedClient ??= createAdminClient();
    return cachedClient;
}

export type McpDbErrorKind = 'not_ready' | 'token_not_active' | 'scope_forbidden' | 'internal';

const DB_ERROR_MESSAGES: Record<McpDbErrorKind, string> = {
    not_ready: 'MCP database functions are missing.',
    token_not_active: 'MCP token is not active.',
    scope_forbidden: 'MCP token lacks the required scope.',
    internal: 'MCP database call failed.',
};

/** Carries a fixed message. The database's own text stays in `cause`, for server logs only. */
export class McpDbError extends Error {
    readonly kind: McpDbErrorKind;

    constructor(kind: McpDbErrorKind, cause?: unknown) {
        super(DB_ERROR_MESSAGES[kind], { cause });
        this.name = 'McpDbError';
        this.kind = kind;
    }
}

type RpcError = { code?: string; message?: string };

function classify(error: RpcError): McpDbErrorKind {
    // PGRST202: PostgREST cannot find the function. 42883: Postgres cannot.
    // This is the state after the code is deployed and before the migration.
    if (error.code === 'PGRST202' || error.code === '42883') {
        return 'not_ready';
    }
    if (error.code === '42501') {
        if (error.message?.includes('MCP_SCOPE_FORBIDDEN')) {
            return 'scope_forbidden';
        }
        if (error.message?.includes('MCP_TOKEN_NOT_ACTIVE')) {
            return 'token_not_active';
        }
    }
    return 'internal';
}

function unwrap<T>(schema: z.ZodType<T>, result: { data: unknown; error: RpcError | null }): T {
    if (result.error) {
        throw new McpDbError(classify(result.error), result.error);
    }
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) {
        throw new McpDbError('internal', parsed.error);
    }
    return parsed.data;
}

// ---------------------------------------------------------------------------
// Result shapes. Parsing drops every key not listed here.
// ---------------------------------------------------------------------------

// Shape only: ids migrated from older data need not carry RFC version bits.
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const visibleStatus = z.enum(['open', 'in_progress', 'done']);
const anyStatus = z.enum(['open', 'in_progress', 'done', 'skipped']);
const scopeList = z.array(z.enum(MCP_SCOPES)).min(1).max(2);

const authResultSchema = z.discriminatedUnion('status', [
    z.object({
        status: z.literal('ok'),
        token_id: uuid,
        user_id: uuid,
        name: z.string(),
        prefix: z.string().length(16),
        scopes: scopeList,
        timezone: z.string().min(1).max(64),
        expires_at: z.string(),
    }),
    z.object({ status: z.literal('unknown') }),
    z.object({ status: z.literal('revoked') }),
    z.object({ status: z.literal('expired') }),
    z.object({ status: z.literal('rate_limited'), retry_after_s: z.number().int().min(1) }),
]);

export type McpAuth = {
    userId: string;
    tokenId: string;
    tokenName: string;
    tokenPrefix: string;
    scopes: McpScope[];
    timezone: string;
    expiresAt: string;
};

export type McpAuthOutcome =
    | { status: 'ok'; auth: McpAuth }
    | { status: 'unknown' | 'revoked' | 'expired' | 'not_ready' }
    | { status: 'rate_limited'; retryAfterSeconds: number };

const taskRowSchema = z.object({
    id: uuid,
    title: z.string(),
    status: visibleStatus,
    date: isoDate.nullable(),
    scheduled_start: hhmm.nullable(),
    section_id: uuid.nullable(),
    section: z.string().nullable(),
    estimated_minutes: z.number().int(),
    actual_minutes: z.number().int(),
    routine_id: uuid.nullable(),
    completed_at: z.string().nullable(),
});
export type McpTaskRow = z.infer<typeof taskRowSchema>;

const daySnapshotSchema = z.object({
    tasks: z.array(
        z.object({
            id: uuid,
            /** Null when the row is outside the MCP scope (a shared project). */
            title: z.string().nullable(),
            status: anyStatus,
            date: isoDate.nullable(),
            scheduled_start: hhmm.nullable(),
            section_id: uuid.nullable(),
            estimated_minutes: z.number().int(),
            actual_minutes: z.number().int(),
            routine_id: uuid.nullable(),
            order: z.number().int(),
            in_scope: z.boolean(),
        })
    ),
    tasks_truncated: z.boolean(),
    goals: z.array(z.object({ id: uuid, title: z.string(), status: visibleStatus })),
    routines: z.array(
        z.object({
            id: uuid,
            /** Null when the routine is outside the MCP scope. */
            title: z.string().nullable(),
            frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
            days_of_week: z.array(z.number().int()).nullable(),
            interval: z.number().int().nullable(),
            start_date: isoDate,
            next_run: isoDate,
            start_time: hhmm.nullable(),
            section_id: uuid.nullable(),
            estimated_minutes: z.number().int(),
            in_scope: z.boolean(),
        })
    ),
    sections: z.array(
        z.object({
            id: uuid,
            name: z.string(),
            start_time: hhmm.nullable(),
            end_time: hhmm.nullable(),
            order: z.number().int(),
        })
    ),
});
export type McpDaySnapshot = z.infer<typeof daySnapshotSchema>;

const searchResultSchema = z.object({
    tasks: z.array(taskRowSchema),
    truncated: z.boolean(),
    routine_matches: z.array(
        z.object({
            title: z.string(),
            frequency: z.enum(['daily', 'weekly', 'monthly', 'custom']),
            active: z.boolean(),
        })
    ),
});
export type McpSearchResult = z.infer<typeof searchResultSchema>;

const getTaskSchema = z.object({ task: taskRowSchema.nullable() });

const createResultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), created: z.boolean(), task: taskRowSchema }),
    z.object({ ok: z.literal(false), code: z.enum(['INVALID_INPUT', 'CONFLICT', 'RATE_LIMITED']) }),
]);
export type McpCreateResult = z.infer<typeof createResultSchema>;

const revokeResultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), code: z.enum(['NOT_FOUND', 'ALREADY_REVOKED']) }),
]);
export type McpRevokeResult = z.infer<typeof revokeResultSchema>;

const okSchema = z.object({ ok: z.literal(true) });

const tokenRecordSchema = z.object({
    id: uuid,
    name: z.string(),
    prefix: z.string(),
    scopes: scopeList,
    timezone: z.string(),
    created_at: z.string(),
    expires_at: z.string(),
    last_used_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    revoked_via: z.enum(['ui', 'self']).nullable(),
});
export type McpTokenRecord = z.infer<typeof tokenRecordSchema>;

const issueResultSchema = z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), token: tokenRecordSchema }),
    z.object({ ok: z.literal(false), code: z.enum(['TOKEN_LIMIT', 'INVALID_INPUT']) }),
]);
export type McpIssueResult = z.infer<typeof issueResultSchema>;

const auditEntrySchema = z.object({
    created_at: z.string(),
    event: z.enum(['tool_call', 'token_issued', 'token_revoked', 'rate_limited', 'denied']),
    tool: z.string().nullable(),
    ok: z.boolean(),
    error_code: z.string().nullable(),
    token_id: uuid.nullable(),
    token_prefix: z.string().nullable(),
});
export type McpAuditEntry = z.infer<typeof auditEntrySchema>;

const listResultSchema = z.object({
    tokens: z.array(tokenRecordSchema),
    recent: z.array(auditEntrySchema),
});

// ---------------------------------------------------------------------------
// Bearer authentication
// ---------------------------------------------------------------------------

/**
 * Resolves the SHA-256 of a presented token. An unknown hash causes no write.
 * A missing function is reported as `not_ready`, not as an error.
 */
export async function authenticateMcpTokenHash(tokenHash: string): Promise<McpAuthOutcome> {
    const result = await admin().rpc('mcp_authenticate', { p_token_hash: tokenHash });

    if (result.error && classify(result.error) === 'not_ready') {
        return { status: 'not_ready' };
    }

    const row = unwrap(authResultSchema, result);
    switch (row.status) {
        case 'ok':
            return {
                status: 'ok',
                auth: {
                    userId: row.user_id,
                    tokenId: row.token_id,
                    tokenName: row.name,
                    tokenPrefix: row.prefix,
                    scopes: row.scopes,
                    timezone: row.timezone,
                    expiresAt: row.expires_at,
                },
            };
        case 'rate_limited':
            return { status: 'rate_limited', retryAfterSeconds: row.retry_after_s };
        default:
            return { status: row.status };
    }
}

// ---------------------------------------------------------------------------
// Tool-call access, bound to one authenticated token
// ---------------------------------------------------------------------------

export type McpSearchInput = {
    argKeys: string[];
    terms: string[];
    dateFrom: string | null;
    dateTo: string | null;
    statuses: ('open' | 'in_progress' | 'done')[];
    includeUndated: boolean;
    limit: number;
};

export type McpCreateInput = {
    idempotencyKey: string | null;
    requestHash: string;
    title: string;
    date: string;
    scheduledStart: string | null;
    estimatedMinutes: number | null;
    sectionId: string | null;
};

export type McpDb = {
    /** Everything the day view needs for one date. */
    daySnapshot(date: string, argKeys: string[]): Promise<McpDaySnapshot>;
    /**
     * The user's sections, for placing a new task. Needs `tasks:create`, not
     * `tasks:read`; it returns no task, goal or routine.
     */
    sectionsForCreate(date: string): Promise<McpDaySnapshot['sections']>;
    search(input: McpSearchInput): Promise<McpSearchResult>;
    getTask(taskId: string): Promise<McpTaskRow | null>;
    createTask(input: McpCreateInput): Promise<McpCreateResult>;
    /** Revokes the token this object is bound to. */
    revokeSelf(): Promise<McpRevokeResult>;
    /** Records a handler-level denial. `tool` is stored only when it is a known-shaped name. */
    logEvent(tool: string | null, errorCode: 'SCOPE_FORBIDDEN' | 'TOOL_UNKNOWN'): Promise<void>;
};

export type McpDbBinding = Pick<McpAuth, 'userId' | 'tokenId'> & { requestId: string };

export function createMcpDb(binding: McpDbBinding): McpDb {
    const userId = binding.userId;
    const tokenId = binding.tokenId;
    const requestId = binding.requestId;

    return Object.freeze({
        async daySnapshot(date: string, argKeys: string[]) {
            const result = await admin().rpc('mcp_day_snapshot', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_arg_keys: argKeys,
                p_date: date,
                p_tool: 'taskel_list_tasks_for_day',
            });
            return unwrap(daySnapshotSchema, result);
        },

        async sectionsForCreate(date: string) {
            const result = await admin().rpc('mcp_day_snapshot', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_arg_keys: [],
                p_date: date,
                p_tool: 'taskel_create_task',
            });
            return unwrap(daySnapshotSchema, result).sections;
        },

        async search(input: McpSearchInput) {
            const result = await admin().rpc('mcp_search_tasks', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_arg_keys: input.argKeys,
                p_terms: input.terms,
                p_date_from: input.dateFrom,
                p_date_to: input.dateTo,
                p_statuses: input.statuses,
                p_include_undated: input.includeUndated,
                p_limit: input.limit,
            });
            return unwrap(searchResultSchema, result);
        },

        async getTask(taskId: string) {
            const result = await admin().rpc('mcp_get_task', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_task_id: taskId,
            });
            return unwrap(getTaskSchema, result).task;
        },

        async createTask(input: McpCreateInput) {
            const result = await admin().rpc('mcp_create_task', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_idempotency_key: input.idempotencyKey,
                p_request_hash: input.requestHash,
                p_title: input.title,
                p_date: input.date,
                p_scheduled_start: input.scheduledStart,
                p_estimated_minutes: input.estimatedMinutes,
                p_section_id: input.sectionId,
            });
            return unwrap(createResultSchema, result);
        },

        async revokeSelf() {
            const result = await admin().rpc('mcp_revoke_token', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_via: 'self',
            });
            return unwrap(revokeResultSchema, result);
        },

        async logEvent(tool: string | null, errorCode: 'SCOPE_FORBIDDEN' | 'TOOL_UNKNOWN') {
            const result = await admin().rpc('mcp_log_event', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_request_id: requestId,
                p_event: 'denied',
                p_tool: tool,
                p_error_code: errorCode,
            });
            unwrap(okSchema, result);
        },
    });
}

// ---------------------------------------------------------------------------
// Token management, bound to one signed-in user (cookie session)
// ---------------------------------------------------------------------------

export type McpIssueInput = {
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    scopes: McpScope[];
    expiresDays: number;
    timezone: string;
};

export type McpTokenList =
    | { ready: true; tokens: McpTokenRecord[]; recent: McpAuditEntry[] }
    | { ready: false };

export type McpTokenAdminDb = {
    /** Throws McpDbError('not_ready') when the migration is missing. */
    issue(input: McpIssueInput): Promise<McpIssueResult>;
    list(): Promise<McpTokenList>;
    revoke(tokenId: string): Promise<McpRevokeResult>;
};

/** Call only with the id returned by `requireAuth()`. */
export function createTokenAdminDb(sessionUserId: string): McpTokenAdminDb {
    const userId = sessionUserId;

    return Object.freeze({
        async issue(input: McpIssueInput) {
            const result = await admin().rpc('mcp_issue_token', {
                p_user_id: userId,
                p_name: input.name,
                p_token_hash: input.tokenHash,
                p_token_prefix: input.tokenPrefix,
                p_scopes: input.scopes,
                p_expires_days: input.expiresDays,
                p_timezone: input.timezone,
            });
            return unwrap(issueResultSchema, result);
        },

        async list(): Promise<McpTokenList> {
            const result = await admin().rpc('mcp_list_tokens', { p_user_id: userId });
            if (result.error && classify(result.error) === 'not_ready') {
                return { ready: false };
            }
            const parsed = unwrap(listResultSchema, result);
            return { ready: true, tokens: parsed.tokens, recent: parsed.recent };
        },

        async revoke(tokenId: string) {
            const result = await admin().rpc('mcp_revoke_token', {
                p_user_id: userId,
                p_token_id: tokenId,
                p_via: 'ui',
            });
            return unwrap(revokeResultSchema, result);
        },
    });
}

/** Test seam: forget the cached client so a mocked factory is picked up. */
export function resetMcpDbForTests(): void {
    cachedClient = null;
}
