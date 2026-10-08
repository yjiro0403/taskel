import { describe, expect, it } from 'vitest';
import type { Section, Task } from '@/types';
import { calculateTaskSchedule } from '@/lib/timeUtils';
import { computeQueuedFinishTime } from './queuedFinishTime';

function task(partial: Partial<Task> & Pick<Task, 'id' | 'sectionId' | 'order'>): Task {
    return {
        userId: 'user',
        title: partial.id,
        date: '2026-09-30',
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        ...partial,
    };
}

const sections: Section[] = [
    { id: 'pm', userId: 'user', name: 'PM', order: 2 },
    { id: 'am', userId: 'user', name: 'AM', order: 1 },
];

function naiveFinish(tasks: Task[], currentTime: Date): Date | null {
    const sortedSections = [...sections].sort((a, b) => a.order - b.order);
    let allTasks: Task[] = [];
    sortedSections.forEach((section) => {
        const sectionTasks = tasks
            .filter((entry) => entry.sectionId === section.id)
            .sort((a, b) => a.order - b.order);
        allTasks = [...allTasks, ...sectionTasks];
    });
    const schedule = calculateTaskSchedule(allTasks, currentTime);
    if (schedule.size === 0) return null;
    const lastTask = [...allTasks].reverse().find((entry) => schedule.has(entry.id));
    return lastTask ? schedule.get(lastTask.id)!.end : null;
}

describe('computeQueuedFinishTime', () => {
    const now = new Date(2026, 8, 30, 9, 0, 0);

    it('matches the section-ordered queue used by the tasks header', () => {
        const tasks = [
            task({ id: 'late', sectionId: 'pm', order: 0, scheduledStart: '13:00', estimatedMinutes: 45 }),
            task({ id: 'early', sectionId: 'am', order: 1, scheduledStart: '09:30', estimatedMinutes: 30 }),
            task({ id: 'done', sectionId: 'am', order: 0, status: 'done', estimatedMinutes: 120 }),
            task({ id: 'other-day', sectionId: 'am', order: 2, date: '2026-09-01', estimatedMinutes: 15 }),
        ];
        const finish = computeQueuedFinishTime(tasks, sections, now);
        expect(finish?.getTime()).toBe(naiveFinish(tasks, now)?.getTime());
        expect(finish?.getHours()).toBe(13);
        expect(finish?.getMinutes()).toBe(45);
    });

    it('returns null when every queued task is already done', () => {
        const tasks = [task({ id: 'done', sectionId: 'am', order: 0, status: 'done' })];
        expect(computeQueuedFinishTime(tasks, sections, now)).toBeNull();
    });
});
