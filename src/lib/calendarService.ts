interface CalendarEvent {
    id: string;
    summary: string;
    htmlLink?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
}

export const CURRENT_DATE_STORAGE_KEY = 'taskel_current_date';
export const PENDING_GOOGLE_CALENDAR_SYNC_KEY = 'pending_google_calendar_sync';

/**
 * Build local-midnight → local-end-of-day bounds from a UI date string (yyyy-MM-dd).
 * Avoids `new Date('yyyy-MM-dd')` which parses as UTC and shifts the calendar day
 * in timezones behind UTC.
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
        end: new Date(year, month - 1, day, 23, 59, 59, 999),
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

    if (!response.ok) {
        throw new Error('Failed to fetch calendar events');
    }

    const data = await response.json();
    return data.items || [];
}

/** Fetch events for a UI-selected yyyy-MM-dd using local-day bounds (not system today). */
export async function fetchCalendarEventsForDate(
    accessToken: string,
    targetDateStr: string | undefined,
    uiCurrentDate: string
): Promise<{ dateStr: string; events: CalendarEvent[] }> {
    const dateStr = resolveCalendarSyncDate(targetDateStr, uiCurrentDate);
    const request = buildGoogleCalendarDayRequest(dateStr);
    const response = await fetch(request.urlPathWithQuery, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch calendar events');
    }

    const data = await response.json();
    return { dateStr, events: data.items || [] };
}
