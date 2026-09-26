/** Google Calendar の通知設定 1 件（events.list が返す形）。 */
export interface CalendarReminderOverride {
    /** 'popup' | 'email' など。アラームに変換するのは popup のみ。 */
    method?: string;
    /** 開始時刻の何分前か。 */
    minutes?: number;
}

export interface CalendarEvent {
    id: string;
    summary: string;
    htmlLink?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    /**
     * useDefault=true のときはイベント固有の設定を持たず、カレンダー既定の通知
     * （events.list レスポンス最上位の defaultReminders）が適用される。
     */
    reminders?: {
        useDefault?: boolean;
        overrides?: CalendarReminderOverride[];
    };
}

/** popup 通知だけを取り出し、分単位の昇順・重複排除で返す。 */
export function resolveEventReminderMinutes(
    event: CalendarEvent,
    defaultReminders: CalendarReminderOverride[]
): number[] {
    const source = event.reminders?.useDefault
        ? defaultReminders
        : (event.reminders?.overrides ?? []);

    const minutes = source
        .filter((reminder) => (reminder.method ?? 'popup') === 'popup')
        .map((reminder) => reminder.minutes)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return [...new Set(minutes)].sort((a, b) => a - b);
}

/**
 * Identity of a calendar event link. Google rewrites the host and adds `ctz`,
 * but the `eid` query value stays the same for one event, including each
 * instance of a recurring event.
 */
export function calendarEventLinkKey(link: string | undefined | null): string | null {
    const trimmed = link?.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        const eid = url.searchParams.get('eid');
        if (eid) return `eid:${eid}`;
        for (const key of [...url.searchParams.keys()]) {
            if (key === 'ctz' || key === 'usp' || key.startsWith('utm_')) {
                url.searchParams.delete(key);
            }
        }
        const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
        const search = new URLSearchParams(params).toString();
        return `${url.origin}${url.pathname}${search ? `?${search}` : ''}`;
    } catch {
        return trimmed;
    }
}

export interface ImportedCalendarTaskRef {
    id?: string;
    title: string;
    date: string;
    externalLink?: string;
    scheduledStart?: string;
}

/**
 * A task already created for this calendar event.
 * The link wins, so a renamed task is not imported again. Tasks saved before
 * links were stored still match on title + day (+ start, when both have one).
 * A task that already points at a different event is left alone.
 */
export function findAlreadyImportedTask<T extends ImportedCalendarTaskRef>(
    tasks: T[],
    event: { summary?: string; htmlLink?: string },
    eventDate: string,
    scheduledStart?: string,
    /** Title/day matches already used for another event in this import. Link matches still count. */
    claimedTaskIds?: ReadonlySet<string>
): T | undefined {
    const linkKey = calendarEventLinkKey(event.htmlLink);
    if (linkKey) {
        const byLink = tasks.find((task) => calendarEventLinkKey(task.externalLink) === linkKey);
        if (byLink) return byLink;
    }

    const summary = event.summary?.trim();
    if (!summary) return undefined;

    return tasks.find((task) => {
        if (task.id && claimedTaskIds?.has(task.id)) return false;
        if (task.title.trim() !== summary || task.date !== eventDate) return false;
        const taskKey = calendarEventLinkKey(task.externalLink);
        if (linkKey && taskKey && taskKey !== linkKey) return false;
        if (scheduledStart && task.scheduledStart && task.scheduledStart !== scheduledStart) return false;
        return true;
    });
}

export interface CalendarImportCopy extends ImportedCalendarTaskRef {
    id: string;
    createdAt?: number;
    status?: string;
    actualMinutes?: number;
    startedAt?: number;
    completedAt?: number;
    memo?: string;
    checklist?: readonly unknown[];
    attachments?: readonly unknown[];
    tags?: readonly string[];
    aiTags?: readonly string[];
    projectId?: string;
    milestoneId?: string;
    parentGoalId?: string;
    routineId?: string;
    commentCount?: number;
    isVirtual?: boolean;
}

