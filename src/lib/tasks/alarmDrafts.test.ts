import { describe, expect, it, vi } from 'vitest';

import {
    createAlarmDraft,
    persistAlarmDrafts,
    removeAlarmDraft,
    taskStartToMillis,
    toDatetimeLocalValue,
    updateAlarmDraft,
    type AlarmDraft,
} from './alarmDrafts';

describe('toDatetimeLocalValue', () => {
    it('formats local date-time without seconds or timezone', () => {
        const ms = new Date(2026, 8, 15, 9, 5, 30).getTime();
        expect(toDatetimeLocalValue(ms)).toBe('2026-09-15T09:05');
    });

    it('zero-pads month, day, hour, and minute', () => {
        const ms = new Date(2026, 0, 2, 3, 4).getTime();
        expect(toDatetimeLocalValue(ms)).toBe('2026-01-02T03:04');
    });
});

describe('taskStartToMillis', () => {
    it('converts date + HH:mm to local epoch ms', () => {
        expect(taskStartToMillis('2026-09-15', '09:05')).toBe(
            new Date('2026-09-15T09:05:00').getTime()
        );
    });

    it('rejects missing or malformed inputs', () => {
        expect(taskStartToMillis('', '09:00')).toBeNull();
        expect(taskStartToMillis('2026-09-15', '')).toBeNull();
        expect(taskStartToMillis('2026-09-15', '9:00')).toBeNull();
        expect(taskStartToMillis('09:00', '2026-09-15')).toBeNull();
        expect(taskStartToMillis('2026-09-15', '09:00:00')).toBeNull();
    });
});

describe('alarm draft list helpers', () => {
    it('creates a scheduled draft', () => {
        const draft = createAlarmDraft(123, 'draft-1');
        expect(draft).toEqual({ id: 'draft-1', fireAt: 123, status: 'scheduled' });
    });

    it('updates and removes by id without mutating the original list', () => {
        const drafts: AlarmDraft[] = [
            { id: 'a', fireAt: 1, status: 'scheduled' },
            { id: 'b', fireAt: 2, status: 'scheduled' },
        ];

        const updated = updateAlarmDraft(drafts, 'b', { fireAt: 20, status: 'dismissed' });
        expect(updated).toEqual([
            { id: 'a', fireAt: 1, status: 'scheduled' },
            { id: 'b', fireAt: 20, status: 'dismissed' },
        ]);
        expect(drafts[1]).toEqual({ id: 'b', fireAt: 2, status: 'scheduled' });

        expect(removeAlarmDraft(updated, 'a')).toEqual([
            { id: 'b', fireAt: 20, status: 'dismissed' },
        ]);
    });
});

describe('persistAlarmDrafts', () => {
    const drafts: AlarmDraft[] = [
        { id: 'd1', fireAt: 100, status: 'scheduled' },
        { id: 'd2', fireAt: 200, status: 'dismissed' },
        { id: 'd3', fireAt: 300, status: 'scheduled' },
    ];

    it('creates each draft and updates non-scheduled status', async () => {
        const addAlarm = vi.fn()
            .mockResolvedValueOnce({ id: 'a1' })
            .mockResolvedValueOnce({ id: 'a2' })
            .mockResolvedValueOnce({ id: 'a3' });
        const updateAlarm = vi.fn().mockResolvedValue(true);

        const result = await persistAlarmDrafts({
            drafts,
            taskId: 'task-1',
            label: '  Morning review  ',
            addAlarm,
            updateAlarm,
        });

        expect(result.remaining).toEqual([]);
        expect(addAlarm).toHaveBeenCalledTimes(3);
        expect(addAlarm).toHaveBeenNthCalledWith(1, {
            taskId: 'task-1',
            label: 'Morning review',
            fireAt: 100,
        });
        expect(updateAlarm).toHaveBeenCalledTimes(1);
        expect(updateAlarm).toHaveBeenCalledWith('a2', { status: 'dismissed' });
    });

    it('stops on create failure and returns only the unwritten drafts', async () => {
        const addAlarm = vi.fn()
            .mockResolvedValueOnce({ id: 'a1' })
            .mockResolvedValueOnce(null);
        const updateAlarm = vi.fn().mockResolvedValue(true);

        const result = await persistAlarmDrafts({
            drafts,
            taskId: 'task-1',
            label: 'Title',
            addAlarm,
            updateAlarm,
        });

        expect(result.remaining).toEqual([
            { id: 'd2', fireAt: 200, status: 'dismissed' },
            { id: 'd3', fireAt: 300, status: 'scheduled' },
        ]);
        expect(addAlarm).toHaveBeenCalledTimes(2);
        expect(updateAlarm).not.toHaveBeenCalled();
    });

    it('consumes a draft even if the follow-up status update fails', async () => {
        const addAlarm = vi.fn()
            .mockResolvedValueOnce({ id: 'a1' })
            .mockResolvedValueOnce(null);
        const updateAlarm = vi.fn().mockResolvedValue(false);

        const result = await persistAlarmDrafts({
            drafts: [
                { id: 'off', fireAt: 1, status: 'dismissed' },
                { id: 'next', fireAt: 2, status: 'scheduled' },
            ],
            taskId: 'task-1',
            label: 'Title',
            addAlarm,
            updateAlarm,
        });

        expect(result.remaining).toEqual([{ id: 'next', fireAt: 2, status: 'scheduled' }]);
        expect(updateAlarm).toHaveBeenCalledWith('a1', { status: 'dismissed' });
    });
});
