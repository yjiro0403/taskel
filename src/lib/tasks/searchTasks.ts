import type { Task, TaskStatus } from '@/types';

export type TaskSearchMatchField = 'title' | 'memo';

export interface TaskSearchFilters {
    /** Free-text query. Whitespace-separated tokens are AND-matched. */
    query: string;
    /** Inclusive lower bound (YYYY-MM-DD). Empty/undefined = no lower bound. */
    dateFrom?: string;
    /** Inclusive upper bound (YYYY-MM-DD). Empty/undefined = no upper bound. */
    dateTo?: string;
    /**
     * When a date range is set, undated (unscheduled) tasks are excluded unless true.
     * When no date range is set, undated tasks are always included.
     */
    includeUndated?: boolean;
    /** Max results to return (default 50). */
    limit?: number;
}

export interface TaskSearchResult {
    task: Task;
    matchedIn: TaskSearchMatchField[];
    /** Snippet around the first matching token in memo (when memo matched). */
    memoSnippet?: string;
}

function normalize(text: string | undefined | null): string {
    return (text ?? '').toLowerCase();
}

function tokenize(query: string): string[] {
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function hasDateRange(filters: TaskSearchFilters): boolean {
    return Boolean(filters.dateFrom?.trim() || filters.dateTo?.trim());
}

function isUndated(task: Task): boolean {
    return !task.date || task.date.trim() === '';
}

function matchesDateFilter(task: Task, filters: TaskSearchFilters): boolean {
    if (!hasDateRange(filters)) {
        return true;
    }

    if (isUndated(task)) {
        return filters.includeUndated === true;
    }

    const date = task.date;
    const from = filters.dateFrom?.trim();
    const to = filters.dateTo?.trim();

    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

function findMemoSnippet(memo: string, tokens: string[], radius = 40): string | undefined {
    if (!memo || tokens.length === 0) return undefined;

    const lower = memo.toLowerCase();
    let bestIndex = -1;
    let bestTokenLen = 0;

    for (const token of tokens) {
        const idx = lower.indexOf(token);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
            bestTokenLen = token.length;
        }
    }

    if (bestIndex === -1) return undefined;

    const start = Math.max(0, bestIndex - radius);
    const end = Math.min(memo.length, bestIndex + bestTokenLen + radius);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < memo.length ? '…' : '';
    return `${prefix}${memo.slice(start, end).trim()}${suffix}`;
}

/**
 * Client-side task search over in-memory tasks.
 * - Matches title and memo (case-insensitive substring).
 * - Multi-word queries require every token to appear in title or memo (AND).
 * - Includes all statuses (open / in_progress / done / skipped) and undated tasks.
 */
export function searchTasks(tasks: Task[], filters: TaskSearchFilters): TaskSearchResult[] {
    const tokens = tokenize(filters.query);
    const limit = filters.limit ?? 50;
    const hasQuery = tokens.length > 0;
    const hasRange = hasDateRange(filters);

    // Avoid dumping the entire history when the modal first opens.
    if (!hasQuery && !hasRange) {
        return [];
    }

    const results: TaskSearchResult[] = [];

    for (const task of tasks) {
        if (!matchesDateFilter(task, filters)) continue;

        const title = normalize(task.title);
        const memo = normalize(task.memo);
        const haystack = `${title}\n${memo}`;

        if (hasQuery && !tokens.every((token) => haystack.includes(token))) {
            continue;
        }

        const matchedIn: TaskSearchMatchField[] = [];
        if (hasQuery) {
            if (tokens.some((token) => title.includes(token))) matchedIn.push('title');
            if (tokens.some((token) => memo.includes(token))) matchedIn.push('memo');
        }

        results.push({
            task,
            matchedIn,
            memoSnippet:
                matchedIn.includes('memo') && task.memo
                    ? findMemoSnippet(task.memo, tokens)
                    : undefined,
        });
    }

    results.sort((a, b) => {
        // Dated tasks newest first; undated last
        const dateA = a.task.date || '';
        const dateB = b.task.date || '';
        if (dateA !== dateB) {
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB.localeCompare(dateA);
        }
        // Prefer title matches slightly, then stable by order
        const score = (r: TaskSearchResult) =>
            (r.matchedIn.includes('title') ? 2 : 0) + (r.matchedIn.includes('memo') ? 1 : 0);
        const scoreDiff = score(b) - score(a);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.task.order ?? 0) - (b.task.order ?? 0);
    });

    return results.slice(0, limit);
}

export function statusLabel(status: TaskStatus): string {
    switch (status) {
        case 'open':
            return 'open';
        case 'in_progress':
            return 'in_progress';
        case 'done':
            return 'done';
        case 'skipped':
            return 'skipped';
        default:
            return status;
    }
}
