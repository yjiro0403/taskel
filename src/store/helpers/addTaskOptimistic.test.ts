import { describe, expect, it } from 'vitest';

import type { Task } from '../../types';
import { applyAddTaskToList } from './addTaskOptimistic';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        userId: 'user-1',
        title: 'Original',
        sectionId: 'section-1',
        date: '2026-09-15',
        status: 'open',
        estimatedMinutes: 15,
        actualMinutes: 0,
        order: 1,
        ...overrides,
    };
}

describe('applyAddTaskToList', () => {
    it('inserts a new id and snapshots previous as null', () => {
        const incoming = task({ title: 'New' });
        const result = applyAddTaskToList([], incoming);
        expect(result.existed).toBe(false);
        expect(result.previous).toBeNull();
        expect(result.tasks).toEqual([incoming]);
    });

    it('replaces an existing id in place so a retry cannot append or roll back to deletion', () => {
        const existing = task({ title: 'Saved' });
        const retry = task({ title: 'Retry edit', memo: 'keep me' });
        const result = applyAddTaskToList([existing, task({ id: 'task-2', title: 'Other' })], retry);

        expect(result.existed).toBe(true);
        expect(result.previous).toEqual(existing);
        expect(result.tasks).toHaveLength(2);
        expect(result.tasks.filter((entry) => entry.id === 'task-1')).toHaveLength(1);
        expect(result.tasks[0]).toMatchObject({ id: 'task-1', title: 'Retry edit', memo: 'keep me' });
        expect(result.tasks[1].id).toBe('task-2');
    });
});
