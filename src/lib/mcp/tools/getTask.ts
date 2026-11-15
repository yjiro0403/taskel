import { mcpToolSuccess } from '@/lib/mcp/errors';
import { mcpGetTaskSchema } from '@/lib/validations/mcp';

import { invalidInput, toolFailure, toTaskItemWithCompletion, type McpToolModule } from './shared';

/**
 * One stored task by id. A virtual routine occurrence, a deleted (skipped)
 * row, another user's row and a shared-project row all answer NOT_FOUND.
 */
export const getTaskTool: McpToolModule = {
    definition: {
        name: 'taskel_get_task',
        description:
            'Read one of the user\'s own stored tasks by id (an id returned by another Taskel tool). Answers NOT_FOUND for anything else, including routine occurrences that are still virtual and tasks in shared projects. ' +
            '自分の保存済みタスクを id で 1 件読みます（id は他の Taskel ツールが返したもの）。まだ実体化していないルーチンの予定や共有プロジェクトのタスクなど、それ以外は NOT_FOUND になります。',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' } },
            required: ['id'],
            additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
    },

    async handle(args, ctx) {
        const parsed = mcpGetTaskSchema.safeParse(args);
        if (!parsed.success) {
            return invalidInput();
        }

        const row = await ctx.db.getTask(parsed.data.id.toLowerCase());
        if (!row) {
            return toolFailure('NOT_FOUND');
        }

        return mcpToolSuccess({ task: toTaskItemWithCompletion(row, ctx.timezone) });
    },
};
