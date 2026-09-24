'use client';

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from 'react';

import { isSameWeekTimelineDrag, type WeekTimelineDrag } from '@/lib/timeline/weekDrag';

export interface WeekTimelineDragContextValue {
    /** The drag currently over another day (or an unscheduled area); null while it stays on its own grid. */
    drag: WeekTimelineDrag | null;
    /** Same value for pointer handlers, which must not read a stale closure. */
    dragRef: RefObject<WeekTimelineDrag | null>;
    setDrag: (next: WeekTimelineDrag | null) => void;
    /** Clear the drag only if `taskId` still owns it (safe to call from an effect cleanup). */
    clearDrag: (taskId: string) => void;
}

const WeekTimelineDragContext = createContext<WeekTimelineDragContextValue | null>(null);

/**
 * Lets the DayTimeline columns of one week hand a pointer drag to each other.
 * Without this provider (the daily list) a drag never leaves its own column.
 */
export function WeekTimelineDragProvider({ children }: { children: ReactNode }) {
    const [drag, setDragState] = useState<WeekTimelineDrag | null>(null);
    const dragRef = useRef<WeekTimelineDrag | null>(null);

    const setDrag = useCallback((next: WeekTimelineDrag | null) => {
        // Pointer moves arrive every frame; only re-render the week when the target changes.
        if (isSameWeekTimelineDrag(dragRef.current, next)) return;
        dragRef.current = next;
        setDragState(next);
    }, []);

    const clearDrag = useCallback(
        (taskId: string) => {
            if (dragRef.current?.taskId === taskId) setDrag(null);
        },
        [setDrag]
    );

    const value = useMemo(() => ({ drag, dragRef, setDrag, clearDrag }), [drag, setDrag, clearDrag]);

    return <WeekTimelineDragContext.Provider value={value}>{children}</WeekTimelineDragContext.Provider>;
}

export function useWeekTimelineDrag(): WeekTimelineDragContextValue | null {
    return useContext(WeekTimelineDragContext);
}
