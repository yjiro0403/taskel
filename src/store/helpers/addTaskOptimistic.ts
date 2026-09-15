import type { Task } from '../../types';

/**
 * Apply an addTask payload to the local list without duplicating an id that is
 * already present (create succeeded, finance failed, user retries).
 * `previous: null` means rollback should remove the id; an existing row must be
 * snapshotted so a retry failure cannot delete an already-persisted task.
 */
export function applyAddTaskToList(
    tasks: Task[],
    task: Task
): { tasks: Task[]; existed: boolean; previous: Task | null } {
    const previous = tasks.find((entry) => entry.id === task.id) ?? null;
    if (previous) {
        return {
            tasks: tasks.map((entry) => (entry.id === task.id ? { ...entry, ...task } : entry)),
            existed: true,
            previous,
        };
    }
    return {
        tasks: [...tasks, task],
        existed: false,
        previous: null,
    };
}
