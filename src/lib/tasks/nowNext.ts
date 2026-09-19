/**
 * "Now / Next" snapshot for the glanceable action widget.
 *
 * Problem: time blindness. A user misreads "10:01" as "10:09", or loses track of
 * how long the current task has been running. The widget answers two questions
 * at a glance, live:
 *   1. What am I doing now, and how much of its planned time is left?
 *   2. What is the next fixed-time commitment, and how long until it starts?
 *
 * Everything here is pure so it can be unit-tested with a frozen clock. The hook
 * (useNowNext) feeds it the store's tasks once a second.
 */

import type { Section, Task } from '@/types';
// Relative runtime imports: the vitest "unit" project does not resolve the `@/` alias.
import { taskStartToMillis } from '../alarmTime';
import { hasScheduledStart, sortTasksForDisplay } from './taskOrder';

const MINUTE_MS = 60_000;

/**
 * A scheduled task with no estimate still occupies the minute it starts in, so a
 * "10:01 bus" reads as "now" during 10:01 instead of vanishing the instant it starts.
 */
export const MIN_WINDOW_MINUTES = 1;

export interface CurrentAction {
    task: Task;
    /** epoch ms: when this run of the timer started (task.startedAt). */
    startAt: number;
    /** now - startAt, never negative. */
    elapsedMs: number;
    /**
     * Planned end = startAt + (estimate - minutes already logged in earlier runs).
     * null when the task has no estimate (nothing to count down to).
     */
    endAt: number | null;
    /** endAt - now. Negative = overrun. null when there is no planned end. */
    remainingMs: number | null;
    /** Other tasks running at the same time (multi-active timers). */
    concurrentCount: number;
}

export type NextAction =
    | {
          kind: 'fixed';
          task: Task;
          /** epoch ms of the task's own scheduled start (today). */
          startAt: number;
          /** startAt - now. <= 0 means the start time has arrived ("due now"). */
          untilMs: number;
      }
    | {
          /** No fixed-time task is left today; this is the next open task in list order. */
          kind: 'queued';
          task: Task;
      };

export interface NowNextSnapshot {
    now: number;
    current: CurrentAction | null;
    next: NextAction | null;
}

export interface NowNextInput {
    /**
     * Today's merged tasks (real + virtual routine occurrences), plus any task that
     * is in_progress on another date. Running timers count wherever they live;
     * scheduled starts and the queue are evaluated for `today` only.
     */
    tasks: Task[];
    sections: Section[];
    /** epoch ms */
    now: number;
    /** Local calendar date (yyyy-MM-dd) that scheduled starts are resolved against. */
    today: string;
}

