import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from '@/store/useStore';

let selectedIds: readonly string[] = [];
let selectedSet = new Set<string>();
let highlightedId: string | null = null;

const selectedListeners = new Set<() => void>();
const highlightedListeners = new Set<() => void>();

function emit(listeners: Set<() => void>) {
    listeners.forEach((listener) => listener());
}

function publishSelection(ids: readonly string[]) {
    if (ids === selectedIds) return;
    selectedIds = ids;
    selectedSet = new Set(ids);
    emit(selectedListeners);
}

function publishHighlight(id: string | null) {
    if (id === highlightedId) return;
    highlightedId = id;
    emit(highlightedListeners);
}

function publishFromStore() {
    const state = useStore.getState();
    publishSelection(state.selectedTaskIds);
    publishHighlight(state.highlightedTaskId);
}

let storeSubscribed = false;

function subscribeTaskRowFlags() {
    if (storeSubscribed) return;
    storeSubscribed = true;
    publishFromStore();
    useStore.subscribe(publishFromStore);
}

if (typeof window !== 'undefined') {
    subscribeTaskRowFlags();
}

/** Keeps per-row selection and highlight flags outside the section render. */
export function TaskRowFlagsSync() {
    useEffect(() => {
        publishFromStore();
        return useStore.subscribe(publishFromStore);
    }, []);
    return null;
}

export function useIsTaskSelected(taskId: string): boolean {
    return useSyncExternalStore(
        (listener) => {
            selectedListeners.add(listener);
            return () => selectedListeners.delete(listener);
        },
        () => selectedSet.has(taskId),
        () => false
    );
}

export function useIsTaskHighlighted(taskId: string): boolean {
    return useSyncExternalStore(
        (listener) => {
            highlightedListeners.add(listener);
            return () => highlightedListeners.delete(listener);
        },
        () => highlightedId === taskId,
        () => false
    );
}
