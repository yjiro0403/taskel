import { format } from 'date-fns';

import type { Task } from '../../types';
import { MINUTES_PER_DAY, MIN_BLOCK_MINUTES, hhmmToMinutes } from './time';

export interface TimelineInterval {
    id: string;
    startMin: number;
    endMin: number;
}

export interface TimelineColumnAssignment {
    col: number;
    colCount: number;
}

export interface TimelineIntervalOptions {
    /** The current minute of the day, when the task's date is today: a running block grows to it. */
    nowMin?: number | null;
}

export function taskDurationMinutes(task: Task): number {
    if (task.status === 'done') {
        const actual = Number(task.actualMinutes || 0);
        if (actual > 0) return Math.max(MIN_BLOCK_MINUTES, Math.round(actual));
    }
    const estimated = Number(task.estimatedMinutes || 0);
    if (estimated > 0) return Math.max(MIN_BLOCK_MINUTES, Math.round(estimated));
    return MIN_BLOCK_MINUTES;
}

/** Minutes of the day for a timestamp that falls on `date`, else null. */
export function minutesOnDate(timestamp: number | undefined, date: string): number | null {
    if (!timestamp) return null;
    const at = new Date(timestamp);
    if (format(at, 'yyyy-MM-dd') !== date) return null;
    return at.getHours() * 60 + at.getMinutes();
}

/**
 * The block a task's recorded times define, whatever its planned time says.
 *
 * - Running (started on its own day): from the real start, at least the planned
 *   length, and growing to "now" while it keeps running.
 * - Done with logged minutes (finished on its own day): the logged minutes
 *   ending exactly at the completion time, the same reading the list view
 *   prints. No minimum length here: the label must show the real stop time,
 *   the renderer alone pads short blocks to a clickable height.
 *
 * Planned-only tasks return null so the caller falls back to scheduledStart.
 */
export function actualTaskInterval(task: Task, options: TimelineIntervalOptions = {}): TimelineInterval | null {
    if (task.status === 'in_progress') {
        const startMin = minutesOnDate(task.startedAt, task.date);
        if (startMin == null) return null;
        const planned = startMin + taskDurationMinutes(task);
        const end = options.nowMin != null ? Math.max(planned, options.nowMin) : planned;
        return {
            id: task.id,
            startMin,
            endMin: Math.min(MINUTES_PER_DAY, Math.max(end, startMin + MIN_BLOCK_MINUTES)),
        };
    }
    if (task.status === 'done') {
        const actual = Math.round(Number(task.actualMinutes || 0));
        const endMin = minutesOnDate(task.completedAt, task.date);
        if (endMin == null || actual <= 0) return null;
        const startMin = Math.max(0, endMin - actual);
        return { id: task.id, startMin, endMin };
    }
    return null;
}

/** Where a task sits on the axis: its recorded times first, its planned time otherwise. */
export function scheduledTaskInterval(task: Task, options: TimelineIntervalOptions = {}): TimelineInterval | null {
    const actual = actualTaskInterval(task, options);
    if (actual) return actual;
    const startMin = hhmmToMinutes(task.scheduledStart);
    if (startMin == null) return null;
    return {
        id: task.id,
        startMin,
        endMin: startMin + taskDurationMinutes(task),
    };
}

/** No planned time and no recorded time on its day: the task lives in the "no start time" area. */
export function isUnscheduledTask(task: Task): boolean {
    return scheduledTaskInterval(task) == null;
}

/**
 * Greedy calendar columns: overlapping intervals sit side by side.
 * Touching at the boundary (A.end === B.start) does not overlap.
 */
export function assignOverlapColumns(items: TimelineInterval[]): Record<string, TimelineColumnAssignment> {
    const sorted = [...items].sort(
        (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.id.localeCompare(b.id)
    );
    const result: Record<string, TimelineColumnAssignment> = {};
    if (sorted.length === 0) return result;

    const groups: TimelineInterval[][] = [];
    let current: TimelineInterval[] = [];
    let groupEnd = -Infinity;

    for (const item of sorted) {
        if (current.length === 0 || item.startMin < groupEnd) {
            current.push(item);
            groupEnd = Math.max(groupEnd, item.endMin);
        } else {
            groups.push(current);
            current = [item];
            groupEnd = item.endMin;
        }
    }
    if (current.length > 0) groups.push(current);

    for (const group of groups) {
        const colEnds: number[] = [];
        const cols = new Map<string, number>();
        for (const item of group) {
            let col = colEnds.findIndex((end) => end <= item.startMin);
            if (col === -1) {
                col = colEnds.length;
                colEnds.push(item.endMin);
            } else {
                colEnds[col] = item.endMin;
            }
            cols.set(item.id, col);
        }
        const colCount = Math.max(1, colEnds.length);
        for (const item of group) {
            result[item.id] = { col: cols.get(item.id) ?? 0, colCount };
        }
    }

    return result;
}
