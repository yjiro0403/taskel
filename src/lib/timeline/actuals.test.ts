import { describe, expect, it } from 'vitest';

import type { Section, Task } from '../../types';
import { buildTimelinePlayUpdate, buildTimelineStopUpdate } from './actuals';

const sections: Section[] = [
    { id: 'morning', userId: 'u1', name: 'Morning', startTime: '06:00', order: 0 },
    { id: 'work', userId: 'u1', name: 'Work', startTime: '09:00', order: 1 },
    { id: 'night', userId: 'u1', name: 'Night', startTime: '18:00', endTime: '24:00', order: 2 },
];

function task(partial: Partial<Task> = {}): Task {
    return {
        id: 't1',
        userId: 'u1',
        title: 'Lunch',
        sectionId: 'work',
        date: '2026-09-24',
        status: 'open',
        estimatedMinutes: 60,
        actualMinutes: 0,
        order: 0,
        ...partial,
    };
}

const at = (h: number, m: number, s = 0) => new Date(2026, 8, 24, h, m, s);

describe('buildTimelinePlayUpdate', () => {
    it('moves a planned task to the real start time and its section', () => {
        const update = buildTimelinePlayUpdate(task({ scheduledStart: '12:00' }), at(11, 30), sections);
        expect(update).toEqual({
            status: 'in_progress',
            startedAt: at(11, 30).getTime(),
            scheduledStart: '11:30',
            sectionId: 'work',
        });
    });

    it('gives a task without a start time the current time', () => {
        const update = buildTimelinePlayUpdate(task({ sectionId: 'morning' }), at(19, 5), sections);
        expect(update.scheduledStart).toBe('19:05');
        expect(update.sectionId).toBe('night');
    });

    it('leaves the section alone when no persisted section covers the time', () => {
        const update = buildTimelinePlayUpdate(task(), at(7, 0), [sections[1]]);
        expect(update.scheduledStart).toBe('07:00');
        expect('sectionId' in update).toBe(false);
    });
});

describe('buildTimelineStopUpdate', () => {
    it('ends the block at the stop time by recording the elapsed minutes', () => {
        const running = task({ status: 'in_progress', scheduledStart: '11:00', startedAt: at(11, 0).getTime() });
        const update = buildTimelineStopUpdate(running, at(11, 30));
        expect(update).toEqual({
            status: 'done',
            startedAt: undefined,
            actualMinutes: 30,
            completedAt: at(11, 30).getTime(),
        });
    });

    it('aligns the start with the real start when the task was started from the list view', () => {
        // Planned 12:00, started at 10:30 without moving the block, stopped at 11:30.
        const running = task({ status: 'in_progress', scheduledStart: '12:00', startedAt: at(10, 30, 20).getTime() });
        const update = buildTimelineStopUpdate(running, at(11, 30, 10));
        expect(update?.scheduledStart).toBe('10:30');
        expect(update?.actualMinutes).toBe(60);
    });

    it('keeps the start of a task that already ran once', () => {
        const running = task({ status: 'in_progress', scheduledStart: '09:00', actualMinutes: 20, startedAt: at(14, 0).getTime() });
        const update = buildTimelineStopUpdate(running, at(14, 30));
        expect(update?.actualMinutes).toBe(50);
        expect('scheduledStart' in (update ?? {})).toBe(false);
    });

    it('does not move a block when the timer was started on another day', () => {
        const running = task({ status: 'in_progress', scheduledStart: '09:00', startedAt: new Date(2026, 8, 23, 23, 50).getTime() });
        const update = buildTimelineStopUpdate(running, at(0, 10));
        expect(update?.actualMinutes).toBe(20);
        expect('scheduledStart' in (update ?? {})).toBe(false);
    });

    it('returns null for a task that is not running', () => {
        expect(buildTimelineStopUpdate(task(), at(12, 0))).toBeNull();
        expect(buildTimelineStopUpdate(task({ status: 'in_progress' }), at(12, 0))).toBeNull();
    });
});
