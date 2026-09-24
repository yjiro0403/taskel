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
