import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { dailyGoalsOnDate, tasksOnDate, tasksWithoutDate } from './taskDateIndex';

function task(partial: Partial<Task> & Pick<Task, 'id' | 'date'>): Task {
    return {
        userId: 'user',
        title: partial.id,
        sectionId: 'section',
        status: 'open',
        estimatedMinutes: 15,
        actualMinutes: 0,
        order: 0,
        ...partial,
    };
}

describe('taskDateIndex', () => {
    const tasks = [
        task({ id: 'a', date: '2026-09-30', order: 1 }),
        task({ id: 'b', date: '2026-09-29' }),
        task({ id: 'goal', date: '', assignedDate: '2026-09-30', order: 2 }),
        task({ id: 'blank', date: '' }),
        task({ id: 'later', date: '2026-09-30', order: 0 }),
    ];

    it('returns only that date, in source order', () => {
        expect(tasksOnDate(tasks, '2026-09-30').map((entry) => entry.id)).toEqual(['a', 'later']);
        expect(tasksOnDate(tasks, '2026-09-29').map((entry) => entry.id)).toEqual(['b']);
        expect(tasksOnDate(tasks, '2026-01-01')).toEqual([]);
    });

    it('reuses the empty list and the bucket for the same array', () => {
        expect(tasksOnDate(tasks, 'missing')).toBe(tasksOnDate(tasks, 'also-missing'));
        expect(tasksOnDate(tasks, '2026-09-30')).toBe(tasksOnDate(tasks, '2026-09-30'));
    });

    it('treats an empty date as undated, including daily goals', () => {
        expect(tasksWithoutDate(tasks).map((entry) => entry.id)).toEqual(['goal', 'blank']);
        expect(dailyGoalsOnDate(tasks, '2026-09-30').map((entry) => entry.id)).toEqual(['goal']);
    });
});
