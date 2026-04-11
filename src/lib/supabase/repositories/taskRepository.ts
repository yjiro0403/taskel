import { createClient } from '@/lib/supabase/client';
import { upsertTask, updateTaskRow } from '@/lib/supabase/data';
import type { Task } from '@/types';

export async function createTaskRecord(task: Task, userId: string) {
    await upsertTask(createClient(), task, userId);
}

export async function updateTaskRecord(taskId: string, updates: Partial<Task>, userId: string) {
    await updateTaskRow(createClient(), taskId, updates, userId);
}

export async function replaceTaskRecord(task: Task, userId: string) {
    await upsertTask(createClient(), task, userId);
}

export async function deleteTaskRecord(taskId: string) {
    const { error } = await createClient().from('tasks').delete().eq('id', taskId);
    if (error) {
        throw error;
    }
}

export async function bulkUpdateTaskRecords(taskIds: string[], updates: Partial<Task>, userId: string) {
    await Promise.all(taskIds.map((taskId) => updateTaskRecord(taskId, updates, userId)));
}

export async function bulkCreateTaskRecords(tasks: Task[], userId: string) {
    await Promise.all(tasks.map((task) => createTaskRecord(task, userId)));
}
