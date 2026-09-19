import type { FinanceEntry } from '../finance/types';
import type { Project, Task } from '../../types';
import {
    UNCATEGORIZED_ID,
    UNCATEGORIZED_TAG,
    type TimeBucket,
    type VarianceStatus,
} from './types';

export function taskLoggedMinutes(task: Task): number {
    const minutes = Number(task.actualMinutes || 0);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export function computeVariance(actual: number, expected: number | null | undefined): VarianceStatus | null {
    if (expected == null || expected <= 0) return null;
    const remaining = expected - actual;
    return {
        expected,
        actual,
        remaining,
        over: remaining < 0,
        ratio: actual / expected,
    };
}

function sortBuckets(buckets: TimeBucket[]): TimeBucket[] {
    return [...buckets].sort((a, b) => b.minutes - a.minutes || b.taskCount - a.taskCount || a.label.localeCompare(b.label));
}

export function aggregateByProject(tasks: Task[], projects: Project[]): TimeBucket[] {
    const byId = new Map<string, TimeBucket>();
    for (const project of projects) {
        byId.set(project.id, {
            id: project.id,
            label: project.title,
            minutes: 0,
            taskCount: 0,
            completedCount: 0,
        });
    }

    for (const task of tasks) {
        const id = task.projectId || UNCATEGORIZED_ID;
        const existing = byId.get(id);
        if (existing) {
            existing.minutes += taskLoggedMinutes(task);
            existing.taskCount += 1;
            if (task.status === 'done') existing.completedCount += 1;
        } else {
            byId.set(id, {
                id,
                label: id === UNCATEGORIZED_ID ? '' : id,
                minutes: taskLoggedMinutes(task),
                taskCount: 1,
                completedCount: task.status === 'done' ? 1 : 0,
            });
        }
    }

    return sortBuckets([...byId.values()]);
}

export function aggregateByTag(tasks: Task[]): TimeBucket[] {
    const byTag = new Map<string, TimeBucket>();

    const add = (id: string, label: string, task: Task) => {
        const existing = byTag.get(id);
        if (existing) {
            existing.minutes += taskLoggedMinutes(task);
            existing.taskCount += 1;
            if (task.status === 'done') existing.completedCount += 1;
        } else {
            byTag.set(id, {
                id,
                label,
                minutes: taskLoggedMinutes(task),
                taskCount: 1,
                completedCount: task.status === 'done' ? 1 : 0,
            });
        }
    };

    for (const task of tasks) {
        const tags = task.tags?.filter((tag) => tag.trim() !== '') ?? [];
        if (tags.length === 0) {
            add(UNCATEGORIZED_TAG, '', task);
            continue;
        }
        for (const tag of tags) {
            add(tag, tag, task);
        }
    }

    return sortBuckets([...byTag.values()]);
}

export function tasksForProject(tasks: Task[], projectId: string): Task[] {
    if (projectId === UNCATEGORIZED_ID) {
        return tasks.filter((task) => !task.projectId);
    }
    return tasks.filter((task) => task.projectId === projectId);
}

export function tasksForTag(tasks: Task[], tagId: string): Task[] {
    if (tagId === UNCATEGORIZED_TAG) {
        return tasks.filter((task) => !task.tags || task.tags.length === 0);
    }
    return tasks.filter((task) => task.tags?.includes(tagId));
}

export interface FinanceProjectBucket {
    id: string;
    label: string;
    expenseYen: number;
    incomeYen: number;
    count: number;
}

export function aggregateFinanceByProject(
    entries: FinanceEntry[],
    tasks: Task[],
    projects: Project[]
): FinanceProjectBucket[] {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const projectTitle = new Map(projects.map((project) => [project.id, project.title]));
    const buckets = new Map<string, FinanceProjectBucket>();

    for (const entry of entries) {
        const task = entry.taskId ? taskById.get(entry.taskId) : undefined;
        const projectId = task?.projectId || UNCATEGORIZED_ID;
        const existing = buckets.get(projectId);
        const expense = entry.entryType === 'expense' ? entry.amountYen : 0;
        const income = entry.entryType === 'income' ? entry.amountYen : 0;
        if (existing) {
            existing.expenseYen += expense;
            existing.incomeYen += income;
            existing.count += 1;
        } else {
            buckets.set(projectId, {
                id: projectId,
                label: projectId === UNCATEGORIZED_ID ? '' : (projectTitle.get(projectId) ?? ''),
                expenseYen: expense,
                incomeYen: income,
                count: 1,
            });
        }
    }

    return [...buckets.values()].sort(
        (a, b) => b.expenseYen - a.expenseYen || b.incomeYen - a.incomeYen || a.label.localeCompare(b.label)
    );
}

export interface FinanceCategorySpend {
    categoryId: string;
    label: string;
    expenseYen: number;
    incomeYen: number;
    count: number;
}

export function aggregateFinanceByCategory(entries: FinanceEntry[]): FinanceCategorySpend[] {
    const buckets = new Map<string, FinanceCategorySpend>();
    for (const entry of entries) {
        const existing = buckets.get(entry.categoryId);
        const expense = entry.entryType === 'expense' ? entry.amountYen : 0;
        const income = entry.entryType === 'income' ? entry.amountYen : 0;
        if (existing) {
            existing.expenseYen += expense;
            existing.incomeYen += income;
            existing.count += 1;
        } else {
            buckets.set(entry.categoryId, {
                categoryId: entry.categoryId,
                label: entry.categoryLabelSnapshot,
                expenseYen: expense,
                incomeYen: income,
                count: 1,
            });
        }
    }
    return [...buckets.values()].sort(
        (a, b) => b.expenseYen - a.expenseYen || a.label.localeCompare(b.label)
    );
}