function estimateMinutes(task: Task): number {
    const value = Number(task.estimatedMinutes);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function loggedMinutes(task: Task): number {
    const value = Number(task.actualMinutes);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function isRunning(task: Task): task is Task & { startedAt: number } {
    return task.status === 'in_progress' && typeof task.startedAt === 'number' && Number.isFinite(task.startedAt);
}

/** Scheduled window [start, end) of an open task for today, or null when it has no valid start. */
function scheduledWindow(task: Task, today: string): { startAt: number; endAt: number } | null {
    if (task.date !== today || !hasScheduledStart(task)) return null;
    const startAt = taskStartToMillis(task.date, task.scheduledStart);
    if (startAt === null) return null;
    const windowMinutes = Math.max(estimateMinutes(task), MIN_WINDOW_MINUTES);
    return { startAt, endAt: startAt + windowMinutes * MINUTE_MS };
}

function pickCurrent(tasks: Task[], now: number): CurrentAction | null {
    const running = tasks.filter(isRunning);
    if (running.length === 0) return null;

    // The most recently started timer is what the user is actually doing right now.
    const primary = running.reduce((latest, task) => (task.startedAt > latest.startedAt ? task : latest));

    const startAt = primary.startedAt;
    const elapsedMs = Math.max(0, now - startAt);
    const estimate = estimateMinutes(primary);
    let endAt: number | null = null;
    if (estimate > 0) {
        // Earlier paused runs already consumed part of the estimate.
        const remainingMinutes = Math.max(0, estimate - loggedMinutes(primary));
        endAt = startAt + remainingMinutes * MINUTE_MS;
    }

    return {
        task: primary,
        startAt,
        elapsedMs,
        endAt,
        remainingMs: endAt === null ? null : endAt - now,
        concurrentCount: running.length - 1,
    };
}

function pickNext(tasks: Task[], sections: Section[], now: number, today: string): NextAction | null {
    // 1. The earliest fixed-time task whose window has not fully passed.
    //    A window that already contains `now` is still "next" (shown as due now):
    //    it is the thing the user should be switching to.
    const fixed = tasks
        .filter((task) => task.status === 'open')
        .flatMap((task) => {
            const window = scheduledWindow(task, today);
            return window && window.endAt > now ? [{ task, ...window }] : [];
        })
        .sort((a, b) => a.startAt - b.startAt || (a.task.order ?? 0) - (b.task.order ?? 0));

    if (fixed.length > 0) {
        const { task, startAt } = fixed[0];
        return { kind: 'fixed', task, startAt, untilMs: startAt - now };
    }

    // 2. Nothing fixed is left today: fall back to the next open task in the order
    //    the daily list renders (unscheduled only; past fixed-time tasks are history).
    const queued = sortTasksForDisplay(
        tasks.filter((task) => task.date === today),
        sections
    ).find((task) => task.status === 'open' && !hasScheduledStart(task));

    return queued ? { kind: 'queued', task: queued } : null;
}

export function computeNowNext({ tasks, sections, now, today }: NowNextInput): NowNextSnapshot {
    return {
        now,
        current: pickCurrent(tasks, now),
        next: pickNext(tasks, sections, now, today),
    };
}

/**
 * True when the next fixed-time task starts before the current task is planned to
 * finish — i.e. "you will not finish this before the bus". Not raised once the next
 * start has already arrived (that state is shown as due-now instead).
 */
export function hasScheduleConflict(snapshot: NowNextSnapshot): boolean {
    const { current, next } = snapshot;
    if (!current || current.endAt === null) return false;
    if (!next || next.kind !== 'fixed' || next.untilMs <= 0) return false;
    return next.startAt < current.endAt;
}

export type DurationParts =
    | { mode: 'hm'; hours: number; minutes: number }
    | { mode: 'h'; hours: number }
    | { mode: 'm'; minutes: number }
    | { mode: 'ms'; minutes: number; seconds: number }
    | { mode: 's'; seconds: number };

/** Below this, the widget ticks seconds so the last minutes feel urgent. */
export const SECONDS_DISPLAY_BELOW_MS = 10 * MINUTE_MS;

/**
 * Split a duration (sign ignored) into the parts the widget renders.
 * - ≥ 1 hour: hours + minutes
 * - 10 min ≤ d < 1 hour: minutes only
 * - < 10 min: minutes + ticking seconds
 *
 * `roundUp` rounds partial units up for countdowns ("12 min" while 11:30 remain,
 * "1s" rather than "0s" just before zero). Elapsed / overrun readings pass false so
 * they never run ahead of the clock.
 */
export function describeDuration(ms: number, { roundUp }: { roundUp: boolean }): DurationParts {
    const abs = Number.isFinite(ms) ? Math.abs(ms) : 0;
    const round = roundUp ? Math.ceil : Math.floor;

    if (abs < SECONDS_DISPLAY_BELOW_MS) {
        const totalSeconds = round(abs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return minutes === 0 ? { mode: 's', seconds } : { mode: 'ms', minutes, seconds };
    }

    const totalMinutes = round(abs / MINUTE_MS);
    if (totalMinutes < 60) {
        return { mode: 'm', minutes: totalMinutes };
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? { mode: 'h', hours } : { mode: 'hm', hours, minutes };
}
