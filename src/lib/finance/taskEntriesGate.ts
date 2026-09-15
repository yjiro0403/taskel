export type FinanceEntriesLoadState =
    | { status: 'idle' }
    | { status: 'loading'; taskId: string }
    | { status: 'error'; taskId: string }
    | { status: 'loaded'; taskId: string };

export type FinanceReplaceGate =
    | { allow: true }
    | { allow: false; reason: 'loading' | 'error' | 'not_loaded' };

/**
 * Existing-task finance must not be replaced until entries have been loaded
 * successfully — including a successful empty array. Loading, error, and
 * not-loaded are distinct from "loaded with zero rows".
 *
 * New tasks (no existingTaskId) do not load prior rows and may replace.
 */
export function gateExistingTaskFinanceReplace(input: {
    enabled: boolean;
    occurrenceDate: string | null;
    existingTaskId: string | null;
    load: FinanceEntriesLoadState;
}): FinanceReplaceGate {
    if (!input.enabled || !input.occurrenceDate || !input.existingTaskId) {
        return { allow: true };
    }

    if (input.load.status === 'loaded' && input.load.taskId === input.existingTaskId) {
        return { allow: true };
    }
    if (input.load.status === 'loading' && input.load.taskId === input.existingTaskId) {
        return { allow: false, reason: 'loading' };
    }
    if (input.load.status === 'error' && input.load.taskId === input.existingTaskId) {
        return { allow: false, reason: 'error' };
    }
    return { allow: false, reason: 'not_loaded' };
}

export function deriveFinanceLoadState(input: {
    existingTaskId: string | null;
    result: { status: 'loaded' | 'error'; taskId: string } | null;
}): FinanceEntriesLoadState {
    if (!input.existingTaskId) {
        return { status: 'idle' };
    }
    if (input.result && input.result.taskId === input.existingTaskId) {
        return { status: input.result.status, taskId: input.existingTaskId };
    }
    return { status: 'loading', taskId: input.existingTaskId };
}

/**
 * Keep the original routine occurrence id until the finance transfer succeeds.
 * A task move and its finance replace are separate network writes, so a retry
 * must continue deleting the caller's rows from the original source task.
 */
export function resolvePendingFinanceSourceTaskId(input: {
    pendingSourceTaskId: string | null;
    attemptedTaskId: string | null;
    persistedTaskId: string | null;
}): string | null {
    if (
        input.pendingSourceTaskId &&
        input.pendingSourceTaskId !== input.persistedTaskId
    ) {
        return input.pendingSourceTaskId;
    }
    if (
        input.attemptedTaskId &&
        input.persistedTaskId &&
        input.attemptedTaskId !== input.persistedTaskId
    ) {
        return input.attemptedTaskId;
    }
    return null;
}
