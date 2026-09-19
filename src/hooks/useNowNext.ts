'use client';

import { useMemo, useSyncExternalStore } from 'react';

import { formatLocalDate } from '@/lib/calendarService';
import { computeNowNext, type NowNextSnapshot } from '@/lib/tasks/nowNext';
import { useStore } from '@/store/useStore';

/** Countdowns tick seconds under ten minutes, so the widget refreshes once a second. */
const TICK_MS = 1000;

/**
 * Shared one-second clock exposed as an external store (useSyncExternalStore),
 * which is the React-sanctioned way to read a client-only value without calling
 * setState inside an effect. The server snapshot is 0 ("clock not started"), so
 * server and hydration renders agree and the widget mounts after the first tick.
 * A visibility change refreshes immediately, so reopening the app on a phone does
 * not show a stale countdown until the throttled interval catches up.
 */
let currentTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
    currentTick = Date.now();
    listeners.forEach((listener) => listener());
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') notify();
}

function subscribeToClock(listener: () => void): () => void {
    listeners.add(listener);
    if (timer === null) {
        timer = setInterval(notify, TICK_MS);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // First subscriber: publish a tick right away instead of waiting a second.
        notify();
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
    };
}

const getClockSnapshot = () => currentTick;
const getClockServerSnapshot = () => 0;

export interface UseNowNextResult {
    /** null until the clock has started on the client and tasks have loaded. */
    snapshot: NowNextSnapshot | null;
}

/**
 * Live "Now / Next" snapshot for the widget.
 *
 * - Always evaluates against the system's local *today*, not the date the user is
 *   browsing, because the widget answers "what is happening right now".
 * - Merged tasks (real + virtual routine occurrences) come from the store's
 *   getMergedTasks; timers still running on other dates are appended so an
 *   unfinished task from yesterday is not silently dropped.
 */
export function useNowNext(): UseNowNextResult {
    const tasks = useStore((state) => state.tasks);
    const sections = useStore((state) => state.sections);
    const tasksLoaded = useStore((state) => state.tasksLoaded);
    const getMergedTasks = useStore((state) => state.getMergedTasks);
    const now = useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockServerSnapshot);

    const snapshot = useMemo(() => {
        if (now === 0 || !tasksLoaded) return null;
        const today = formatLocalDate(new Date(now));
        const runningElsewhere = tasks.filter(
            (task) => task.date !== today && task.status === 'in_progress'
        );
        // Routine changes are picked up by the next tick (≤ 1 s); getMergedTasks reads
        // routines from the store directly.
        return computeNowNext({
            tasks: [...getMergedTasks(today), ...runningElsewhere],
            sections,
            now,
            today,
        });
    }, [now, tasksLoaded, tasks, sections, getMergedTasks]);

    return { snapshot };
}
