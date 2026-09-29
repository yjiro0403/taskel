import { format } from 'date-fns';

import type { Section, Task } from '../../types';
import { getPersistedSectionForTime } from '../sectionUtils';
import { actualTaskInterval, minutesOnDate } from './layout';
import { hhmmToMinutes, minutesToHHMM } from './time';

/** The same calendar day as `timestamp`, at `minutes` past midnight. */
function atMinuteOfDay(timestamp: number, minutes: number): number {
    const at = new Date(timestamp);
    at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return at.getTime();
}

/**
 * Timeline play: the block follows the real start.
 *
 * Pressing ▶ at 11:30 on a task planned for 12:00 moves it to 11:30, and a task
 * without a start time gets the current time, so what the axis shows is what
 * actually happened. The planned length (estimatedMinutes) is kept.
 */
export function buildTimelinePlayUpdate(task: Task, now: Date, sections: Section[]): Partial<Task> {
    const scheduledStart = format(now, 'HH:mm');
    const sectionId = getPersistedSectionForTime(sections, scheduledStart);
    return {
        status: 'in_progress',
        startedAt: now.getTime(),
        scheduledStart,
        ...(sectionId ? { sectionId } : {}),
    };
}

/**
 * Timeline stop: the block ends where the timer stopped.
 *
 * A done block spans its start plus actualMinutes, so recording the elapsed
 * time is what makes "stop at 11:30" end at 11:30 (a run shorter than half a
 * minute still counts one minute, see below). When this was the task's
 * only run and it started on the task's own day, the start is also aligned
 * with the real start (the task may have been started from the list view,
 * which keeps the planned time). Returns null when the task is not running.
 */
export function buildTimelineStopUpdate(task: Task, now: Date): Partial<Task> | null {
    if (task.status !== 'in_progress' || !task.startedAt) return null;

    // actual_minutes is an integer column: a run stopped within the first half
    // minute would round to 0 and the block would fall back to its planned length.
    // A timed run counts at least one minute so it ends where it was stopped.
    const elapsedMinutes = Math.max(1, Math.round((now.getTime() - task.startedAt) / 60000));
    const previousActual = Number(task.actualMinutes || 0);
    const update: Partial<Task> = {
        status: 'done',
        startedAt: undefined,
        actualMinutes: previousActual + elapsedMinutes,
        completedAt: now.getTime(),
    };

    const started = new Date(task.startedAt);
    if (previousActual === 0 && format(started, 'yyyy-MM-dd') === task.date) {
        const actualStart = format(started, 'HH:mm');
        if (task.scheduledStart !== actualStart) update.scheduledStart = actualStart;
    }
    return update;
}

/**
 * A block was moved (no `duration`) or resized / placed (`duration`) on its own day.
 *
 * Planned tasks get the new planned time. A running or finished block is drawn
 * from its recorded times, so those move with it: the real start of a running
 * task, the completion time (and logged minutes when resized) of a finished
 * one. The planned time follows so every view agrees.
 */
export function buildTimelineSlotUpdate(
    task: Task,
    slot: { startMin: number; duration?: number },
    sections: Section[]
): Partial<Task> {
    const scheduledStart = minutesToHHMM(slot.startMin);
    const sectionId = getPersistedSectionForTime(sections, scheduledStart);
    const update: Partial<Task> = { scheduledStart, ...(sectionId ? { sectionId } : {}) };
    const recorded = actualTaskInterval(task);

    if (recorded && task.status === 'in_progress' && task.startedAt) {
        update.startedAt = atMinuteOfDay(task.startedAt, slot.startMin);
        if (slot.duration != null) update.estimatedMinutes = slot.duration;
        return update;
    }
    if (recorded && task.status === 'done' && task.completedAt) {
        const actualMinutes = slot.duration ?? recorded.endMin - recorded.startMin;
        update.actualMinutes = actualMinutes;
        update.completedAt = atMinuteOfDay(task.completedAt, slot.startMin + actualMinutes);
        return update;
    }
    if (slot.duration != null) update.estimatedMinutes = slot.duration;
    return update;
}

/** Clock times the editor should show for a task's recorded run. Empty when it has none. */
export function recordedIntervalFromTask(task: Pick<Task, 'status' | 'date' | 'startedAt' | 'completedAt' | 'actualMinutes'>): { start: string; end: string } {
    if (task.status === 'in_progress') {
        const startMin = minutesOnDate(task.startedAt, task.date);
        if (startMin == null) return { start: '', end: '' };
        return { start: minutesToHHMM(startMin), end: '' };
    }
    if (task.status === 'done') {
        const actual = Math.round(Number(task.actualMinutes || 0));
        const endMin = minutesOnDate(task.completedAt, task.date);
        if (endMin == null || actual <= 0) return { start: '', end: '' };
        return { start: minutesToHHMM(Math.max(0, endMin - actual)), end: minutesToHHMM(endMin) };
    }
    return { start: '', end: '' };
}

function timestampOnDate(date: string, minutes: number): number {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/**
 * What to store when the editor's actual start / end change.
 * Both times mark the task done over that span. A start alone keeps it running
 * from then. Clearing both drops the recorded run back to not started.
 */
export function buildRecordedIntervalUpdate(
    input: { date: string; start: string; end: string }
): { ok: true; update: Partial<Task> } | { ok: false; error: 'date' | 'end_without_start' | 'order' } {
    const startMin = hhmmToMinutes(input.start);
    const endMin = hhmmToMinutes(input.end);
    const hasStart = input.start.trim() !== '';
    const hasEnd = input.end.trim() !== '';

    if (!hasStart && !hasEnd) {
        return {
            ok: true,
            update: {
                status: 'open',
                startedAt: undefined,
                completedAt: undefined,
                actualMinutes: 0,
            },
        };
    }
    if (!input.date) return { ok: false, error: 'date' };
    if (hasEnd && !hasStart) return { ok: false, error: 'end_without_start' };
    if (startMin == null || (hasEnd && endMin == null)) return { ok: false, error: 'order' };
    if (hasEnd && endMin != null && endMin <= startMin) return { ok: false, error: 'order' };

    // Planned start and estimate stay as entered. The timeline draws a running
    // or finished task from these recorded times, not from the plan.
    if (!hasEnd || endMin == null) {
        return {
            ok: true,
            update: {
                status: 'in_progress',
                startedAt: timestampOnDate(input.date, startMin),
                completedAt: undefined,
            },
        };
    }

    return {
        ok: true,
        update: {
            status: 'done',
            startedAt: undefined,
            completedAt: timestampOnDate(input.date, endMin),
            actualMinutes: endMin - startMin,
        },
    };
}
