import { describe, expect, it, vi } from 'vitest';

import {
    createAlarmDraft,
    fireAtForOffset,
    persistAlarmDrafts,
    removeAlarmDraft,
    updateAlarmDraft,
    type AlarmDraft,
} from './alarmDrafts';

describe('alarm draft list helpers', () => {
    it('creates a scheduled draft, optionally with a relative offset', () => {
        expect(createAlarmDraft({ fireAt: 123, id: 'draft-1' })).toEqual({
            id: 'draft-1',
            fireAt: 123,
            status: 'scheduled',
        });
        expect(createAlarmDraft({ fireAt: 200, offsetMinutes: 30, id: 'rel' })).toEqual({
            id: 'rel',
            fireAt: 200,
            status: 'scheduled',
            offsetMinutes: 30,
        });
    });

    it('updates and removes by id without mutating the original list', () => {
        const drafts: AlarmDraft[] = [
            { id: 'a', fireAt: 1, status: 'scheduled', offsetMinutes: 30 },
            { id: 'b', fireAt: 2, status: 'scheduled' },
        ];

        const updated = updateAlarmDraft(drafts, 'b', { fireAt: 20, status: 'dismissed' });
        expect(updated).toEqual([
            { id: 'a', fireAt: 1, status: 'scheduled', offsetMinutes: 30 },
            { id: 'b', fireAt: 20, status: 'dismissed' },
        ]);
        expect(drafts[1]).toEqual({ id: 'b', fireAt: 2, status: 'scheduled' });

        const clearedOffset = updateAlarmDraft(drafts, 'a', { offsetMinutes: undefined, fireAt: 9 });
        expect(clearedOffset[0]).toEqual({ id: 'a', fireAt: 9, status: 'scheduled' });
        expect('offsetMinutes' in clearedOffset[0]).toBe(false);

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

    it('recomputes relative fireAt from the saved start time and keeps offsetMinutes', async () => {
        const startMillis = new Date('2026-09-16T10:00:00').getTime();
        const addAlarm = vi.fn().mockResolvedValue({ id: 'a1' });
        const updateAlarm = vi.fn().mockResolvedValue(true);

        const result = await persistAlarmDrafts({
            drafts: [{ id: 'rel', fireAt: 1, status: 'scheduled', offsetMinutes: 30 }],
            taskId: 'task-1',
            label: 'Title',
            startMillis,
            addAlarm,
            updateAlarm,
        });

        expect(result.remaining).toEqual([]);
        expect(addAlarm).toHaveBeenCalledWith({
            taskId: 'task-1',
            label: 'Title',
            fireAt: fireAtForOffset(startMillis, 30),
            offsetMinutes: 30,
        });
        expect(updateAlarm).not.toHaveBeenCalled();
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
