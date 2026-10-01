import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CALENDAR_ALERTS_STORAGE_KEY,
    CALENDAR_ALERT_CATCHUP_MS,
    MAX_STORED_CALENDAR_ALERTS,
    mergeCalendarAlerts,
    partitionDueCalendarAlerts,
    planCalendarAlerts,
    scheduleCalendarAlertsFromEvents,
    type CalendarAlert,
} from './calendarAlerts';
import type { CalendarEvent } from './calendarService';

function atLocal(year: number, monthIndex: number, day: number, hour: number, minute: number) {
    return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function timedEvent(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'start'>): CalendarEvent {
    return {
        id: 'event-1',
        summary: '案件面談',
        ...partial,
    };
}

describe('planCalendarAlerts', () => {
    const now = atLocal(2026, 8, 30, 8, 0);

    it('skips all-day events and events that already ended', () => {
        const alerts = planCalendarAlerts([
            { id: 'all-day', summary: '終日', start: { date: '2026-09-30' } },
            timedEvent({
                id: 'cancelled',
                summary: '中止',
                status: 'cancelled',
                start: { dateTime: atLocal(2026, 8, 30, 11, 0).toISOString() },
                end: { dateTime: atLocal(2026, 8, 30, 12, 0).toISOString() },
            }),
            timedEvent({
                id: 'ended',
                summary: '終わった面談',
                start: { dateTime: atLocal(2026, 8, 30, 6, 0).toISOString() },
                end: { dateTime: atLocal(2026, 8, 30, 7, 0).toISOString() },
            }),
        ], now);

        expect(alerts).toEqual([]);
    });

    it('uses a 10 minute warning unless Google popup overrides say otherwise', () => {
        const start = atLocal(2026, 9, 1, 10, 0);
        const end = atLocal(2026, 9, 1, 11, 0);
        const event = timedEvent({
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            reminders: {
                overrides: [
                    { method: 'email', minutes: 15 },
                    { method: 'popup', minutes: 60 },
                    { method: 'popup', minutes: 10 },
                    { method: 'popup', minutes: 5 },
                    { method: 'popup', minutes: 1 },
                ],
            },
        });

        const alerts = planCalendarAlerts([event], now);
        expect(alerts.map((alert) => alert.alertAt)).toEqual([
            start.getTime() - 60 * 60_000,
            start.getTime() - 10 * 60_000,
            start.getTime() - 5 * 60_000,
        ]);
        expect(alerts.every((alert) => alert.date === '2026-10-01' && alert.scheduledStart === '10:00')).toBe(true);
    });

    it('keeps a meeting later in the month and warns immediately when the reminder already passed', () => {
        const soon = atLocal(2026, 8, 30, 8, 5);
        const later = atLocal(2026, 9, 10, 15, 0);
        const started = atLocal(2026, 8, 30, 7, 50);

        const alerts = planCalendarAlerts([
            timedEvent({
                id: 'soon',
                start: { dateTime: soon.toISOString() },
                end: { dateTime: atLocal(2026, 8, 30, 9, 0).toISOString() },
            }),
            timedEvent({
                id: 'later',
                summary: '月後半',
                start: { dateTime: later.toISOString() },
                end: { dateTime: atLocal(2026, 9, 10, 16, 0).toISOString() },
            }),
            timedEvent({
                id: 'started',
                summary: '開始直後',
                start: { dateTime: started.toISOString() },
                end: { dateTime: atLocal(2026, 8, 30, 9, 0).toISOString() },
            }),
            timedEvent({
                id: 'too-late',
                summary: '猶予切れ',
                start: { dateTime: new Date(now.getTime() - CALENDAR_ALERT_CATCHUP_MS - 60_000).toISOString() },
                end: { dateTime: atLocal(2026, 8, 30, 12, 0).toISOString() },
            }),
        ], now);

        const soonAlert = alerts.find((alert) => alert.key.startsWith('soon'));
        const laterAlert = alerts.find((alert) => alert.title === '月後半');
        const startedAlert = alerts.find((alert) => alert.title === '開始直後');
        expect(soonAlert?.alertAt).toBe(now.getTime());
        expect(laterAlert?.alertAt).toBe(later.getTime() - 10 * 60_000);
        expect(startedAlert?.alertAt).toBe(now.getTime());
        expect(alerts.some((alert) => alert.title === '猶予切れ')).toBe(false);
    });
});

describe('mergeCalendarAlerts', () => {
    it('keeps an already-fired reminder and caps the soonest alerts', () => {
        const now = atLocal(2026, 8, 30, 8, 0).getTime();
        const fired: CalendarAlert = {
            key: 'kept:10',
            title: '通知済み',
            date: '2026-09-30',
            scheduledStart: '09:00',
            alertAt: now + 60_000,
            eventEndAt: now + 60 * 60_000,
            fired: true,
        };
        const incoming: CalendarAlert[] = [
            { ...fired, fired: false, alertAt: now },
            ...Array.from({ length: MAX_STORED_CALENDAR_ALERTS + 5 }, (_, index) => ({
                key: `extra:${index}`,
                title: `予定${index}`,
                date: '2026-10-01',
                scheduledStart: '10:00',
                alertAt: now + (index + 1) * 60_000,
                eventEndAt: now + (index + 2) * 60_000,
                fired: false,
            })),
        ];

        const merged = mergeCalendarAlerts([fired], incoming, now);
        expect(merged).toHaveLength(MAX_STORED_CALENDAR_ALERTS);
        expect(merged.find((alert) => alert.key === 'kept:10')).toMatchObject({ fired: true });
        expect(merged.some((alert) => alert.key === `extra:${MAX_STORED_CALENDAR_ALERTS + 4}`)).toBe(false);
    });
});

describe('partitionDueCalendarAlerts', () => {
    it('announces due meetings, and only marks finished or completed ones', () => {
        const now = 1_000_000;
        const alerts: CalendarAlert[] = [
            {
                key: 'due',
                title: '案件面談',
                date: '2026-09-30',
                scheduledStart: '10:00',
                alertAt: now - 1,
                eventEndAt: now + 1,
                fired: false,
            },
            {
                key: 'ended',
                title: '終了',
                date: '2026-09-30',
                scheduledStart: '08:00',
                alertAt: now - 1,
                eventEndAt: now,
                fired: false,
            },
            {
                key: 'done',
                title: '完了',
                date: '2026-09-30',
                scheduledStart: '09:00',
                alertAt: now - 1,
                eventEndAt: now + 1,
                fired: false,
            },
            {
                key: 'later',
                title: 'これから',
                date: '2026-09-30',
                scheduledStart: '12:00',
                alertAt: now + 1,
                eventEndAt: now + 10,
                fired: false,
            },
        ];

        expect(partitionDueCalendarAlerts(alerts, now, (alert) => alert.key === 'done')).toEqual({
            announce: [alerts[0]],
            markFired: ['due', 'ended', 'done'],
        });
    });
});

describe('scheduleCalendarAlertsFromEvents', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stores reminders and does not revive one that already fired', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });

        const start = atLocal(2026, 9, 1, 10, 0);
        const event = timedEvent({
            id: 'meeting',
            start: { dateTime: start.toISOString() },
            end: { dateTime: atLocal(2026, 9, 1, 11, 0).toISOString() },
        });
        const now = atLocal(2026, 8, 30, 8, 0);

        expect(scheduleCalendarAlertsFromEvents([event], now)).toBe(1);
        const stored = JSON.parse(storage.get(CALENDAR_ALERTS_STORAGE_KEY) ?? '[]') as CalendarAlert[];
        stored[0].fired = true;
        storage.set(CALENDAR_ALERTS_STORAGE_KEY, JSON.stringify(stored));

        expect(scheduleCalendarAlertsFromEvents([event], now)).toBe(0);
        const again = JSON.parse(storage.get(CALENDAR_ALERTS_STORAGE_KEY) ?? '[]') as CalendarAlert[];
        expect(again[0].fired).toBe(true);
    });
});
