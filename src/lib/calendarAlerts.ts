import { formatLocalDate, type CalendarEvent } from './calendarService';

export const CALENDAR_ALERTS_STORAGE_KEY = 'taskel_calendar_alerts';
export const CALENDAR_ALERTS_CHANGED_EVENT = 'taskel-calendar-alerts-changed';
export const DEFAULT_REMINDER_MINUTES = 10;
export const MAX_POPUP_OVERRIDES = 3;
export const MAX_STORED_CALENDAR_ALERTS = 200;
/** Reminders that already passed still fire while the meeting is within this window of its start. */
export const CALENDAR_ALERT_CATCHUP_MS = 30 * 60 * 1000;
const MISSING_END_MS = 30 * 60 * 1000;

export interface CalendarAlert {
    key: string;
    title: string;
    date: string;
    scheduledStart: string;
    alertAt: number;
    eventEndAt: number;
    fired: boolean;
}

export function reminderMinutesForEvent(event: CalendarEvent): number[] {
    const popupMinutes = (event.reminders?.overrides ?? [])
        .filter((override) => (
            override.method === 'popup'
            && typeof override.minutes === 'number'
            && override.minutes >= 0
        ))
        .slice(0, MAX_POPUP_OVERRIDES)
        .map((override) => override.minutes as number);
    const unique = [...new Set(popupMinutes)];
    return unique.length > 0 ? unique : [DEFAULT_REMINDER_MINUTES];
}

function formatHoursMinutes(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function eventIdentity(event: CalendarEvent, startIso: string): string {
    if (event.id) return event.id;
    if (event.htmlLink) return event.htmlLink;
    return `${event.summary}|${startIso}`;
}

/**
 * Timed events only. All-day events are imported as tasks but not alerted.
 * A passed reminder still alerts when the meeting has not ended and is within
 * 30 minutes of its start, so opening the app in the morning still warns.
 * Farther-future events are kept (capped later) so a monthly import still
 * reminds you later in the month.
 */
export function planCalendarAlerts(events: CalendarEvent[], now: Date): CalendarAlert[] {
    const nowMs = now.getTime();
    const alerts: CalendarAlert[] = [];

    for (const event of events) {
        if (!event.summary || !event.start?.dateTime || event.status === 'cancelled') continue;
        const startMs = new Date(event.start.dateTime).getTime();
        if (Number.isNaN(startMs)) continue;

        let endMs = startMs + MISSING_END_MS;
        if (event.end?.dateTime) {
            const parsedEnd = new Date(event.end.dateTime).getTime();
            if (!Number.isNaN(parsedEnd) && parsedEnd > startMs) {
                endMs = parsedEnd;
            }
        }
        if (nowMs >= endMs) continue;

        const start = new Date(startMs);
        const identity = eventIdentity(event, event.start.dateTime);
        const catchUpDeadline = Math.min(endMs, startMs + CALENDAR_ALERT_CATCHUP_MS);
        let scheduledImmediate = false;

        for (const minutes of reminderMinutesForEvent(event)) {
            let alertAt = startMs - minutes * 60_000;
            if (alertAt <= nowMs) {
                if (nowMs >= catchUpDeadline || scheduledImmediate) continue;
                alertAt = nowMs;
                scheduledImmediate = true;
            }
            alerts.push({
                key: `${identity}:${minutes}`,
                title: event.summary,
                date: formatLocalDate(start),
                scheduledStart: formatHoursMinutes(start),
                alertAt,
                eventEndAt: endMs,
                fired: false,
            });
        }
    }

    alerts.sort((a, b) => a.alertAt - b.alertAt || a.key.localeCompare(b.key));
    return alerts;
}

export function mergeCalendarAlerts(
    existing: CalendarAlert[],
    incoming: CalendarAlert[],
    nowMs: number
): CalendarAlert[] {
    const fired = new Map(
        existing.filter((alert) => alert.fired).map((alert) => [alert.key, alert])
    );
    const merged = new Map<string, CalendarAlert>();

    for (const alert of incoming) {
        merged.set(alert.key, fired.get(alert.key) ?? alert);
    }

    for (const alert of fired.values()) {
        if (!merged.has(alert.key) && alert.eventEndAt > nowMs - 24 * 60 * 60 * 1000) {
            merged.set(alert.key, alert);
        }
    }

    return [...merged.values()]
        .sort((a, b) => a.alertAt - b.alertAt || a.key.localeCompare(b.key))
        .slice(0, MAX_STORED_CALENDAR_ALERTS);
}

export function partitionDueCalendarAlerts(
    alerts: readonly CalendarAlert[],
    nowMs: number,
    isDone: (alert: CalendarAlert) => boolean
): { announce: CalendarAlert[]; markFired: string[] } {
    const announce: CalendarAlert[] = [];
    const markFired: string[] = [];
    for (const alert of alerts) {
        if (alert.fired || alert.alertAt > nowMs) continue;
        markFired.push(alert.key);
        if (alert.eventEndAt <= nowMs || isDone(alert)) continue;
        announce.push(alert);
    }
    return { announce, markFired };
}

function isCalendarAlert(value: unknown): value is CalendarAlert {
    if (!value || typeof value !== 'object') return false;
    const alert = value as Partial<CalendarAlert>;
    return typeof alert.key === 'string'
        && typeof alert.title === 'string'
        && typeof alert.date === 'string'
        && typeof alert.scheduledStart === 'string'
        && typeof alert.alertAt === 'number'
        && typeof alert.eventEndAt === 'number'
        && typeof alert.fired === 'boolean';
}

export function readCalendarAlerts(): CalendarAlert[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(CALENDAR_ALERTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isCalendarAlert);
    } catch {
        return [];
    }
}

export function writeCalendarAlerts(alerts: CalendarAlert[]): boolean {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(CALENDAR_ALERTS_STORAGE_KEY, JSON.stringify(alerts));
        window.dispatchEvent(new Event(CALENDAR_ALERTS_CHANGED_EVENT));
        return true;
    } catch {
        return false;
    }
}

export function markCalendarAlertsFired(keys: readonly string[]): void {
    if (keys.length === 0) return;
    const keySet = new Set(keys);
    const alerts = readCalendarAlerts();
    let changed = false;
    for (const alert of alerts) {
        if (keySet.has(alert.key) && !alert.fired) {
            alert.fired = true;
            changed = true;
        }
    }
    if (changed) writeCalendarAlerts(alerts);
}

/** Returns how many not-yet-fired reminders were stored. Already-fired keys stay fired. */
export function scheduleCalendarAlertsFromEvents(events: CalendarEvent[], now = new Date()): number {
    const incoming = planCalendarAlerts(events, now);
    const existing = readCalendarAlerts();
    const firedKeys = new Set(existing.filter((alert) => alert.fired).map((alert) => alert.key));
    const merged = mergeCalendarAlerts(existing, incoming, now.getTime());
    if (!writeCalendarAlerts(merged)) return 0;
    return merged.filter((alert) => !alert.fired && !firedKeys.has(alert.key) && incoming.some((item) => item.key === alert.key)).length;
}

export function meetingAlertLines(alerts: readonly CalendarAlert[]): string {
    return alerts.map((alert) => `${alert.date} ${alert.scheduledStart} ${alert.title}`).join('\n');
}
