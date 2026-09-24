import type { Section, Task } from '../../types';
import { getPersistedSectionForTime } from '../sectionUtils';
import { MIN_BLOCK_MINUTES, clampMinutes, minutesToHHMM, snapMinutes } from './time';

/** Where a timeline drag would land if released now. */
export type TimelineDropTarget =
    | { kind: 'grid'; date: string; startMin: number }
    | { kind: 'unscheduled'; date: string };

/** A block on the grid ("scheduled") or a chip from the no-start-time area ("unscheduled"). */
export type TimelineDragSource = 'scheduled' | 'unscheduled';

/**
 * A drag that has left its own day grid. Shared between the week columns so the
 * target column can draw the preview while the source column keeps the pointer.
 */
export interface WeekTimelineDrag {
    taskId: string;
    title: string;
    source: TimelineDragSource;
    fromDate: string;
    /** Block length in minutes; also persisted as estimatedMinutes on a grid drop. */
    duration: number;
    target: TimelineDropTarget;
}

export function isSameDropTarget(a: TimelineDropTarget | null, b: TimelineDropTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind !== b.kind || a.date !== b.date) return false;
    if (a.kind === 'grid' && b.kind === 'grid') return a.startMin === b.startMin;
    return true;
}

export function isSameWeekTimelineDrag(a: WeekTimelineDrag | null, b: WeekTimelineDrag | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
        a.taskId === b.taskId &&
        a.source === b.source &&
        a.fromDate === b.fromDate &&
        a.duration === b.duration &&
        isSameDropTarget(a.target, b.target)
    );
}

/**
 * Snap the pointer position on a day grid to the start the block would get.
 *
 * A scheduled block keeps the offset at which it was grabbed, so it stays under
 * the pointer exactly like a same-day move; a chip is placed with its top edge
 * at the pointer. Clamping mirrors the same-day rules: a block must fit inside
 * the axis, a chip only needs room for the minimum block.
 */
export function snapDropStart(input: {
    source: TimelineDragSource;
    pointerMin: number;
    grabOffsetMin: number;
    axisStartMin: number;
    axisEndMin: number;
    duration: number;
}): number {
    if (input.source === 'scheduled') {
        return clampMinutes(
            snapMinutes(input.pointerMin - input.grabOffsetMin),
            input.axisStartMin,
            input.axisEndMin - input.duration
        );
    }
    return clampMinutes(snapMinutes(input.pointerMin), input.axisStartMin, input.axisEndMin - MIN_BLOCK_MINUTES);
}

/**
 * The updateTask payload for releasing a drag on `target`.
 *
 * - grid: move to that day and time; the section follows the new time.
 * - unscheduled: move to that day. A scheduled block also loses its start time
 *   (explicit undefined so the store persists the clear as null).
 */
export function buildTimelineDropUpdate(input: {
    source: TimelineDragSource;
    target: TimelineDropTarget;
    duration: number;
    sections: Section[];
}): Partial<Task> {
    const { source, target, duration, sections } = input;
    if (target.kind === 'unscheduled') {
        return source === 'scheduled' ? { date: target.date, scheduledStart: undefined } : { date: target.date };
    }
    const scheduledStart = minutesToHHMM(target.startMin);
    const sectionId = getPersistedSectionForTime(sections, scheduledStart);
    return {
        date: target.date,
        scheduledStart,
        estimatedMinutes: duration,
        ...(sectionId ? { sectionId } : {}),
    };
}
