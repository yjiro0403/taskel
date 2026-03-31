import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { upsertTask, updateTaskRow } from '@/lib/supabase/data';
import { taskMutationRequestSchema } from '@/lib/validations/task';

function normalizeTaskInput<T extends Record<string, unknown>>(task: T) {
    return {
        ...task,
        assigneeId: (task.assigneeId as string | null | undefined) ?? undefined,
        reporterId: (task.reporterId as string | null | undefined) ?? undefined,
        parentGoalId: (task.parentGoalId as string | null | undefined) ?? undefined,
        projectId: (task.projectId as string | null | undefined) ?? undefined,
        milestoneId: (task.milestoneId as string | null | undefined) ?? undefined,
        routineId: (task.routineId as string | null | undefined) ?? undefined,
    };
}

export async function POST(req: Request) {
    try {
        const user = await requireAuth();
        const { task, action } = await parseJsonBody(req, taskMutationRequestSchema);
        const supabase = await createClient();

        if (action === 'create') {
            await upsertTask(supabase, { ...normalizeTaskInput(task), userId: user.id }, user.id);
            return NextResponse.json({ success: true, message: 'Task created' });
        }

        const { data: existingTask, error: existingTaskError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', task.id)
            .maybeSingle();

        if (existingTaskError) {
            throw existingTaskError;
        }

        if (!existingTask) {
            return jsonError('Task not found', 404);
        }

        await updateTaskRow(supabase, task.id, normalizeTaskInput(task), user.id);
        return NextResponse.json({ success: true, message: 'Task updated' });
    } catch (error) {
        return handleApiError('API Error in /api/tasks', error);
    }
}
