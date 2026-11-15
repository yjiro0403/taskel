import type { McpContext } from '@/lib/mcp/auth';
import { dateOfTimestamp } from '@/lib/mcp/dates';
import type { McpTaskItem } from '@/lib/mcp/dayView';
import type { McpTaskRow } from '@/lib/mcp/db';
import { mcpToolFailure, type McpToolErrorCode, type McpToolResult } from '@/lib/mcp/errors';
import type { McpToolName } from '@/lib/mcp/scopes';

/** What `tools/list` shows for one tool. `inputSchema` is hand-written JSON Schema. */
export type McpToolDefinition = {
    name: McpToolName;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties: false;
    };
    annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
};

export type McpToolModule = {
    definition: McpToolDefinition;
    /** `args` is whatever the caller sent; the handler validates it. */
    handle(args: unknown, ctx: McpContext): Promise<McpToolResult>;
};

/** The only messages a tool failure can carry. */
export const MCP_TOOL_MESSAGES: Record<McpToolErrorCode, string> = {
    INVALID_INPUT: 'Invalid arguments.',
    SCOPE_FORBIDDEN: 'This token does not have the required scope.',
    TOOL_UNKNOWN: 'Unknown tool.',
    NOT_FOUND: 'Task not found.',
    CONFLICT: 'This idempotency key was already used for a different request.',
    RATE_LIMITED: 'Task creation limit reached.',
    INTERNAL_ERROR: 'Internal error.',
};

export function toolFailure(code: McpToolErrorCode): McpToolResult {
    return mcpToolFailure(code, MCP_TOOL_MESSAGES[code]);
}

export function invalidInput(): McpToolResult {
    return toolFailure('INVALID_INPUT');
}

/** A stored row as the contract's TaskItem. The row's section id and routine id stay behind. */
export function toTaskItem(row: McpTaskRow): McpTaskItem {
    return {
        id: row.id,
        title: row.title,
        status: row.status,
        date: row.date,
        scheduled_start: row.scheduled_start,
        section: row.section,
        estimated_minutes: row.estimated_minutes,
        actual_minutes: row.actual_minutes,
        is_routine: row.routine_id !== null,
        is_virtual: false,
    };
}

/** TaskItem plus the calendar day (token time zone) on which the task was completed. */
export function toTaskItemWithCompletion(
    row: McpTaskRow,
    timeZone: string
): McpTaskItem & { completed_on: string | null } {
    return {
        ...toTaskItem(row),
        completed_on: row.status === 'done' ? dateOfTimestamp(row.completed_at, timeZone) : null,
    };
}
