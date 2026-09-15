import { describe, expect, it } from 'vitest';

import {
    deriveFinanceLoadState,
    gateExistingTaskFinanceReplace,
    resolvePendingFinanceSourceTaskId,
} from './taskEntriesGate';

describe('gateExistingTaskFinanceReplace', () => {
    const base = {
        enabled: true,
        occurrenceDate: '2026-09-15',
        existingTaskId: 'task-1',
    };

    it('allows replace when existing entries loaded successfully, including empty', () => {
        expect(
            gateExistingTaskFinanceReplace({
                ...base,
                load: { status: 'loaded', taskId: 'task-1' },
            })
        ).toEqual({ allow: true });
    });

    it('blocks replace while loading, on error, or if not yet loaded', () => {
        expect(
            gateExistingTaskFinanceReplace({
                ...base,
                load: { status: 'loading', taskId: 'task-1' },
            })
        ).toEqual({ allow: false, reason: 'loading' });
        expect(
            gateExistingTaskFinanceReplace({
                ...base,
                load: { status: 'error', taskId: 'task-1' },
            })
        ).toEqual({ allow: false, reason: 'error' });
        expect(
            gateExistingTaskFinanceReplace({
                ...base,
                load: { status: 'idle' },
            })
        ).toEqual({ allow: false, reason: 'not_loaded' });
        expect(
            gateExistingTaskFinanceReplace({
                ...base,
                load: { status: 'loaded', taskId: 'other-task' },
            })
        ).toEqual({ allow: false, reason: 'not_loaded' });
    });

    it('does not require a prior load for new tasks or when the feature is off', () => {
        expect(
            gateExistingTaskFinanceReplace({
                enabled: true,
                occurrenceDate: '2026-09-15',
                existingTaskId: null,
                load: { status: 'idle' },
            })
        ).toEqual({ allow: true });
        expect(
            gateExistingTaskFinanceReplace({
                enabled: false,
                occurrenceDate: '2026-09-15',
                existingTaskId: 'task-1',
                load: { status: 'idle' },
            })
        ).toEqual({ allow: true });
        expect(
            gateExistingTaskFinanceReplace({
                enabled: true,
                occurrenceDate: null,
                existingTaskId: 'task-1',
                load: { status: 'idle' },
            })
        ).toEqual({ allow: true });
    });
});

describe('deriveFinanceLoadState', () => {
    it('treats a missing result for an existing task as loading, not as loaded-empty', () => {
        expect(deriveFinanceLoadState({ existingTaskId: 'task-1', result: null })).toEqual({
            status: 'loading',
            taskId: 'task-1',
        });
        expect(
            deriveFinanceLoadState({
                existingTaskId: 'task-1',
                result: { status: 'loaded', taskId: 'task-1' },
            })
        ).toEqual({ status: 'loaded', taskId: 'task-1' });
        expect(
            deriveFinanceLoadState({
                existingTaskId: 'task-1',
                result: { status: 'error', taskId: 'task-1' },
            })
        ).toEqual({ status: 'error', taskId: 'task-1' });
        expect(deriveFinanceLoadState({ existingTaskId: null, result: null })).toEqual({
            status: 'idle',
        });
    });
});

describe('resolvePendingFinanceSourceTaskId', () => {
    it('remembers the original id when a routine occurrence is detached', () => {
        expect(resolvePendingFinanceSourceTaskId({
            pendingSourceTaskId: null,
            attemptedTaskId: 'routine-occurrence',
            persistedTaskId: 'detached-task',
        })).toBe('routine-occurrence');
    });

    it('keeps the source id across a finance-only retry', () => {
        expect(resolvePendingFinanceSourceTaskId({
            pendingSourceTaskId: 'routine-occurrence',
            attemptedTaskId: 'detached-task',
            persistedTaskId: 'detached-task',
        })).toBe('routine-occurrence');
    });

    it('returns null for an ordinary in-place save', () => {
        expect(resolvePendingFinanceSourceTaskId({
            pendingSourceTaskId: null,
            attemptedTaskId: 'task-1',
            persistedTaskId: 'task-1',
        })).toBeNull();
    });
});
