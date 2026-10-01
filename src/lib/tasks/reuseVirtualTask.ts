import type { Task } from '@/types';

const MAX_VIRTUAL_TASKS = 500;
const cache = new Map<string, Task>();

function sameVirtualTask(prev: Task, next: Task): boolean {
    return prev.title === next.title
        && prev.sectionId === next.sectionId
        && prev.date === next.date
        && prev.estimatedMinutes === next.estimatedMinutes
        && prev.scheduledStart === next.scheduledStart
        && prev.order === next.order
        && prev.projectId === next.projectId
        && prev.routineId === next.routineId
        && prev.userId === next.userId
        && prev.memo === next.memo
        && prev.tags === next.tags
        && prev.status === next.status
        && prev.actualMinutes === next.actualMinutes;
}

/**
 * Virtual routine rows are rebuilt on every merge. Reusing the previous object
 * when the visible fields match lets the day list skip those rows.
 */
export function reuseVirtualTask(task: Task): Task {
    const prev = cache.get(task.id);
    if (prev && sameVirtualTask(prev, task)) {
        cache.delete(task.id);
        cache.set(task.id, prev);
        return prev;
    }
    cache.set(task.id, task);
    if (cache.size > MAX_VIRTUAL_TASKS) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
    }
    return task;
}
