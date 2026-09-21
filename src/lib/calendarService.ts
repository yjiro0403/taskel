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

/** Half-open local date range [start, end). end is the first day not included. */
export type CalendarSyncRange = {
    start: string;
    end: string;
};

export function addLocalDays(dateStr: string, days: number): string {
    const { start } = getLocalDayRange(dateStr);
    return formatLocalDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days));
}

export function daySyncRange(dateStr: string): CalendarSyncRange {
    return { start: dateStr, end: addLocalDays(dateStr, 1) };
}

/** ISO-style week starting Monday, matching PlanningView. */
export function weekSyncRangeContaining(dateStr: string): CalendarSyncRange {
    const { start } = getLocalDayRange(dateStr);
    const weekday = start.getDay(); // 0 = Sunday
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + mondayOffset);
    const startDate = formatLocalDate(monday);
    return { start: startDate, end: addLocalDays(startDate, 7) };
}

export function monthSyncRangeContaining(dateStr: string): CalendarSyncRange {
    const day = getLocalDayRange(dateStr).start;
    const year = day.getFullYear();
    const month = day.getMonth() + 1;
    const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
    return { start, end };
}

export function isSingleDayRange(range: CalendarSyncRange): boolean {
    return range.end === addLocalDays(range.start, 1);
}

export function resolveCalendarSyncRange(
    target: string | CalendarSyncRange | undefined,
    uiCurrentDate: string | undefined
): CalendarSyncRange {
    if (target && typeof target === 'object') {
        if (
            !DATE_ONLY_RE.test(target.start) ||
            !DATE_ONLY_RE.test(target.end) ||
            target.start >= target.end
        ) {
            throw new Error(`No valid UI-selected range for calendar sync: ${target.start}..${target.end}`);
        }
        return { start: target.start, end: target.end };
    }
    return daySyncRange(resolveCalendarSyncDate(target, uiCurrentDate));
}

export function serializePendingCalendarSync(range: CalendarSyncRange): string {
    return JSON.stringify(range);
}

/** Accepts legacy `yyyy-MM-dd` (one day) and `{ start, end }` JSON. */
export function parsePendingCalendarSync(raw: string | null | undefined): CalendarSyncRange | null {
    if (!raw) return null;
    if (DATE_ONLY_RE.test(raw)) {
        return daySyncRange(raw);
    }
    try {
        const parsed = JSON.parse(raw) as { start?: unknown; end?: unknown };
        if (typeof parsed.start === 'string' && typeof parsed.end === 'string') {
            return resolveCalendarSyncRange(parsed as CalendarSyncRange, undefined);
        }
    } catch {
        return null;
    }
    return null;
}

function buildEventsListParams(timeMin: string, timeMax: string, pageToken?: string): URLSearchParams {
    const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
    });
    if (pageToken) {
        params.set('pageToken', pageToken);
    }
    return params;
}

/**
 * Build the Google Calendar events list request for a half-open local date range [start, end).
 */
export function buildGoogleCalendarRangeRequest(startDate: string, endDate: string): {
    start: string;
    end: string;
    timeMin: string;
    timeMax: string;
    urlPathWithQuery: string;
} {
    const range = resolveCalendarSyncRange({ start: startDate, end: endDate }, undefined);
    const timeMin = getLocalDayRange(range.start).start.toISOString();
    const timeMax = getLocalDayRange(range.end).start.toISOString();
    const params = buildEventsListParams(timeMin, timeMax);

    return {
        start: range.start,
        end: range.end,
        timeMin,
        timeMax,
        urlPathWithQuery: `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    };
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
    const request = buildGoogleCalendarRangeRequest(resolved, addLocalDays(resolved, 1));
    return {
        dateStr: resolved,
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        urlPathWithQuery: request.urlPathWithQuery,
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

const CALENDAR_LIST_MAX_PAGES = 20;

async function fetchCalendarEventPages(
    accessToken: string,
    timeMin: string,
    timeMax: string
): Promise<{ events: CalendarEvent[]; defaultReminders: CalendarReminderOverride[] }> {
    const events: CalendarEvent[] = [];
    let defaultReminders: CalendarReminderOverride[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
        const params = buildEventsListParams(timeMin, timeMax, pageToken);
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        assertCalendarResponseAuthorized(response);
        const data = await response.json();
        if (Array.isArray(data.defaultReminders)) {
            defaultReminders = data.defaultReminders;
        }
        if (Array.isArray(data.items)) {
            events.push(...data.items);
        }
        pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken
            ? data.nextPageToken
            : undefined;
        pages += 1;
    } while (pageToken && pages < CALENDAR_LIST_MAX_PAGES);

    return { events, defaultReminders };
}

export async function fetchCalendarEvents(accessToken: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const { events } = await fetchCalendarEventPages(
        accessToken,
        timeMin.toISOString(),
        timeMax.toISOString()
    );
    return events;
}

/** Fetch events for a half-open local date range [start, end). */
export async function fetchCalendarEventsForRange(
    accessToken: string,
    startDate: string,
    endDate: string
): Promise<{
    start: string;
    end: string;
    events: CalendarEvent[];
    defaultReminders: CalendarReminderOverride[];
}> {
    const request = buildGoogleCalendarRangeRequest(startDate, endDate);
    const { events, defaultReminders } = await fetchCalendarEventPages(
        accessToken,
        request.timeMin,
        request.timeMax
    );
    return {
        start: request.start,
        end: request.end,
        events,
        defaultReminders,
    };
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
    const ranged = await fetchCalendarEventsForRange(
        accessToken,
        dateStr,
        addLocalDays(dateStr, 1)
    );
    return {
        dateStr,
        events: ranged.events,
        defaultReminders: ranged.defaultReminders,
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
