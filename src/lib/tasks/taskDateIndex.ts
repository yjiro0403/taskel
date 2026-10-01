import type { Task } from '@/types';

/**
 * Buckets are cached by the tasks-array reference. The store always replaces
 * that array on update, so an in-place edit would be invisible here.
 */
interface TaskDateIndex {
    byDate: Map<string, Task[]>;
    undated: Task[];
    dailyGoalsByAssignedDate: Map<string, Task[]>;
}

const EMPTY_TASKS: Task[] = [];
const indexCache = new WeakMap<readonly Task[], TaskDateIndex>();

function buildIndex(tasks: readonly Task[]): TaskDateIndex {
    const byDate = new Map<string, Task[]>();
    const undated: Task[] = [];
    const dailyGoalsByAssignedDate = new Map<string, Task[]>();

    for (const task of tasks) {
        if (typeof task.date === 'string') {
            const dated = byDate.get(task.date);
            if (dated) dated.push(task);
            else byDate.set(task.date, [task]);
        }
        if (!task.date) {
            undated.push(task);
            if (task.assignedDate) {
                const goals = dailyGoalsByAssignedDate.get(task.assignedDate);
                if (goals) goals.push(task);
                else dailyGoalsByAssignedDate.set(task.assignedDate, [task]);
            }
        }
    }

    return { byDate, undated, dailyGoalsByAssignedDate };
}

function getIndex(tasks: readonly Task[]): TaskDateIndex {
    const cached = indexCache.get(tasks);
    if (cached) return cached;
    const index = buildIndex(tasks);
    indexCache.set(tasks, index);
    return index;
}

/** Tasks whose `date` is exactly `date` (YYYY-MM-DD). Order matches the source array. */
export function tasksOnDate(tasks: readonly Task[], date: string): Task[] {
    return getIndex(tasks).byDate.get(date) ?? EMPTY_TASKS;
}

/** Tasks with no date (backlog / goals stored with an empty date). */
export function tasksWithoutDate(tasks: readonly Task[]): Task[] {
    return getIndex(tasks).undated;
}

/** Undated tasks assigned to a calendar day as daily goals. */
export function dailyGoalsOnDate(tasks: readonly Task[], date: string): Task[] {
    return getIndex(tasks).dailyGoalsByAssignedDate.get(date) ?? EMPTY_TASKS;
}
