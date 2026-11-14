import { z } from 'zod';

import { MCP_RANGE_PRESETS } from '@/lib/mcp/dates';

/**
 * Argument schemas of the MCP tools.
 *
 * Every object is strict: an unknown key is refused. No schema has a user,
 * project, section, status-to-write or row-id-to-write key; the token decides
 * whose data a call touches and the server decides where a new task goes.
 *
 * These check shape only. Rules that need "today" (real calendar dates, the
 * allowed window, range arithmetic) live in the tool handlers.
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Shape only: ids migrated from older data need not carry RFC version bits.
const uuidString = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const MCP_SEARCH_STATUSES = ['open', 'in_progress', 'done'] as const;
export const MCP_SEARCH_DEFAULT_LIMIT = 20;
export const MCP_SEARCH_MAX_LIMIT = 50;
export const MCP_SEARCH_MAX_TERMS = 5;
export const MCP_SEARCH_MAX_TERM_LENGTH = 50;
export const MCP_SEARCH_MAX_SPAN_DAYS = 366;

export const mcpNoArgsSchema = z.strictObject({});

export const mcpListTasksForDaySchema = z
    .strictObject({
        day: z.enum(['today', 'tomorrow', 'yesterday']).optional(),
        date: dateString.optional(),
    })
    .refine((value) => value.day === undefined || value.date === undefined);

export const mcpSearchTasksSchema = z
    .strictObject({
        query: z.string().min(1).max(100).optional(),
        range: z.enum(MCP_RANGE_PRESETS).optional(),
        date_from: dateString.optional(),
        date_to: dateString.optional(),
        status: z
            .array(z.enum(MCP_SEARCH_STATUSES))
            .min(1)
            .max(3)
            .refine((items) => new Set(items).size === items.length)
            .optional(),
        include_undated: z.boolean().optional(),
        limit: z.number().int().min(1).max(MCP_SEARCH_MAX_LIMIT).optional(),
    })
    // At least one filter, so a call cannot dump the whole history.
    .refine(
        (value) =>
            value.query !== undefined ||
            value.range !== undefined ||
            value.date_from !== undefined ||
            value.date_to !== undefined
    )
    // A range word and explicit dates cannot be mixed.
    .refine((value) => value.range === undefined || (value.date_from === undefined && value.date_to === undefined));

export const mcpGetTaskSchema = z.strictObject({ id: uuidString });

export const mcpCreateTaskSchema = z
    .strictObject({
        title: z.string(),
        day: z.enum(['today', 'tomorrow']).optional(),
        date: dateString.optional(),
        scheduled_start: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
        estimated_minutes: z.number().int().min(0).max(1440).optional(),
        idempotency_key: z
            .string()
            .regex(/^[A-Za-z0-9_-]{16,64}$/)
            .optional(),
    })
    .refine((value) => value.day === undefined || value.date === undefined);

/**
 * Splits a search query into terms on whitespace. JavaScript's `\s` includes
 * the ideographic space (U+3000). Returns null when there are no terms, more than five, or
 * one longer than 50 characters.
 */
export function splitMcpSearchTerms(query: string): string[] | null {
    const terms = query.split(/\s+/u).filter((term) => term.length > 0);
    if (
        terms.length === 0 ||
        terms.length > MCP_SEARCH_MAX_TERMS ||
        terms.some((term) => Array.from(term).length > MCP_SEARCH_MAX_TERM_LENGTH)
    ) {
        return null;
    }
    return terms;
}
