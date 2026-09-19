import { describe, expect, it } from 'vitest';

import type { Section, Task } from '@/types';

import { compareTasksForDisplay, hasScheduledStart, sortTasksForDisplay } from './taskOrder';

let counter = 0;
function makeTask(overrides: Partial<Task> = {}): Task {
    counter += 1;
    return {
        id: `task-${counter}`,
        userId: 'u1',
        title: `Task ${counter}`,
        sectionId: 'morning',
        date: '2026-09-18',
        status: 'open',
        estimatedMinutes: 10,
        actualMinutes: 0,
        order: counter,
        ...overrides,
    };
}

describe('hasScheduledStart', () => {
    it('treats blank values as unscheduled', () => {
        expect(hasScheduledStart({ scheduledStart: undefined })).toBe(false);
        expect(hasScheduledStart({ scheduledStart: '' })).toBe(false);
        expect(hasScheduledStart({ scheduledStart: '   ' })).toBe(false);
        expect(hasScheduledStart({ scheduledStart: '09:00' })).toBe(true);
    });
});

describe('compareTasksForDisplay', () => {
    it('orders done → in_progress → open', () => {
        const open = makeTask({ order: 0 });
        const running = makeTask({ status: 'in_progress', order: 1 });
        const done = makeTask({ status: 'done', order: 2 });
        expect([open, running, done].sort(compareTasksForDisplay).map((t) => t.id)).toEqual([done.id, running.id, open.id]);
    });

    it('puts scheduled tasks by time before unscheduled tasks, then manual order', () => {
        const late = makeTask({ scheduledStart: '11:00', order: 0 });
        const early = makeTask({ scheduledStart: '09:00', order: 5 });
        const manualB = makeTask({ order: 2 });
        const manualA = makeTask({ order: 1 });
        expect([manualB, late, manualA, early].sort(compareTasksForDisplay).map((t) => t.id)).toEqual([
            early.id,
            late.id,
            manualA.id,
            manualB.id,
        ]);
    });
});

describe('sortTasksForDisplay', () => {
    const sections: Section[] = [
        { id: 'evening', userId: 'u1', name: 'Evening', startTime: '18:00', order: 1 },
        { id: 'morning', userId: 'u1', name: 'Morning', startTime: '06:00', order: 0 },
    ];

    it('walks sections by start time and drops tasks with unknown sections', () => {
        const evening = makeTask({ sectionId: 'evening', order: 0 });
        const morning = makeTask({ sectionId: 'morning', order: 9 });
        const orphan = makeTask({ sectionId: 'missing' });
        expect(sortTasksForDisplay([evening, orphan, morning], sections).map((t) => t.id)).toEqual([morning.id, evening.id]);
    });

    it('keeps tasks that live in the virtual interval sections', () => {
        const beforeDawn = makeTask({ sectionId: 'interval-00:00' });
        const morning = makeTask({ sectionId: 'morning' });
        expect(sortTasksForDisplay([morning, beforeDawn], sections).map((t) => t.id)).toEqual([beforeDawn.id, morning.id]);
    });
});
