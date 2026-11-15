import type { McpToolName } from '@/lib/mcp/scopes';

import { createTaskTool } from './createTask';
import { getTaskTool } from './getTask';
import { listTasksForDayTool } from './listTasksForDay';
import { revokeCurrentTokenTool } from './revokeCurrentToken';
import { searchTasksTool } from './searchTasks';
import type { McpToolModule } from './shared';
import { whoamiTool } from './whoami';

export type { McpToolDefinition, McpToolModule } from './shared';

/** Every tool of the server. There is no update, complete or delete tool. */
export const MCP_TOOLS: Readonly<Record<McpToolName, McpToolModule>> = Object.freeze({
    taskel_whoami: whoamiTool,
    taskel_list_tasks_for_day: listTasksForDayTool,
    taskel_search_tasks: searchTasksTool,
    taskel_get_task: getTaskTool,
    taskel_create_task: createTaskTool,
    taskel_revoke_current_token: revokeCurrentTokenTool,
});
