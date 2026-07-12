import { createClient } from '@/lib/supabase/client';
import { bulkUpdateTaskOrders, bulkUpdateTaskRows, bulkUpsertTasks, upsertTask, updateTaskRow } from '@/lib/supabase/data';
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
    await bulkUpdateTaskRows(createClient(), taskIds, updates, userId);
}

export async function bulkCreateTaskRecords(tasks: Task[], userId: string) {
    await bulkUpsertTasks(createClient(), tasks, userId, true);
}

export async function bulkReplaceTaskRecords(tasks: Task[], userId: string) {
    await bulkUpsertTasks(createClient(), tasks, userId);
}

// 並べ替え専用: order 列のみを更新する（user_id 等は不変）。
export async function bulkUpdateTaskOrderRecords(orders: { id: string; order: number }[]) {
    await bulkUpdateTaskOrders(createClient(), orders);
}
