'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { Copy, ExternalLink, Play, Plus, Square } from 'lucide-react';

import type { Section, Task } from '@/types';
import {
    actualTaskInterval,
    assignOverlapColumns,
    isUnscheduledTask,
    scheduledTaskInterval,
    taskDurationMinutes,
} from '@/lib/timeline/layout';
import { buildTimelineSlotUpdate } from '@/lib/timeline/actuals';
import {
    CREATE_SLOT_MINUTES,
    MIN_BLOCK_MINUTES,
    SNAP_MINUTES,
    clampMinutes,
    computeVisibleRange,
    floorMinutes,
    minutesToHHMM,
    snapMinutes,
} from '@/lib/timeline/time';
import { autoScrollStep } from '@/lib/timeline/autoScroll';
import { groupUnscheduledBySection } from '@/lib/timeline/unscheduledGroups';
import { buildTimelineDropUpdate, snapDropStart, type TimelineDropTarget } from '@/lib/timeline/weekDrag';
import { useStore } from '@/store/useStore';

import { findScrollParent } from './scrolling';
import { useTimelineDragCoordinator } from './WeekTimelineDragContext';
import { resolveWeekDropHit } from './weekDropTarget';

const DEFAULT_PIXELS_PER_MINUTE = 1.2;
const DEFAULT_GUTTER = 56;
const DEFAULT_MAX_HEIGHT = 900;
const BLOCK_MIN_HEIGHT = 24;
/** px-2 py-1 on a block: the vertical padding the title lines cannot use. */
const BLOCK_PADDING_Y = 8;
/** Touch: hold this long without moving to lift a block. Moving earlier scrolls the page. */
const LONG_PRESS_MS = 280;
const LONG_PRESS_MOVE_TOLERANCE = 10;
/** A press on empty grid space that travelled further than this is not a tap. */
const TAP_TOLERANCE = 6;
/**
 * A lifted block or chip has to carry the pointer this far before the layout
 * around it may change (the empty section slots appear). A press that never
 * travels, mouse click or touch long-press, must leave everything where it is.
 */
const DRAG_TRAVEL_TOLERANCE = 6;
const HOVER_SLOT_MINUTES = 30;

export type TimelineVisibleRange = { startMin: number; endMin: number };

interface DayTimelineProps {
    tasks: Task[];
    sections: Section[];
    currentTime: Date;
    currentDate: string;
    hideEmptyIntervals: boolean;
    canEditTask: (task: Task) => boolean;
    onEditTask: (task: Task) => void;
    onPlay: (task: Task) => void;
    onStop: (task: Task) => void;
    /** Empty grid space was clicked: open the create form at that time. */
    onCreateAt?: (date: string, scheduledStart: string) => void;
    /** The copy button on a block. */
    onDuplicate?: (task: Task) => void;
    /** When set, skip per-day range computation so week columns share one axis. */
    visibleRangeOverride?: TimelineVisibleRange;
    showHourLabels?: boolean;
    showUnscheduled?: boolean;
    unscheduledPlacement?: 'top' | 'bottom';
    pixelsPerMinute?: number;
    maxHeight?: number;
    gutter?: number;
    className?: string;
    /** When false, the grid is the full axis height and the parent owns scrolling. */
    scrollable?: boolean;
    /** Strip card chrome so the timeline can sit inside a week column. */
    plainChrome?: boolean;
    /** Smaller, title-only blocks for narrow week columns. */
    compact?: boolean;
    /**
     * Print the HH:mm–HH:mm range inside each block when the block is wide enough.
     * Narrow columns hide it: the hour gutter already shows the time, and the range
     * was pushing the title and the play button off the screen.
     */
    showTimeRange?: boolean;
}

type ActiveDrag =
    | {
          kind: 'move';
          taskId: string;
          originY: number;
          originStart: number;
          duration: number;
          /** Minutes between the block top and the pointer at grab time. */
          grabOffsetMin: number;
      }
    | { kind: 'resize'; taskId: string; originY: number; originDuration: number; startMin: number }
    | { kind: 'schedule'; taskId: string };

type DragState = ActiveDrag | null;

interface PendingTouch {
    pointerId: number;
    x: number;
    y: number;
    timer: number;
    cleanup: () => void;
}

/** Stop a press on a control from starting a drag or opening the editor. */
const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

