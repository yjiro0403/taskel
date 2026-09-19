import type { Task } from '../../types';
import { MIN_BLOCK_MINUTES, hhmmToMinutes } from './time';

export interface TimelineInterval {
    id: string;
    startMin: number;
    endMin: number;
}

export interface TimelineColumnAssignment {
    col: number;
    colCount: number;
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

export function isUnscheduledTask(task: Task): boolean {
    return !task.scheduledStart || task.scheduledStart.trim() === '';
}

export function scheduledTaskInterval(task: Task): TimelineInterval | null {
    const startMin = hhmmToMinutes(task.scheduledStart);
    if (startMin == null) return null;
    return {
        id: task.id,
        startMin,
        endMin: startMin + taskDurationMinutes(task),
    };
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
