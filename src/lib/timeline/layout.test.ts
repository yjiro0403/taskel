import { describe, expect, it } from 'vitest';

import {
    assignOverlapColumns,
    blockFitsInlineActions,
    COMPACT_OVERLAP_COLUMN_PX,
    isUnscheduledTask,
    overlapBlockWidth,
    overlapColumnFloorPx,
    overlapTrackWidth,
    READABLE_OVERLAP_COLUMN_PX,
    scheduledTaskInterval,
} from './layout';
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

    it('draws a planned block at its estimate, including 5 and 10 minutes', () => {
        expect(scheduledTaskInterval(task({ id: 'study', scheduledStart: '07:35', estimatedMinutes: 10 }))).toEqual({
            id: 'study',
            startMin: 7 * 60 + 35,
            endMin: 7 * 60 + 45,
        });
        expect(scheduledTaskInterval(task({ id: 'water', scheduledStart: '07:30', estimatedMinutes: 5 }))).toEqual({
            id: 'water',
            startMin: 7 * 60 + 30,
            endMin: 7 * 60 + 35,
        });
        expect(scheduledTaskInterval(task({ id: 'blank', scheduledStart: '09:00', estimatedMinutes: 0 }))).toEqual({
            id: 'blank',
            startMin: 9 * 60,
            endMin: 9 * 60 + 15,
        });
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
        // A 10-minute plan is not stretched to 15 while it is still inside that window.
        const short = task({ id: 'short', status: 'in_progress', scheduledStart: '07:35', estimatedMinutes: 10, startedAt: at(7, 35) });
        expect(scheduledTaskInterval(short, { nowMin: 7 * 60 + 38 })).toEqual({
            id: 'short',
            startMin: 7 * 60 + 35,
            endMin: 7 * 60 + 45,
        });
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

describe('inline actions on a narrow overlap column', () => {
    // Day track on a 390px phone: page padding 32, 1px border, 56px hour gutter.
    const phoneTrack = 390 - 32 - 2 - 56;

    it('keeps play and copy when one task has the whole phone column', () => {
        expect(overlapBlockWidth(phoneTrack, 1)).toBe(292);
        expect(blockFitsInlineActions(overlapBlockWidth(phoneTrack, 1), 2)).toBe(true);
    });

    it('drops the controls when a phone column is split without scrolling', () => {
        expect(overlapBlockWidth(phoneTrack, 2)).toBe(142);
        expect(blockFitsInlineActions(overlapBlockWidth(phoneTrack, 2), 2)).toBe(false);
        expect(overlapBlockWidth(phoneTrack, 3)).toBe(92);
        expect(blockFitsInlineActions(overlapBlockWidth(phoneTrack, 3), 2)).toBe(false);
    });

    it('widens two overlapping phone columns enough to scroll instead of crushing the title', () => {
        const scrolled = overlapTrackWidth(phoneTrack, 2, READABLE_OVERLAP_COLUMN_PX);
        expect(scrolled).toBe(2 * READABLE_OVERLAP_COLUMN_PX);
        expect(scrolled).toBeGreaterThan(phoneTrack);
        expect(blockFitsInlineActions(overlapBlockWidth(scrolled, 2), 2)).toBe(true);
        expect(overlapTrackWidth(phoneTrack, 1, READABLE_OVERLAP_COLUMN_PX)).toBe(phoneTrack);
        expect(blockFitsInlineActions(overlapBlockWidth(overlapTrackWidth(phoneTrack, 3, READABLE_OVERLAP_COLUMN_PX), 3), 2)).toBe(true);
        expect(blockFitsInlineActions(overlapBlockWidth(scrolled, 2), 3)).toBe(false);
    });

    it('lets a block fill a later column that nothing overlaps', () => {
        const layout = assignOverlapColumns([
            { id: 'long', startMin: 8 * 60, endMin: 13 * 60 },
            { id: 'earlyA', startMin: 9 * 60, endMin: 10 * 60 },
            { id: 'earlyB', startMin: 9 * 60, endMin: 10 * 60 },
            { id: 'later', startMin: 11 * 60, endMin: 12 * 60 },
        ]);
        expect(layout.later.col).toBe(1);
        expect(layout.later.colCount).toBe(3);
        expect(layout.later.span).toBe(2);
        expect(layout.long.span).toBe(1);
        expect(overlapBlockWidth(630, layout.later.colCount, layout.later.span)).toBe(412);
    });

    it('widens a week column only when tasks actually overlap', () => {
        expect(overlapColumnFloorPx(1, 44, COMPACT_OVERLAP_COLUMN_PX)).toBe(160);
        expect(overlapColumnFloorPx(2, 6, COMPACT_OVERLAP_COLUMN_PX)).toBe(6 + 2 * COMPACT_OVERLAP_COLUMN_PX);
    });

    it('keeps two fully overlapping tasks side by side', () => {
        const layout = assignOverlapColumns([
            { id: 'a', startMin: 9 * 60, endMin: 10 * 60 },
            { id: 'b', startMin: 9 * 60, endMin: 10 * 60 },
        ]);
        expect(layout.a.colCount).toBe(2);
        expect(layout.a.span).toBe(1);
        expect(layout.b.span).toBe(1);
        expect(layout.a.col).not.toBe(layout.b.col);
    });

    it('keeps the controls when the same three tasks have a wide track', () => {
        expect(blockFitsInlineActions(overlapBlockWidth(900, 3), 2)).toBe(true);
    });

    it('has nothing to collapse when the block has no inline actions', () => {
        expect(blockFitsInlineActions(overlapBlockWidth(phoneTrack, 3), 0)).toBe(true);
        expect(blockFitsInlineActions(Number.NaN, 2)).toBe(false);
    });
});