export default function DayTimeline({
    tasks,
    sections,
    currentTime,
    currentDate,
    hideEmptyIntervals,
    canEditTask,
    onEditTask,
    onPlay,
    onStop,
    onCreateAt,
    onDuplicate,
    visibleRangeOverride,
    showHourLabels = true,
    showUnscheduled = true,
    unscheduledPlacement = 'top',
    pixelsPerMinute = DEFAULT_PIXELS_PER_MINUTE,
    maxHeight = DEFAULT_MAX_HEIGHT,
    gutter,
    className,
    scrollable = true,
    plainChrome = false,
    compact = false,
    showTimeRange = true,
}: DayTimelineProps) {
    const t = useTranslations('Timeline');
    const updateTask = useStore((state) => state.updateTask);
    const coordinator = useTimelineDragCoordinator();
    const { setDrag: setSharedDrag, clearDrag: clearSharedDrag, dragRef: sharedDragRef } = coordinator;
    const sharedDrag = coordinator.drag;
    const gridRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<DragState>(null);
    /** The pointer has travelled since the drag was lifted: it is a drag, not a press. */
    const [dragTravelled, setDragTravelled] = useState(false);
    const [preview, setPreview] = useState<Record<string, { startMin: number; duration: number }>>({});
    const [hoverMin, setHoverMin] = useState<number | null>(null);
    const previewRef = useRef(preview);
    const movedRef = useRef(false);
    const dragPointerTypeRef = useRef<string>('mouse');
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    /** Where the pointer was when the drag was lifted (mouse: the press; touch: the end of the long-press). */
    const liftPointRef = useRef<{ x: number; y: number } | null>(null);
    const pendingTouchRef = useRef<PendingTouch | null>(null);
    const emptyPressRef = useRef<{ x: number; y: number } | null>(null);
    previewRef.current = preview;

    const isToday = currentDate === format(currentTime, 'yyyy-MM-dd');
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    // Blocks follow recorded times: a running task from its real start (growing to
    // now), a finished one by its logged minutes. The planned time is the fallback.
    const intervalOptions = { nowMin: isToday ? nowMin : null };

    const unscheduled = tasks.filter(isUnscheduledTask);
    const scheduled = tasks.filter((task) => !isUnscheduledTask(task));

    const scheduledStarts = scheduled
        .map((task) => scheduledTaskInterval(task, intervalOptions)?.startMin)
        .filter((value): value is number => value != null);

    const computedVisible = computeVisibleRange({
        sections,
        scheduledStarts,
        hideEmptyIntervals,
    });
    const visible = visibleRangeOverride ?? computedVisible;
    const labelGutter = gutter ?? (showHourLabels ? DEFAULT_GUTTER : 8);
    const rangeMinutes = Math.max(60, visible.endMin - visible.startMin);
    const gridHeight = rangeMinutes * pixelsPerMinute;
    const createMaxMin = Math.max(visible.startMin, visible.endMin - CREATE_SLOT_MINUTES);

    const intervals = scheduled
        .map((task) => {
            const previewSlot = preview[task.id];
            if (previewSlot) {
                return { id: task.id, startMin: previewSlot.startMin, endMin: previewSlot.startMin + previewSlot.duration };
            }
            return scheduledTaskInterval(task, intervalOptions);
        })
        .filter((item): item is NonNullable<typeof item> => item != null);

    // Short blocks are padded to a clickable height; lay the columns out with that
    // padded length so a one-minute block does not sit on top of the next one.
    const minVisualMinutes = BLOCK_MIN_HEIGHT / pixelsPerMinute;
    const layoutIntervals = intervals.map((item) => ({
        ...item,
        endMin: Math.max(item.endMin, item.startMin + minVisualMinutes),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const columns = useMemo(() => assignOverlapColumns(layoutIntervals), [intervals, pixelsPerMinute]);

    const rawMinutesFromClientY = (clientY: number) => {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return visible.startMin;
        const y = clientY - rect.top + (gridRef.current?.scrollTop ?? 0);
        return visible.startMin + y / pixelsPerMinute;
    };

    const minutesFromClientY = (clientY: number) => snapMinutes(rawMinutesFromClientY(clientY));

    const cancelPendingTouch = () => {
        const pending = pendingTouchRef.current;
        if (!pending) return;
        pendingTouchRef.current = null;
        window.clearTimeout(pending.timer);
        pending.cleanup();
    };

    /**
     * A mouse lifts a block at once. A finger (or pen) has to hold still for a
     * moment first: moving earlier is a scroll, releasing earlier is a tap.
     */
    const beginDrag = (event: React.PointerEvent, next: ActiveDrag) => {
        cancelPendingTouch();
        lastPointRef.current = { x: event.clientX, y: event.clientY };
        liftPointRef.current = lastPointRef.current;
        setDragTravelled(false);
        if (event.pointerType === 'mouse') {
            event.preventDefault();
            dragPointerTypeRef.current = 'mouse';
            movedRef.current = next.kind === 'resize';
            setDrag(next);
            return;
        }

        dragPointerTypeRef.current = event.pointerType;
        movedRef.current = false;
        const pointerId = event.pointerId;
        const onPendingMove = (moveEvent: PointerEvent) => {
            const pending = pendingTouchRef.current;
            if (!pending || moveEvent.pointerId !== pending.pointerId) return;
            lastPointRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
            if (Math.hypot(moveEvent.clientX - pending.x, moveEvent.clientY - pending.y) > LONG_PRESS_MOVE_TOLERANCE) {
                cancelPendingTouch();
            }
        };
        const onPendingEnd = (endEvent: PointerEvent) => {
            if (pendingTouchRef.current?.pointerId === endEvent.pointerId) cancelPendingTouch();
        };
        window.addEventListener('pointermove', onPendingMove);
        window.addEventListener('pointerup', onPendingEnd);
        window.addEventListener('pointercancel', onPendingEnd);
        const cleanup = () => {
            window.removeEventListener('pointermove', onPendingMove);
            window.removeEventListener('pointerup', onPendingEnd);
            window.removeEventListener('pointercancel', onPendingEnd);
        };
        const timer = window.setTimeout(() => {
            pendingTouchRef.current = null;
            cleanup();
            // A long-press is never a tap: releasing without moving must not open the editor.
            movedRef.current = true;
            // Travel is measured from where the finger is now, not from the press.
            liftPointRef.current = lastPointRef.current;
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(12);
            setDrag(next);
        }, LONG_PRESS_MS);
        pendingTouchRef.current = { pointerId, x: event.clientX, y: event.clientY, timer, cleanup };
    };

    useEffect(() => () => cancelPendingTouch(), []);

    useEffect(() => {
        if (!drag) return;
        const touchDrag = dragPointerTypeRef.current !== 'mouse';

        /**
         * When the pointer is over another day, or an unscheduled area / section
         * group, publish the drag so that target draws the preview. Returns true
         * when the drag is handled there and the local preview must stay hidden.
         */
        const publishTarget = (x: number, y: number): boolean => {
            if (drag.kind === 'resize') return false;
            const source = drag.kind === 'move' ? 'scheduled' : 'unscheduled';
            const hit = resolveWeekDropHit(x, y, { columnFallback: drag.kind === 'move' });
            if (!hit) {
                setSharedDrag(null);
                return false;
            }
            if (hit.kind === 'grid' && hit.date === currentDate) {
                // The own grid keeps the local preview.
                setSharedDrag(null);
                return false;
            }
            const task = tasks.find((item) => item.id === drag.taskId);
            if (hit.kind === 'unscheduled' && task && actualTaskInterval(task)) {
                // Recorded times cannot be cleared by a drop; the block keeps its local preview.
                setSharedDrag(null);
                return false;
            }
            if (hit.kind === 'unscheduled' && hit.date === currentDate && source === 'unscheduled') {
                const sectionChange = Boolean(hit.sectionId && task && hit.sectionId !== task.sectionId);
                if (!sectionChange) {
                    // A chip over its own area has nowhere to go.
                    setSharedDrag(null);
                    setPreview({});
                    return true;
                }
            }
            const duration =
                drag.kind === 'move' ? drag.duration : task ? taskDurationMinutes(task) : MIN_BLOCK_MINUTES;
            const target: TimelineDropTarget =
                hit.kind === 'unscheduled'
                    ? { kind: 'unscheduled', date: hit.date, sectionId: hit.sectionId }
                    : {
                          kind: 'grid',
                          date: hit.date,
                          startMin: snapDropStart({
                              source,
                              pointerMin: hit.pointerMin,
                              grabOffsetMin: drag.kind === 'move' ? drag.grabOffsetMin : 0,
                              axisStartMin: hit.axisStartMin,
                              axisEndMin: hit.axisEndMin,
                              duration,
                          }),
                      };
            movedRef.current = true;
            setPreview({});
            setSharedDrag({
                taskId: drag.taskId,
                title: task?.title ?? '',
                source,
                fromDate: currentDate,
                duration,
                target,
            });
            return true;
        };

        const applyMove = (x: number, y: number) => {
            if (publishTarget(x, y)) return;
            if (drag.kind === 'schedule') {
                const startMin = clampMinutes(minutesFromClientY(y), visible.startMin, visible.endMin - MIN_BLOCK_MINUTES);
                const task = tasks.find((item) => item.id === drag.taskId);
                setPreview({
                    [drag.taskId]: {
                        startMin,
                        duration: task ? taskDurationMinutes(task) : MIN_BLOCK_MINUTES,
                    },
                });
                movedRef.current = true;
                return;
            }
            const delta = (y - drag.originY) / pixelsPerMinute;
            if (Math.abs(y - drag.originY) > 4) movedRef.current = true;
            if (drag.kind === 'move') {
                const startMin = clampMinutes(
                    snapMinutes(drag.originStart + delta),
                    visible.startMin,
                    visible.endMin - drag.duration
                );
                setPreview({ [drag.taskId]: { startMin, duration: drag.duration } });
            } else {
                const duration = Math.max(MIN_BLOCK_MINUTES, snapMinutes(drag.originDuration + delta, SNAP_MINUTES));
                setPreview({ [drag.taskId]: { startMin: drag.startMin, duration } });
            }
        };

        const onMove = (event: PointerEvent) => {
            lastPointRef.current = { x: event.clientX, y: event.clientY };
            const lift = liftPointRef.current;
            if (lift && Math.hypot(event.clientX - lift.x, event.clientY - lift.y) > DRAG_TRAVEL_TOLERANCE) {
                setDragTravelled(true);
            }
            applyMove(event.clientX, event.clientY);
        };

        const persist = async (taskId: string, startMin: number, duration?: number) => {
            const task = tasks.find((item) => item.id === taskId);
            if (!task) return;
            await updateTask(taskId, buildTimelineSlotUpdate(task, { startMin, duration }, sections), { occurrenceDate: task.date });
        };

        const finish = async (y: number) => {
            const current = drag;
            setDrag(null);

            const shared = sharedDragRef.current;
            if (shared && shared.taskId === current.taskId && current.kind !== 'resize') {
                setSharedDrag(null);
                setPreview({});
                await updateTask(
                    current.taskId,
                    buildTimelineDropUpdate({
                        source: shared.source,
                        target: shared.target,
                        duration: shared.duration,
                        sections,
                    }),
                    { occurrenceDate: shared.fromDate }
                );
                return;
            }

            const slot = previewRef.current[current.taskId];
            if (current.kind === 'schedule') {
                if (!gridRef.current) {
                    setPreview({});
                    return;
                }
                const rect = gridRef.current.getBoundingClientRect();
                if (y < rect.top || y > rect.bottom) {
                    setPreview({});
                    return;
                }
                const startMin = slot?.startMin ?? minutesFromClientY(y);
                const duration = slot?.duration ?? MIN_BLOCK_MINUTES;
                setPreview({});
                await persist(current.taskId, startMin, duration);
                return;
            }
            setPreview({});
            if (!slot || !movedRef.current) return;
            await persist(current.taskId, slot.startMin, current.kind === 'resize' ? slot.duration : undefined);
        };

        const onUp = (event: PointerEvent) => {
            void finish(event.clientY);
        };
        const onCancel = () => {
            setDrag(null);
            setPreview({});
            clearSharedDrag(drag.taskId);
        };
        // Once a touch drag is live, the finger must move the block, not the page.
        const onTouchMove = (event: TouchEvent) => {
            event.preventDefault();
        };

        // Drag near the top or bottom edge scrolls the timeline (or the page) and
        // keeps the preview under the pointer while it scrolls.
        const scrollEl = scrollable ? gridRef.current : findScrollParent(gridRef.current);
        let frame = 0;
        const tick = () => {
            const point = lastPointRef.current;
            if (point) {
                let scrolled = false;
                if (scrollEl) {
                    const rect = scrollEl.getBoundingClientRect();
                    const step = autoScrollStep(point.y, rect.top, rect.bottom);
                    if (step !== 0) {
                        const before = scrollEl.scrollTop;
                        scrollEl.scrollTop = before + step;
                        scrolled = scrollEl.scrollTop !== before;
                    }
                }
                if (!scrolled) {
                    const step = autoScrollStep(point.y, 0, window.innerHeight);
                    if (step !== 0) {
                        const before = window.scrollY;
                        window.scrollBy(0, step);
                        scrolled = window.scrollY !== before;
                    }
                }
                if (scrolled) applyMove(point.x, point.y);
            }
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        if (touchDrag) window.addEventListener('touchmove', onTouchMove, { passive: false });
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            if (touchDrag) window.removeEventListener('touchmove', onTouchMove);
            window.cancelAnimationFrame(frame);
            // Never leave a preview behind in another column if this drag ends without a drop.
            clearSharedDrag(drag.taskId);
        };
        // preview is read on pointerup; including it would rebind every pixel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, sections, tasks, updateTask, visible.endMin, visible.startMin, pixelsPerMinute, currentDate, scrollable, setSharedDrag, clearSharedDrag, sharedDragRef]);

    const hourMarks: number[] = [];
    for (let minute = Math.floor(visible.startMin / 60) * 60; minute <= visible.endMin; minute += 60) {
        if (minute >= visible.startMin) hourMarks.push(minute);
    }

    const showNow = isToday && nowMin >= visible.startMin && nowMin <= visible.endMin;

    // A drag (from another week column, or from this one) that would land here.
    const incoming = sharedDrag && sharedDrag.target.date === currentDate ? sharedDrag : null;
    const incomingStartMin = incoming?.target.kind === 'grid' ? incoming.target.startMin : null;
    const incomingUnscheduled = incoming?.target.kind === 'unscheduled' ? incoming : null;
    const incomingSectionId = incoming?.target.kind === 'unscheduled' ? incoming.target.sectionId ?? null : null;
    // The task being carried away from its place is drawn faded there.
    const carriedTaskId = sharedDrag?.taskId ?? null;
    // While something is being dragged, every section becomes a drop slot. Not on
    // the press itself, though: a mouse click lifts the block for an instant, and
    // with the area above the grid (the daily page) the extra slots would push the
    // block out from under the pointer before the click that opens the editor.
    // So the slots wait for the pointer to travel, and a block over the grid of
    // that layout keeps the grid still until the pointer reaches the area.
    const dragExpands =
        drag != null &&
        drag.kind !== 'resize' &&
        dragTravelled &&
        (drag.kind === 'schedule' || unscheduledPlacement === 'bottom');
    const expandGroups = dragExpands || Boolean(incomingUnscheduled);

    const unscheduledGroups = useMemo(
        () => groupUnscheduledBySection(unscheduled, sections, { includeEmpty: expandGroups }),
        // unscheduled is derived from tasks on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tasks, sections, expandGroups]
    );

    const titleLineHeight = compact ? 16 : 20;

    const renderChip = (task: Task) => {
        const editable = canEditTask(task);
        const lifted = drag?.taskId === task.id;
        const running = task.status === 'in_progress';
        return (
            <div
                key={task.id}
                data-task-id={task.id}
                className={clsx(
                    'inline-flex max-w-full items-stretch rounded-md border bg-white text-xs text-gray-900 overflow-hidden',
                    lifted ? 'border-blue-400 ring-2 ring-blue-300 shadow-md' : 'border-gray-200',
                    carriedTaskId === task.id && 'opacity-40'
                )}
            >
                <button
                    type="button"
                    title={task.title}
                    onPointerDown={(event) => {
                        if (!editable) return;
                        beginDrag(event, { kind: 'schedule', taskId: task.id });
                    }}
                    onClick={() => {
                        if (!movedRef.current) onEditTask(task);
                    }}
                    className={clsx(
                        'min-w-0 px-2 py-1 text-left break-words select-none [-webkit-touch-callout:none] pointer-coarse:py-2',
                        editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    )}
                >
                    {task.title}
                </button>
                {editable && task.status !== 'done' && (
                    <button
                        type="button"
                        title={running ? t('stop') : t('startNow')}
                        aria-label={running ? t('stop') : t('startNow')}
                        onPointerDown={stopPointer}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (running) onStop(task);
                            else onPlay(task);
                        }}
                        className="flex items-center px-1.5 border-l border-gray-200 text-blue-700 hover:bg-blue-50 cursor-pointer pointer-coarse:px-2.5"
                    >
                        {running ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
                    </button>
                )}
            </div>
        );
    };

    const unscheduledSection = showUnscheduled ? (
            <section
                data-timeline-unscheduled={currentDate}
                className={clsx(
                    'p-2',
                    incomingUnscheduled
                        ? 'bg-blue-50 outline-dashed outline-2 -outline-offset-2 outline-blue-400'
                        : plainChrome
                            ? 'bg-transparent'
                            : 'bg-white',
                    plainChrome ? 'border-t border-gray-100' : 'border border-gray-200',
                    !plainChrome && (unscheduledPlacement === 'top' ? 'rounded-xl' : 'rounded-b-xl border-t-0')
                )}
            >
                <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[11px] font-semibold text-gray-900">{t('unscheduled')}</h3>
                    {showHourLabels && (
                        <span className="hidden pointer-coarse:inline text-[10px] text-gray-500">{t('holdToDrag')}</span>
                    )}
                </div>
                {incomingUnscheduled ? (
                    <p className="text-[11px] text-blue-800 mt-0.5">
                        {incomingUnscheduled.source === 'scheduled' ? t('dropToUnschedule') : t('dropToMove')}
                    </p>
                ) : (
                    unscheduledPlacement === 'top' && (
                        <p className="text-xs text-gray-600 mt-0.5 mb-2">{t('unscheduledHint')}</p>
                    )
                )}
                {unscheduledGroups.length === 0 ? (
                    <p className="text-xs text-gray-400">—</p>
                ) : (
                    <div className="mt-1 space-y-1.5">
                        {unscheduledGroups.map((group) => {
                            const targeted = Boolean(incomingUnscheduled) && incomingSectionId != null && incomingSectionId === group.sectionId;
                            return (
                                <div
                                    key={group.sectionId ?? '__other'}
                                    data-timeline-unscheduled-section={group.sectionId ?? ''}
                                    className={clsx(
                                        'rounded-md border px-1.5 py-1',
                                        targeted ? 'border-blue-400 bg-blue-100/70' : 'border-gray-100 bg-gray-50/70'
                                    )}
                                >
                                    <div className="flex items-baseline gap-1.5 text-[10px] leading-4 min-w-0">
                                        <span className="font-semibold text-gray-700 truncate">
                                            {group.sectionId ? group.name : t('unscheduledOther')}
                                        </span>
                                        {group.startTime && (
                                            <span className="font-mono text-gray-500 flex-shrink-0">
                                                {group.startTime}–{group.endTime}
                                            </span>
                                        )}
                                    </div>
                                    {group.tasks.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-1">{group.tasks.map(renderChip)}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
    ) : null;

    return (
        <div className={clsx(unscheduledPlacement === 'top' && showUnscheduled ? 'space-y-3' : 'space-y-0', className)}>
            {unscheduledPlacement === 'top' && unscheduledSection}

            <div
                ref={gridRef}
                data-timeline-grid={currentDate}
                data-timeline-start-min={visible.startMin}
                data-timeline-end-min={visible.endMin}
                data-timeline-ppm={pixelsPerMinute}
                className={clsx(
                    'relative',
                    plainChrome ? 'bg-transparent' : 'bg-white border border-gray-200',
                    scrollable ? 'overflow-y-auto' : 'overflow-hidden',
                    !plainChrome && (unscheduledPlacement === 'bottom' ? 'rounded-t-xl' : 'rounded-xl')
                )}
                style={{ height: scrollable ? Math.min(gridHeight + 16, maxHeight) : gridHeight }}
            >
                <div
                    className="relative"
                    style={{ height: gridHeight, marginLeft: labelGutter }}
                    onPointerDown={(event) => {
                        const target = event.target as HTMLElement;
                        emptyPressRef.current = target.closest('[data-task-id], button, a')
                            ? null
                            : { x: event.clientX, y: event.clientY };
                    }}
                    onPointerMove={(event) => {
                        if (!onCreateAt || drag || event.pointerType !== 'mouse') return;
                        const overItem = (event.target as HTMLElement).closest('[data-task-id], button, a');
                        const next = overItem
                            ? null
                            : clampMinutes(floorMinutes(rawMinutesFromClientY(event.clientY)), visible.startMin, createMaxMin);
                        setHoverMin((prev) => (prev === next ? prev : next));
                    }}
                    onPointerLeave={() => setHoverMin(null)}
                    onClick={(event) => {
                        // A tap on empty grid space creates a task at that time (like a calendar).
                        const press = emptyPressRef.current;
                        emptyPressRef.current = null;
                        if (!press || !onCreateAt || drag) return;
                        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_TOLERANCE) return;
                        const startMin = clampMinutes(floorMinutes(rawMinutesFromClientY(event.clientY)), visible.startMin, createMaxMin);
                        onCreateAt(currentDate, minutesToHHMM(startMin));
                    }}
                >
                    {hourMarks.map((minute) => (
                        <div
                            key={minute}
                            className="absolute left-0 right-0 border-t border-gray-100"
                            style={{ top: (minute - visible.startMin) * pixelsPerMinute }}
                        >
                            {showHourLabels && (
                                <span className="absolute -left-14 -top-2 text-xs text-gray-500 font-mono w-12 text-right">
                                    {minutesToHHMM(minute)}
                                </span>
                            )}
                        </div>
                    ))}

                    {onCreateAt && hoverMin != null && !drag && (
                        <div
                            className="absolute rounded-md border border-dashed border-blue-300 bg-blue-50/60 pointer-events-none flex items-center gap-1 px-2 text-[11px] font-medium text-blue-700"
                            style={{
                                top: (hoverMin - visible.startMin) * pixelsPerMinute,
                                height: Math.max(20, HOVER_SLOT_MINUTES * pixelsPerMinute),
                                left: 4,
                                right: 8,
                            }}
                        >
                            <Plus size={12} />
                            <span className="truncate">{t('createAt', { time: minutesToHHMM(hoverMin) })}</span>
                        </div>
                    )}

                    {showNow && (
                        <div
                            className="absolute left-0 right-0 z-20 pointer-events-none"
                            style={{ top: (nowMin - visible.startMin) * pixelsPerMinute }}
                        >
                            <div className="h-0.5 bg-red-500" />
                            {showHourLabels && (
                                <span className="absolute -left-14 -top-2 text-[10px] font-semibold text-red-600">{t('now')}</span>
                            )}
                        </div>
                    )}

                    {scheduled.map((task) => {
                        const interval = intervals.find((item) => item.id === task.id);
                        if (!interval) return null;
                        const assignment = columns[task.id] ?? { col: 0, colCount: 1 };
                        const widthPct = 100 / assignment.colCount;
                        const leftPct = widthPct * assignment.col;
                        const top = (interval.startMin - visible.startMin) * pixelsPerMinute;
                        const height = Math.max(BLOCK_MIN_HEIGHT, (interval.endMin - interval.startMin) * pixelsPerMinute);
                        const editable = canEditTask(task);
                        const lifted = drag?.taskId === task.id && drag.kind !== 'resize';
                        const running = task.status === 'in_progress';
                        const showPlay = editable && task.status !== 'done';
                        // The title comes first and takes every line the block has room for.
                        const titleLines = Math.max(1, Math.floor((height - BLOCK_PADDING_Y) / titleLineHeight));

                        return (
                            <div
                                key={task.id}
                                data-task-id={task.id}
                                className={clsx(
                                    'group @container absolute rounded-lg border px-2 py-1 overflow-hidden shadow-sm select-none [-webkit-touch-callout:none]',
                                    running
                                        ? 'bg-blue-50 border-blue-400'
                                        : task.status === 'done'
                                            ? 'bg-emerald-50 border-emerald-300'
                                            : 'bg-indigo-50 border-indigo-200',
                                    editable && 'cursor-grab active:cursor-grabbing',
                                    lifted && 'z-40 ring-2 ring-blue-400 shadow-lg',
                                    carriedTaskId === task.id && 'opacity-40'
                                )}
                                style={{
                                    top,
                                    height,
                                    left: `calc(${leftPct}% + 4px)`,
                                    width: `calc(${widthPct}% - 8px)`,
                                }}
                                onPointerDown={(event) => {
                                    if (!editable || (event.target as HTMLElement).dataset.resize) return;
                                    beginDrag(event, {
                                        kind: 'move',
                                        taskId: task.id,
                                        originY: event.clientY,
                                        originStart: interval.startMin,
                                        duration: interval.endMin - interval.startMin,
                                        grabOffsetMin: rawMinutesFromClientY(event.clientY) - interval.startMin,
                                    });
                                }}
                                onClick={() => {
                                    if (!movedRef.current) onEditTask(task);
                                }}
                            >
                                <div className={clsx('flex min-w-0 items-start gap-1', showPlay && 'pr-6')}>
                                    <div
                                        className={clsx(
                                            'min-w-0 flex-1 font-medium text-gray-900 break-words',
                                            compact ? 'text-xs leading-4' : 'text-sm leading-5'
                                        )}
                                        style={{
                                            display: '-webkit-box',
                                            WebkitBoxOrient: 'vertical',
                                            WebkitLineClamp: titleLines,
                                            overflow: 'hidden',
                                        }}
                                        title={task.title}
                                    >
                                        {task.title}
                                    </div>
                                    {showTimeRange && (
                                        <div className="hidden shrink-0 whitespace-nowrap font-mono text-[11px] leading-5 text-gray-600 @min-[13rem]:block">
                                            {minutesToHHMM(interval.startMin)}–{minutesToHHMM(interval.endMin)}
                                        </div>
                                    )}
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        {task.externalLink && (
                                            <a
                                                href={task.externalLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title={t('openInCalendar')}
                                                aria-label={t('openInCalendar')}
                                                onPointerDown={stopPointer}
                                                onClick={stopPointer}
                                                className="inline-flex rounded p-0.5 text-gray-500 hover:bg-white/70 hover:text-blue-700 cursor-pointer pointer-coarse:hidden pointer-coarse:p-1 @min-[10rem]:pointer-coarse:inline-flex"
                                            >
                                                <ExternalLink size={12} />
                                            </a>
                                        )}
                                        {editable && onDuplicate && (
                                            <button
                                                type="button"
                                                title={t('duplicate')}
                                                aria-label={t('duplicate')}
                                                onPointerDown={stopPointer}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onDuplicate(task);
                                                }}
                                                className="hidden rounded p-0.5 text-gray-500 hover:bg-white/70 hover:text-blue-700 cursor-pointer pointer-fine:group-hover:inline-flex pointer-fine:focus-visible:inline-flex @min-[10rem]:pointer-coarse:inline-flex"
                                            >
                                                <Copy size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {showPlay && (
                                    <button
                                        type="button"
                                        title={running ? t('stop') : t('start')}
                                        aria-label={running ? t('stop') : t('start')}
                                        onPointerDown={stopPointer}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (running) onStop(task);
                                            else onPlay(task);
                                        }}
                                        className="absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-center text-blue-700 hover:bg-white/70 active:bg-white cursor-pointer touch-manipulation"
                                    >
                                        {running ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                                    </button>
                                )}
                                {editable && (
                                    // Mouse: a thin strip along the bottom edge. Touch: a small grip in the
                                    // bottom-left corner (away from the ▶ / copy buttons), so the rest of a
                                    // short block stays free to lift.
                                    <button
                                        type="button"
                                        data-resize="true"
                                        aria-label={t('resize')}
                                        className="absolute bottom-0 right-0 left-0 z-20 h-2 cursor-ns-resize pointer-coarse:right-auto pointer-coarse:h-4 pointer-coarse:w-8"
                                        onPointerDown={(event) => {
                                            event.stopPropagation();
                                            beginDrag(event, {
                                                kind: 'resize',
                                                taskId: task.id,
                                                originY: event.clientY,
                                                originDuration: interval.endMin - interval.startMin,
                                                startMin: interval.startMin,
                                            });
                                        }}
                                    >
                                        <span className="hidden pointer-coarse:block mx-auto mt-[13px] h-0.5 w-4 rounded bg-gray-500/60" />
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    {drag?.kind === 'schedule' && preview[drag.taskId] && (
                        <div
                            className="absolute rounded-lg border border-dashed border-blue-400 bg-blue-50/70 pointer-events-none px-2 py-1"
                            style={{
                                top: (preview[drag.taskId].startMin - visible.startMin) * pixelsPerMinute,
                                height: preview[drag.taskId].duration * pixelsPerMinute,
                                left: 4,
                                right: 8,
                            }}
                        >
                            <span className="text-xs text-blue-800">{t('dropToSchedule')}</span>
                        </div>
                    )}

                    {incoming && incomingStartMin != null && (
                        <div
                            data-timeline-incoming={incoming.taskId}
                            className="absolute z-30 rounded-lg border border-dashed border-blue-400 bg-blue-50/80 pointer-events-none px-2 py-1 overflow-hidden"
                            style={{
                                top: (incomingStartMin - visible.startMin) * pixelsPerMinute,
                                height: Math.max(BLOCK_MIN_HEIGHT, incoming.duration * pixelsPerMinute),
                                left: 4,
                                right: 8,
                            }}
                        >
                            <div
                                className={clsx('font-medium text-blue-900 break-words', compact ? 'text-xs leading-4' : 'text-sm leading-5')}
                                style={{
                                    display: '-webkit-box',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: Math.max(
                                        1,
                                        Math.floor((Math.max(BLOCK_MIN_HEIGHT, incoming.duration * pixelsPerMinute) - BLOCK_PADDING_Y) / titleLineHeight)
                                    ),
                                    overflow: 'hidden',
                                }}
                            >
                                {incoming.title}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {unscheduledPlacement === 'bottom' && unscheduledSection}
        </div>
    );
}