/** A calendar copy the user has not edited, logged, or attached anything to. */
export function isUntouchedCalendarImport(task: CalendarImportCopy): boolean {
    return task.status === 'open'
        && !task.actualMinutes
        && !task.startedAt
        && !task.completedAt
        && !task.memo?.trim()
        && !task.checklist?.length
        && !task.attachments?.length
        && !task.tags?.length
        && !task.aiTags?.length
        && !task.projectId
        && !task.milestoneId
        && !task.parentGoalId
        && !task.routineId
        && !task.commentCount
        && !task.isVirtual;
}

function calendarImportWorkScore(task: CalendarImportCopy): number {
    let score = 0;
    if (task.status && task.status !== 'open') score += 100;
    if (task.actualMinutes) score += 80;
    if (task.startedAt || task.completedAt) score += 40;
    if (task.memo?.trim()) score += 20;
    if (task.checklist?.length || task.attachments?.length) score += 20;
    if (task.tags?.length || task.aiTags?.length || task.commentCount) score += 10;
    if (task.projectId || task.milestoneId || task.parentGoalId || task.routineId) score += 10;
    return score;
}

/**
 * Extra copies of one calendar event already stored on tasks.
 * Keeps the copy with logged work (or the oldest untouched one) and returns
 * the other untouched copies. A copy the user has edited is never removed.
 */
export function duplicateCalendarImportIds(tasks: CalendarImportCopy[]): string[] {
    const groups = new Map<string, CalendarImportCopy[]>();
    for (const task of tasks) {
        const key = calendarEventLinkKey(task.externalLink);
        if (!key || !task.id) continue;
        const group = groups.get(key);
        if (group) group.push(task);
        else groups.set(key, [task]);
    }

    const removeIds: string[] = [];
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const ranked = [...group].sort((a, b) => {
            const score = calendarImportWorkScore(b) - calendarImportWorkScore(a);
            if (score !== 0) return score;
            const created = (a.createdAt ?? Number.MAX_SAFE_INTEGER) - (b.createdAt ?? Number.MAX_SAFE_INTEGER);
            if (created !== 0) return created;
            return a.id.localeCompare(b.id);
        });
        for (const extra of ranked.slice(1)) {
            if (isUntouchedCalendarImport(extra)) removeIds.push(extra.id);
        }
    }
    return removeIds;
}

export class GoogleCalendarAuthorizationError extends Error {
    constructor(public readonly status: number) {
        super(`Google Calendar authorization failed (${status})`);
        this.name = 'GoogleCalendarAuthorizationError';
    }
}

export const CURRENT_DATE_STORAGE_KEY = 'taskel_current_date';
export const PENDING_GOOGLE_CALENDAR_SYNC_KEY = 'pending_google_calendar_sync';
export const GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY =
    'taskel_google_calendar_provider_token';

/**
 * Build local-midnight → next local midnight bounds from a UI date string (yyyy-MM-dd).
 * Avoids `new Date('yyyy-MM-dd')` which parses as UTC and shifts the calendar day
 * in timezones behind UTC. Google Calendar treats timeMax as exclusive, so the
 * next midnight is the precise upper bound for the selected day.
 */
