import { afterEach, describe, expect, it, vi } from 'vitest';

import { CALENDAR_ALERTS_STORAGE_KEY } from '../../lib/calendarAlerts';
import { buildGoogleCalendarRangeRequest, formatLocalDate } from '../../lib/calendarService';
import type { StoreState } from '../types';
import { createCalendarSlice } from './calendarSlice';

describe('calendarSlice sync state freshness', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses tasks and sections loaded while the Google request was in flight', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);
        const setCurrentDate = vi.fn();

        const baseState = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-30',
            tasks: [],
            sections: [],
            bulkAddTasks,
            updateTask,
            setCurrentDate,
        } as unknown as StoreState;

        const readyState = {
            ...baseState,
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '09:00',
                    order: 0,
                },
            ],
        } as StoreState;

        let currentState = baseState;
        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(async () => {
                currentState = readyState;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        items: [
                            {
                                id: 'calendar-event-1',
                                summary: 'Selected-day event',
                                start: { date: '2026-07-30' },
                                end: { date: '2026-07-31' },
                            },
                        ],
                    }),
                };
            })
        );

        const slice = createCalendarSlice(
            vi.fn(),
            () => currentState,
            {} as never
        );

        await expect(
            slice.syncGoogleCalendar('calendar-token', '2026-07-30')
        ).resolves.toBe('success');

        expect(bulkAddTasks).toHaveBeenCalledTimes(1);
        expect(bulkAddTasks).toHaveBeenCalledWith([
            expect.objectContaining({
                title: 'Selected-day event',
                date: '2026-07-30',
                sectionId: 'morning-section',
            }),
        ]);
        expect(setCurrentDate).not.toHaveBeenCalled();
    });

    it('moves the open day when a one-day sync targets a different date', async () => {
        const setCurrentDate = vi.fn();
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-14',
            tasks: [],
            sections: [{ id: 'morning-section', userId: 'user-1', name: 'Morning', order: 0 }],
            bulkAddTasks,
            updateTask: vi.fn(),
            setCurrentDate,
        } as unknown as StoreState;

        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                items: [{
                    id: 'one-day',
                    summary: 'Other day',
                    start: { date: '2026-07-18' },
                }],
            }),
        }));

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(slice.syncGoogleCalendar('token', '2026-07-18')).resolves.toBe('success');
        expect(setCurrentDate).toHaveBeenCalledWith('2026-07-18');
        expect(bulkAddTasks).toHaveBeenCalledWith([
            expect.objectContaining({ title: 'Other day', date: '2026-07-18' }),
        ]);
    });

    it('imports each day of a range without moving the open day, and arms a start reminder', async () => {
        const setCurrentDate = vi.fn();
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const alertMock = vi.fn();
        const storage = new Map<string, string>();
        const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        const later = new Date(start);
        later.setDate(later.getDate() + 6);
        const startDate = formatLocalDate(start);
        const endDate = formatLocalDate(later);

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-01-01',
            tasks: [],
            sections: [{ id: 'morning-section', userId: 'user-1', name: 'Morning', order: 0 }],
            bulkAddTasks,
            updateTask: vi.fn().mockResolvedValue(true),
            setCurrentDate,
        } as unknown as StoreState;

        vi.stubGlobal('alert', alertMock);
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                items: [
                    {
                        id: 'timed-meeting',
                        summary: '案件面談',
                        start: { dateTime: start.toISOString() },
                        end: { dateTime: end.toISOString() },
                    },
                    {
                        id: 'later-all-day',
                        summary: '週の終わり',
                        start: { date: endDate },
                    },
                    {
                        id: 'cancelled-meeting',
                        summary: '中止した面談',
                        status: 'cancelled',
                        start: { dateTime: start.toISOString() },
                        end: { dateTime: end.toISOString() },
                    },
                ],
            }),
        }));

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(
            slice.syncGoogleCalendar('token', startDate, endDate)
        ).resolves.toBe('success');

        expect(setCurrentDate).not.toHaveBeenCalled();
        expect(bulkAddTasks).toHaveBeenCalledWith([
            expect.objectContaining({ title: '案件面談', date: startDate }),
            expect.objectContaining({ title: '週の終わり', date: endDate }),
        ]);

        const fetchUrl = new URL((vi.mocked(fetch).mock.calls[0]?.[0] ?? '') as string);
        const expected = buildGoogleCalendarRangeRequest(startDate, endDate);
        expect(fetchUrl.searchParams.get('timeMin')).toBe(expected.timeMin);
        expect(fetchUrl.searchParams.get('timeMax')).toBe(expected.timeMax);

        const stored = JSON.parse(storage.get(CALENDAR_ALERTS_STORAGE_KEY) ?? '[]') as Array<{ title: string }>;
        expect(stored.map((alert) => alert.title)).toEqual(['案件面談']);
        expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('開始前の通知を1件セットしました。'));
        expect(alertMock).not.toHaveBeenCalledWith('No new events to import.');
    });

    it('does not import an event whose link is already on a task', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);
        const alert = vi.fn();
        const link = 'https://calendar.google.com/calendar/event?eid=same-event&ctz=Asia/Tokyo';

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-30',
            tasks: [
                {
                    id: 'task-1',
                    userId: 'user-1',
                    title: '名前を変えた',
                    date: '2026-07-29',
                    sectionId: 'morning-section',
                    status: 'open',
                    externalLink: 'https://www.google.com/calendar/event?eid=same-event',
                },
            ],
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '09:00',
                    order: 0,
                },
            ],
            bulkAddTasks,
            updateTask,
            setCurrentDate: vi.fn(),
        } as unknown as StoreState;

        vi.stubGlobal('alert', alert);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        {
                            id: 'calendar-event-1',
                            summary: '元の予定名',
                            htmlLink: link,
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                        {
                            id: 'calendar-event-1-again',
                            summary: '元の予定名',
                            htmlLink: 'https://www.google.com/calendar/event?eid=same-event',
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                    ],
                }),
            })
        );

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(slice.syncGoogleCalendar('calendar-token', '2026-07-30')).resolves.toBe('success');

        expect(bulkAddTasks).not.toHaveBeenCalled();
        expect(updateTask).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith('No new events to import.');
    });

    it('keeps a second same-day event with a different link, and backfills a linkless import', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-30',
            tasks: [
                {
                    id: 'legacy-task',
                    userId: 'user-1',
                    title: '買い物',
                    date: '2026-07-30',
                    sectionId: 'morning-section',
                    status: 'open',
                },
            ],
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '09:00',
                    order: 0,
                },
            ],
            bulkAddTasks,
            updateTask,
            setCurrentDate: vi.fn(),
        } as unknown as StoreState;

        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        {
                            id: 'legacy-event',
                            summary: '買い物',
                            htmlLink: 'https://www.google.com/calendar/event?eid=legacy',
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                        {
                            id: 'other-event',
                            summary: '買い物',
                            htmlLink: 'https://www.google.com/calendar/event?eid=other',
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                    ],
                }),
            })
        );

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(slice.syncGoogleCalendar('calendar-token', '2026-07-30')).resolves.toBe('success');

        expect(updateTask).toHaveBeenCalledWith('legacy-task', {
            externalLink: 'https://www.google.com/calendar/event?eid=legacy',
        });
        expect(bulkAddTasks).toHaveBeenCalledWith([
            expect.objectContaining({
                title: '買い物',
                date: '2026-07-30',
                externalLink: 'https://www.google.com/calendar/event?eid=other',
            }),
        ]);
    });

    it('reports a link backfill instead of saying nothing was imported', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);
        const alert = vi.fn();

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-30',
            tasks: [
                {
                    id: 'legacy-task',
                    userId: 'user-1',
                    title: '買い物',
                    date: '2026-07-30',
                    sectionId: 'morning-section',
                    status: 'open',
                },
            ],
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '09:00',
                    order: 0,
                },
            ],
            bulkAddTasks,
            updateTask,
            setCurrentDate: vi.fn(),
        } as unknown as StoreState;

        vi.stubGlobal('alert', alert);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        {
                            id: 'legacy-event',
                            summary: '買い物',
                            htmlLink: 'https://www.google.com/calendar/event?eid=legacy',
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                    ],
                }),
            })
        );

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(slice.syncGoogleCalendar('calendar-token', '2026-07-30')).resolves.toBe('success');

        expect(updateTask).toHaveBeenCalledWith('legacy-task', {
            externalLink: 'https://www.google.com/calendar/event?eid=legacy',
        });
        expect(bulkAddTasks).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith('Fixed 1 existing events.');
        expect(alert).not.toHaveBeenCalledWith('No new events to import.');
    });

    it('removes an untouched duplicate copy and keeps the one already worked on', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const bulkDeleteTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);
        const alert = vi.fn();
        const link = 'https://www.google.com/calendar/event?eid=same-event';

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-07-30',
            tasks: [
                {
                    id: 'worked',
                    userId: 'user-1',
                    title: '打ち合わせ',
                    date: '2026-07-30',
                    sectionId: 'morning-section',
                    status: 'done',
                    actualMinutes: 25,
                    externalLink: link,
                    createdAt: 10,
                },
                {
                    id: 'blank-copy',
                    userId: 'user-1',
                    title: '打ち合わせ',
                    date: '2026-07-30',
                    sectionId: 'morning-section',
                    status: 'open',
                    actualMinutes: 0,
                    externalLink: 'https://calendar.google.com/calendar/event?eid=same-event&ctz=Asia/Tokyo',
                    createdAt: 20,
                },
            ],
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '09:00',
                    order: 0,
                },
            ],
            bulkAddTasks,
            bulkDeleteTasks,
            updateTask,
            setCurrentDate: vi.fn(),
        } as unknown as StoreState;

        vi.stubGlobal('alert', alert);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    items: [
                        {
                            id: 'calendar-event-1',
                            summary: '打ち合わせ',
                            htmlLink: link,
                            start: { date: '2026-07-30' },
                            end: { date: '2026-07-31' },
                        },
                    ],
                }),
            })
        );

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);
        await expect(slice.syncGoogleCalendar('calendar-token', '2026-07-30')).resolves.toBe('success');

        expect(bulkAddTasks).not.toHaveBeenCalled();
        expect(bulkDeleteTasks).toHaveBeenCalledWith(['blank-copy']);
        expect(alert).toHaveBeenCalledWith('Removed 1 duplicate event.');
    });
});
