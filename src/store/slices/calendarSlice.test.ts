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

    it('imports events across a week without changing the viewed day', async () => {
        const bulkAddTasks = vi.fn().mockResolvedValue(undefined);
        const updateTask = vi.fn().mockResolvedValue(true);
        const addAlarm = vi.fn().mockResolvedValue({ id: 'alarm-1' });
        const setCurrentDate = vi.fn();

        const state = {
            user: { uid: 'user-1' },
            currentDate: '2026-09-16',
            tasks: [],
            sections: [
                {
                    id: 'morning-section',
                    userId: 'user-1',
                    name: 'Morning',
                    startTime: '06:00',
                    endTime: '12:00',
                    order: 0,
                },
            ],
            bulkAddTasks,
            updateTask,
            addAlarm,
            setCurrentDate,
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
                            id: 'mon',
                            summary: 'Monday standup',
                            start: { date: '2026-09-14' },
                            end: { date: '2026-09-15' },
                        },
                        {
                            id: 'wed',
                            summary: 'Wednesday review',
                            start: { dateTime: '2026-09-16T10:00:00' },
                            end: { dateTime: '2026-09-16T11:00:00' },
                            reminders: { useDefault: true },
                        },
                    ],
                    defaultReminders: [{ method: 'popup', minutes: 30 }],
                }),
            })
        );

        const slice = createCalendarSlice(vi.fn(), () => state, {} as never);

        await expect(
            slice.syncGoogleCalendar('calendar-token', {
                start: '2026-09-14',
                end: '2026-09-21',
            })
        ).resolves.toBe('success');

        expect(setCurrentDate).not.toHaveBeenCalled();
        expect(bulkAddTasks).toHaveBeenCalledWith([
            expect.objectContaining({ title: 'Monday standup', date: '2026-09-14' }),
            expect.objectContaining({
                title: 'Wednesday review',
                date: '2026-09-16',
                scheduledStart: '10:00',
                estimatedMinutes: 60,
            }),
        ]);
        expect(addAlarm).toHaveBeenCalledWith(
            expect.objectContaining({
                offsetMinutes: 30,
                label: 'Wednesday review',
            })
        );
    });
});