export function getLocalDayRange(dateStr: string): { start: Date; end: Date } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) {
        throw new Error(`Invalid date string: ${dateStr}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    return {
        start: new Date(year, month - 1, day, 0, 0, 0, 0),
        end: new Date(year, month - 1, day + 1, 0, 0, 0, 0),
    };
}

/** Local calendar date as yyyy-MM-dd (never UTC via toISOString). */
export function formatLocalDate(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve the date Google Calendar sync must use: explicit arg, else UI currentDate. Never system today. */
export function resolveCalendarSyncDate(
    targetDateStr: string | undefined,
    uiCurrentDate: string | undefined
): string {
    const dateStr = targetDateStr || uiCurrentDate;
    if (!dateStr || !DATE_ONLY_RE.test(dateStr)) {
        throw new Error(`No valid UI-selected date for calendar sync: ${String(dateStr)}`);
    }
    return dateStr;
}

/**
 * Build the Google Calendar events list request for a UI-selected local day.
 * Integration seam: callers and tests can assert timeMin/timeMax without mocking the store.
 */
export function buildGoogleCalendarDayRequest(dateStr: string): {
    dateStr: string;
    timeMin: string;
    timeMax: string;
    urlPathWithQuery: string;
} {
    const resolved = resolveCalendarSyncDate(dateStr, dateStr);
    const { start, end } = getLocalDayRange(resolved);
    const timeMin = start.toISOString();
    const timeMax = end.toISOString();
    const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
    });

    return {
        dateStr: resolved,
        timeMin,
        timeMax,
        urlPathWithQuery: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    };
}

/** Returns stored UI date, or null when nothing valid is stored (does not invent today). */
export function peekStoredCurrentDate(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const stored = sessionStorage.getItem(CURRENT_DATE_STORAGE_KEY);
        if (stored && DATE_ONLY_RE.test(stored)) {
            return stored;
        }
    } catch {
        // ignore storage access errors (private mode, SSR edge cases)
    }
    return null;
}

export function readStoredCurrentDate(): string {
    return peekStoredCurrentDate() ?? formatLocalDate();
}

export function writeStoredCurrentDate(date: string): void {
    if (typeof window === 'undefined' || !DATE_ONLY_RE.test(date)) {
        return;
    }
    try {
        sessionStorage.setItem(CURRENT_DATE_STORAGE_KEY, date);
    } catch {
        // ignore
    }
}

/**
 * Provider tokens are only present immediately after Google OAuth. Keep the
 * short-lived token in this tab so the post-callback sync can wait for Taskel's
 * tasks/sections to finish loading without losing the token.
 */
export function storeGoogleCalendarProviderToken(
    token: string | null | undefined,
    userId: string | null | undefined
): void {
    if (typeof window === 'undefined' || !token || !userId) {
        return;
    }
    try {
        sessionStorage.setItem(
            GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY,
            JSON.stringify({ token, userId })
        );
    } catch {
        // ignore storage access errors
    }
}

export function readGoogleCalendarProviderToken(
    sessionProviderToken: string | null | undefined,
    userId: string | null | undefined
): string | null {
    if (!userId) {
        return null;
    }
    if (sessionProviderToken) {
        storeGoogleCalendarProviderToken(sessionProviderToken, userId);
        return sessionProviderToken;
    }
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const value = sessionStorage.getItem(GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY);
        if (!value) {
            return null;
        }
        const stored = JSON.parse(value) as { token?: unknown; userId?: unknown };
        return stored.userId === userId && typeof stored.token === 'string'
            ? stored.token
            : null;
    } catch {
        return null;
    }
}

export function clearGoogleCalendarProviderToken(): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        sessionStorage.removeItem(GOOGLE_CALENDAR_PROVIDER_TOKEN_STORAGE_KEY);
    } catch {
        // ignore storage access errors
    }
}

/**
 * Calendar imports need the authenticated user's tasks and sections. Running
 * during the OAuth return bootstrap can otherwise create an invalid fallback
 * section and make the first import fail while a second click succeeds.
 */
export function isGoogleCalendarSyncDataReady(
    initialDataStatus: string,
    tasksLoaded: boolean,
    sectionCount: number
): boolean {
    return initialDataStatus === 'ready' && tasksLoaded && sectionCount > 0;
}

export async function fetchCalendarEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
    });

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    assertCalendarResponseAuthorized(response);

    const data = await response.json();
    return data.items || [];
}

/** Fetch events for a UI-selected yyyy-MM-dd using local-day bounds (not system today). */
export async function fetchCalendarEventsForDate(
    accessToken: string,
    targetDateStr: string | undefined,
    uiCurrentDate: string
): Promise<{
    dateStr: string;
    events: CalendarEvent[];
    defaultReminders: CalendarReminderOverride[];
}> {
    const dateStr = resolveCalendarSyncDate(targetDateStr, uiCurrentDate);
    const request = buildGoogleCalendarDayRequest(dateStr);
    const response = await fetch(request.urlPathWithQuery, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    assertCalendarResponseAuthorized(response);

    const data = await response.json();
    return {
        dateStr,
        events: data.items || [],
        // useDefault のイベント用。events.list は最上位でカレンダー既定の通知を返す。
        defaultReminders: data.defaultReminders || [],
    };
}

function assertCalendarResponseAuthorized(response: Response): void {
    if (response.ok) {
        return;
    }
    if (response.status === 401 || response.status === 403) {
        throw new GoogleCalendarAuthorizationError(response.status);
    }
    throw new Error(`Failed to fetch calendar events (${response.status})`);
}
