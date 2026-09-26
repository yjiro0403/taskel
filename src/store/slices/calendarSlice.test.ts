import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
