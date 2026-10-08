import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { reuseVirtualTask } from './reuseVirtualTask';

function virtual(partial: Partial<Task> = {}): Task {
    return {
        id: 'virtual-1',
        userId: 'user',
        title: 'Routine',
        sectionId: 'am',
        date: '2026-09-30',
        status: 'open',
        estimatedMinutes: 15,
        actualMinutes: 0,
        scheduledStart: '09:00',
        order: 1,
        routineId: 'routine-1',
        isVirtual: true,
        ...partial,
    };
}

describe('reuseVirtualTask', () => {
    it('returns the same object when the visible fields are unchanged', () => {
        const first = reuseVirtualTask(virtual());
        const second = reuseVirtualTask(virtual());
        expect(second).toBe(first);
    });

    it('returns the new object when the title changes', () => {
        const first = reuseVirtualTask(virtual({ id: 'virtual-2' }));
        const second = reuseVirtualTask(virtual({ id: 'virtual-2', title: 'Renamed' }));
        expect(second).not.toBe(first);
        expect(second.title).toBe('Renamed');
    });
});
