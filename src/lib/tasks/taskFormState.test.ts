import { describe, expect, it } from 'vitest';
import type { Section, Task } from '@/types';
import { buildTaskFormState } from './taskFormState';

const sections: Section[] = [
    { id: 'am', userId: 'user', name: 'AM', startTime: '09:00', endTime: '12:00', order: 0 },
    { id: 'pm', userId: 'user', name: 'PM', startTime: '13:00', endTime: '18:00', order: 1 },
];

function task(partial: Partial<Task>): Task {
    return {
        id: 'task-1',
        userId: 'user',
        title: 'Write',
        sectionId: 'am',
        date: '2026-09-30',
        status: 'open',
        estimatedMinutes: 20,
        actualMinutes: 5,
        order: 1,
        ...partial,
    };
}

describe('buildTaskFormState', () => {
    it('opens a new task on the current date in the first section', () => {
        const state = buildTaskFormState({
            sections,
            currentDate: '2026-09-30',
        });
        expect(state.activeType).toBe('task');
        expect(state.date).toBe('2026-09-30');
        expect(state.sectionId).toBe('am');
        expect(state.title).toBe('');
        expect(state.estimatedMinutes).toBe(15);
    });

    it('keeps an edited task and moves the section to match its start time', () => {
        const state = buildTaskFormState({
            targetTask: task({ title: 'Standup', sectionId: 'am', scheduledStart: '13:30' }),
            sections,
            currentDate: '2026-10-01',
        });
        expect(state.title).toBe('Standup');
        expect(state.date).toBe('2026-09-30');
        expect(state.sectionId).toBe('pm');
        expect(state.scheduledStart).toBe('13:30');
        expect(state.estimatedMinutes).toBe(20);
    });

    it('opens a daily goal on the assigned date', () => {
        const state = buildTaskFormState({
            initialAssignedDate: '2026-09-30',
            sections,
            currentDate: '2026-09-30',
        });
        expect(state.activeType).toBe('daily');
        expect(state.assignedDate).toBe('2026-09-30');
        expect(state.date).toBe('');
    });
});
