import { describe, expect, it } from 'vitest';

import { assignOverlapColumns, isUnscheduledTask, scheduledTaskInterval } from './layout';
import type { Task } from '../../types';

function task(partial: Partial<Task> & Pick<Task, 'id'>): Task {
    return {
        userId: 'u1',
        title: partial.title ?? partial.id,
        sectionId: 's1',
        date: '2026-09-19',
        status: 'open',
        estimatedMinutes: 60,
        actualMinutes: 0,
        order: 0,
        ...partial,
    };
}

describe('timeline layout', () => {
    it('places overlapping tasks in adjacent columns', () => {
        const layout = assignOverlapColumns([
            { id: 'drive', startMin: 15 * 60, endMin: 16 * 60 },
            { id: 'talk', startMin: 15 * 60, endMin: 15 * 60 + 30 },
        ]);
        expect(layout.drive.colCount).toBe(2);
        expect(layout.talk.colCount).toBe(2);
        expect(new Set([layout.drive.col, layout.talk.col]).size).toBe(2);
    });

    it('does not overlap tasks that only touch at the boundary', () => {
        const layout = assignOverlapColumns([
            { id: 'a', startMin: 10 * 60, endMin: 11 * 60 },
            { id: 'b', startMin: 11 * 60, endMin: 12 * 60 },
        ]);
        expect(layout.a.colCount).toBe(1);
        expect(layout.b.colCount).toBe(1);
        expect(layout.a.col).toBe(0);
        expect(layout.b.col).toBe(0);
    });

    it('treats missing scheduledStart as unscheduled', () => {
        expect(isUnscheduledTask(task({ id: 'u' }))).toBe(true);
        expect(isUnscheduledTask(task({ id: 's', scheduledStart: '10:00' }))).toBe(false);
        expect(scheduledTaskInterval(task({ id: 's', scheduledStart: '10:00', estimatedMinutes: 30 }))).toEqual({
            id: 's',
            startMin: 600,
            endMin: 630,
        });
    });
});

describe('actual-time intervals', () => {
    const at = (h: number, m: number) => new Date(2026, 8, 19, h, m).getTime();

    it('draws a running task from its real start and grows it to now', () => {
        const running = task({ id: 'run', status: 'in_progress', scheduledStart: '17:00', estimatedMinutes: 15, startedAt: at(15, 25) });
        expect(scheduledTaskInterval(running, { nowMin: 15 * 60 + 30 })).toEqual({ id: 'run', startMin: 15 * 60 + 25, endMin: 15 * 60 + 40 });
        expect(scheduledTaskInterval(running, { nowMin: 16 * 60 })).toEqual({ id: 'run', startMin: 15 * 60 + 25, endMin: 16 * 60 });
        expect(isUnscheduledTask(task({ id: 'r2', status: 'in_progress', startedAt: at(9, 0) }))).toBe(false);
    });

    it('draws a finished task by its logged minutes ending at the completion time', () => {
        const done = task({ id: 'done', status: 'done', scheduledStart: '17:00', actualMinutes: 30, completedAt: at(15, 55) });
        expect(scheduledTaskInterval(done)).toEqual({ id: 'done', startMin: 15 * 60 + 25, endMin: 15 * 60 + 55 });
        // A one-minute run ends at the real stop time, not 15 minutes later.
        const quick = task({ id: 'quick', status: 'done', scheduledStart: '07:03', estimatedMinutes: 30, actualMinutes: 1, completedAt: at(7, 4) });
        expect(scheduledTaskInterval(quick)).toEqual({ id: 'quick', startMin: 7 * 60 + 3, endMin: 7 * 60 + 4 });
    });

    it('falls back to the planned time when the recorded times are not on the task day or missing', () => {
        const yesterday = new Date(2026, 8, 18, 23, 50).getTime();
        expect(scheduledTaskInterval(task({ id: 'a', status: 'in_progress', scheduledStart: '09:00', startedAt: yesterday }))).toEqual({ id: 'a', startMin: 9 * 60, endMin: 10 * 60 });
        expect(scheduledTaskInterval(task({ id: 'b', status: 'done', scheduledStart: '09:00', actualMinutes: 0, completedAt: at(15, 0) }))).toEqual({ id: 'b', startMin: 9 * 60, endMin: 10 * 60 });
        expect(isUnscheduledTask(task({ id: 'c', status: 'done', completedAt: at(15, 0), actualMinutes: 0 }))).toBe(true);
    });
});
