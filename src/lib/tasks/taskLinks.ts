/** Query param used for permanent, shareable task deep links. */
export const TASK_LINK_QUERY_PARAM = 'task';
/** Occurrence date required to restore a virtual routine task. */
export const TASK_LINK_DATE_QUERY_PARAM = 'taskDate';

function isValidTaskLinkDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * Extract locale prefix (`/en`, `/ja`) from a pathname.
 * Returns empty string when the path has no supported locale segment.
 */
export function getLocalePrefixFromPathname(pathname: string): string {
    const match = pathname.match(/^\/(en|ja)(?=\/|$)/);
    return match ? match[0] : '';
}

/** Path to the main tasks page for the given locale prefix (e.g. `/ja/tasks`). */
export function buildTasksPath(localePrefix = ''): string {
    return `${localePrefix}/tasks`;
}

/**
 * Relative path for a permanent task link (e.g. `/ja/tasks?task=abc`).
 * Safe to paste behind any origin.
 */
export function buildTaskSharePath(
    taskId: string,
    localePrefix = '',
    taskDate?: string | null
): string {
    const params = new URLSearchParams({
        [TASK_LINK_QUERY_PARAM]: taskId,
    });
    const normalizedDate = taskDate?.trim();
    if (normalizedDate && isValidTaskLinkDate(normalizedDate)) {
        params.set(TASK_LINK_DATE_QUERY_PARAM, normalizedDate);
    }
    return `${buildTasksPath(localePrefix)}?${params.toString()}`;
}

/**
 * Absolute shareable URL for a task.
 * `origin` should be `window.location.origin` (or `getAppUrl()` on the server).
 */
export function buildTaskShareUrl(
    origin: string,
    taskId: string,
    localePrefix = '',
    taskDate?: string | null
): string {
    const cleanedOrigin = origin.replace(/\/$/, '');
    return `${cleanedOrigin}${buildTaskSharePath(taskId, localePrefix, taskDate)}`;
}

/**
 * Read the task id from a query string or URLSearchParams.
 * Returns null when the param is missing or blank.
 */
export function parseTaskIdFromQuery(
    search: string | URLSearchParams | { get: (key: string) => string | null }
): string | null {
    let raw: string | null;

    if (typeof search === 'string') {
        const qs = search.startsWith('?') ? search.slice(1) : search;
        raw = new URLSearchParams(qs).get(TASK_LINK_QUERY_PARAM);
    } else {
        raw = search.get(TASK_LINK_QUERY_PARAM);
    }

    if (raw == null) return null;
    const id = raw.trim();
    return id.length > 0 ? id : null;
}

/**
 * Read the optional occurrence date used by virtual routine task links.
 */
export function parseTaskDateFromQuery(
    search: string | URLSearchParams | { get: (key: string) => string | null }
): string | null {
    let raw: string | null;

    if (typeof search === 'string') {
        const qs = search.startsWith('?') ? search.slice(1) : search;
        raw = new URLSearchParams(qs).get(TASK_LINK_DATE_QUERY_PARAM);
    } else {
        raw = search.get(TASK_LINK_DATE_QUERY_PARAM);
    }

    if (raw == null) return null;
    const date = raw.trim();
    return isValidTaskLinkDate(date) ? date : null;
}

/**
 * Remove the task deep-link query params while preserving other params.
 * Returns pathname only when no query remains.
 */
export function stripTaskQueryParam(pathname: string, search: string): string {
    const qs = search.startsWith('?') ? search.slice(1) : search;
    const params = new URLSearchParams(qs);
    params.delete(TASK_LINK_QUERY_PARAM);
    params.delete(TASK_LINK_DATE_QUERY_PARAM);
    const remaining = params.toString();
    return remaining ? `${pathname}?${remaining}` : pathname;
}
