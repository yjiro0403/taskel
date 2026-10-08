import { googleEventIdForIntake, isGoogleEventId } from '@/lib/schedule/idempotency';
import { addDaysToDate } from '@/lib/schedule/time';
import type { ScheduleCandidate } from '@/lib/schedule/types';

export interface GoogleEventWrite {
    id: string;
    summary: string;
    start: { dateTime: string; timeZone: string } | { date: string };
    end: { dateTime: string; timeZone: string } | { date: string };
}

export function buildGoogleEventWrite(intakeId: string, candidate: ScheduleCandidate): GoogleEventWrite | null {
    if (!candidate.title || !candidate.date) {
        return null;
    }
    const id = googleEventIdForIntake(intakeId);
    if (!isGoogleEventId(id)) {
        return null;
    }
    if (candidate.allDay) {
        const endDate = addDaysToDate(candidate.date, 1);
        if (!endDate) {
            return null;
        }
        return {
            id,
            summary: candidate.title,
            start: { date: candidate.date },
            end: { date: endDate },
        };
    }
    if (!candidate.startTime || !candidate.endTime) {
        return null;
    }
    return {
        id,
        summary: candidate.title,
        start: { dateTime: `${candidate.date}T${candidate.startTime}:00`, timeZone: candidate.timeZone },
        end: { dateTime: `${candidate.date}T${candidate.endTime}:00`, timeZone: candidate.timeZone },
    };
}

export interface GoogleEventResult {
    id: string;
    htmlLink: string | null;
    status: number;
}

export class GoogleCalendarWriteError extends Error {
    constructor(
        public readonly status: number,
        public readonly reason: string,
    ) {
        super(`Google Calendar write failed (${status})`);
        this.name = 'GoogleCalendarWriteError';
    }
}

async function googleReason(response: Response): Promise<string> {
    try {
        const body = await response.json() as {
            error?: { status?: string; errors?: Array<{ reason?: string }> };
        };
        const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
        return String(reason).slice(0, 80);
    } catch {
        return '';
    }
}

async function googleFetch(accessToken: string, url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
    });
}

function eventUrl(calendarId: string, eventId?: string): string {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

/**
 * Insert the event with our id. A 409 means a previous attempt already created it,
 * so the caller patches that same id instead of creating another event.
 */
export async function upsertGoogleEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleEventWrite,
): Promise<GoogleEventResult> {
    const existing = await googleFetch(accessToken, eventUrl(calendarId, event.id), { method: 'GET' });
    if (existing.status === 401 || existing.status === 403) {
        throw new GoogleCalendarWriteError(existing.status, await googleReason(existing));
    }

    const method = existing.ok ? 'PATCH' : 'POST';
    const url = existing.ok ? eventUrl(calendarId, event.id) : eventUrl(calendarId);
    const response = await googleFetch(accessToken, url, {
        method,
        body: JSON.stringify(event),
    });
    if (response.status === 409) {
        const again = await googleFetch(accessToken, eventUrl(calendarId, event.id), { method: 'GET' });
        if (!again.ok) {
            throw new GoogleCalendarWriteError(again.status, await googleReason(again));
        }
        const data = await again.json() as { id?: string; htmlLink?: string };
        return { id: data.id ?? event.id, htmlLink: data.htmlLink ?? null, status: again.status };
    }
    if (!response.ok) {
        throw new GoogleCalendarWriteError(response.status, await googleReason(response));
    }
    const data = await response.json() as { id?: string; htmlLink?: string };
    return { id: data.id ?? event.id, htmlLink: data.htmlLink ?? null, status: response.status };
}

export async function deleteGoogleEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
): Promise<void> {
    if (!isGoogleEventId(eventId)) {
        throw new GoogleCalendarWriteError(400, 'invalid_event_id');
    }
    const response = await googleFetch(accessToken, eventUrl(calendarId, eventId), { method: 'DELETE' });
    if (response.status === 404 || response.status === 410) {
        return;
    }
    if (!response.ok) {
        throw new GoogleCalendarWriteError(response.status, await googleReason(response));
    }
}
