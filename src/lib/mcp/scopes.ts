/**
 * Scopes and the tools each one unlocks. Membership is exact: `tasks:create`
 * names the single verb, so a later update or delete tool needs a new scope
 * and a reissued token.
 */
export const MCP_SCOPES = ['tasks:read', 'tasks:create'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const MCP_TOOL_NAMES = [
    'taskel_whoami',
    'taskel_list_tasks_for_day',
    'taskel_search_tasks',
    'taskel_get_task',
    'taskel_create_task',
    'taskel_revoke_current_token',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** `null` means any valid token may call the tool. */
export const MCP_TOOL_SCOPES: Readonly<Record<McpToolName, McpScope | null>> = Object.freeze({
    taskel_whoami: null,
    taskel_list_tasks_for_day: 'tasks:read',
    taskel_search_tasks: 'tasks:read',
    taskel_get_task: 'tasks:read',
    taskel_create_task: 'tasks:create',
    taskel_revoke_current_token: null,
});

export function isMcpScope(value: unknown): value is McpScope {
    return typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value);
}

export function isMcpToolName(value: unknown): value is McpToolName {
    return typeof value === 'string' && (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

export function canCallTool(scopes: readonly McpScope[], tool: McpToolName): boolean {
    const required = MCP_TOOL_SCOPES[tool];
    return required === null || scopes.includes(required);
}

/** Tool names a token may see in `tools/list`, in the fixed declaration order. */
export function toolsForScopes(scopes: readonly McpScope[]): McpToolName[] {
    return MCP_TOOL_NAMES.filter((tool) => canCallTool(scopes, tool));
}
