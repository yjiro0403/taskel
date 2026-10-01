import { useSyncExternalStore } from 'react';

let overId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

/** Only the row under an incoming unscheduled drag needs to redraw. */
export function setDragOverId(id: string | null) {
    if (overId === id) return;
    overId = id;
    emit();
}

export function useIsExternalDragOver(taskId: string): boolean {
    return useSyncExternalStore(
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => overId === taskId,
        () => false
    );
}
