'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';

import type { Section, Task } from '@/types';
import { getPersistedSectionForTime } from '@/lib/sectionUtils';
import {
    assignOverlapColumns,
    isUnscheduledTask,
    scheduledTaskInterval,
    taskDurationMinutes,
} from '@/lib/timeline/layout';
import {
    MIN_BLOCK_MINUTES,
    SNAP_MINUTES,
    clampMinutes,
    computeVisibleRange,
    hhmmToMinutes,
    minutesToHHMM,
    snapMinutes,
} from '@/lib/timeline/time';
import { buildTimelineDropUpdate, snapDropStart, type TimelineDropTarget } from '@/lib/timeline/weekDrag';
import { useStore } from '@/store/useStore';

import { useWeekTimelineDrag } from './WeekTimelineDragContext';
import { resolveWeekDropHit } from './weekDropTarget';

const DEFAULT_PIXELS_PER_MINUTE = 1.2;
const DEFAULT_GUTTER = 56;
const DEFAULT_MAX_HEIGHT = 900;
const BLOCK_MIN_HEIGHT = 24;
/** px-2 py-1 on a block: the vertical padding the title lines cannot use. */
const BLOCK_PADDING_Y = 8;

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
    /** Print the HH:mm–HH:mm range inside each block. The hour axis shows it anyway. */
    showTimeRange?: boolean;
}

type DragState =
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
    | { kind: 'schedule'; taskId: string }
    | null;

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
    const week = useWeekTimelineDrag();
    const weekSetDrag = week?.setDrag;
    const weekClearDrag = week?.clearDrag;
    const weekDragRef = week?.dragRef;
    const gridRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<DragState>(null);
    const [preview, setPreview] = useState<Record<string, { startMin: number; duration: number }>>({});
    const previewRef = useRef(preview);
    const movedRef = useRef(false);
    previewRef.current = preview;

    const unscheduled = tasks.filter(isUnscheduledTask);
    const scheduled = tasks.filter((task) => !isUnscheduledTask(task));

    const scheduledStarts = scheduled
        .map((task) => hhmmToMinutes(task.scheduledStart))
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

    const intervals = scheduled
        .map((task) => {
            const previewSlot = preview[task.id];
            if (previewSlot) {
                return { id: task.id, startMin: previewSlot.startMin, endMin: previewSlot.startMin + previewSlot.duration };
            }
            return scheduledTaskInterval(task);
        })
        .filter((item): item is NonNullable<typeof item> => item != null);

    const columns = useMemo(() => assignOverlapColumns(intervals), [intervals]);

    const rawMinutesFromClientY = (clientY: number) => {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return visible.startMin;
        const y = clientY - rect.top + (gridRef.current?.scrollTop ?? 0);
        return visible.startMin + y / pixelsPerMinute;
    };

    const minutesFromClientY = (clientY: number) => snapMinutes(rawMinutesFromClientY(clientY));

    useEffect(() => {
        if (!drag) return;

        /**
         * Week view only: when the pointer is over another day (or an unscheduled
         * area) publish the drag so that column draws the preview. Returns true when
         * the drag is handled there and the local preview must stay hidden.
         */
        const updateWeekTarget = (event: PointerEvent): boolean => {
            if (!weekSetDrag || drag.kind === 'resize') return false;
            const source = drag.kind === 'move' ? 'scheduled' : 'unscheduled';
            const hit = resolveWeekDropHit(event.clientX, event.clientY, { columnFallback: drag.kind === 'move' });
            if (!hit) {
                weekSetDrag(null);
                return false;
            }
            if (hit.date === currentDate && (hit.kind === 'grid' || source === 'unscheduled')) {
                // The own grid keeps the local preview; a chip over its own area has nowhere to go.
                weekSetDrag(null);
                if (hit.kind === 'unscheduled') {
                    setPreview({});
                    return true;
                }
                return false;
            }
            const task = tasks.find((item) => item.id === drag.taskId);
            const duration =
                drag.kind === 'move' ? drag.duration : task ? taskDurationMinutes(task) : MIN_BLOCK_MINUTES;
            const target: TimelineDropTarget =
                hit.kind === 'unscheduled'
                    ? { kind: 'unscheduled', date: hit.date }
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
            weekSetDrag({
                taskId: drag.taskId,
                title: task?.title ?? '',
                source,
                fromDate: currentDate,
                duration,
                target,
            });
            return true;
        };

        const onMove = (event: PointerEvent) => {
            if (updateWeekTarget(event)) return;
            if (drag.kind === 'schedule') {
                const startMin = clampMinutes(minutesFromClientY(event.clientY), visible.startMin, visible.endMin - MIN_BLOCK_MINUTES);
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
            const delta = (event.clientY - drag.originY) / pixelsPerMinute;
            if (Math.abs(event.clientY - drag.originY) > 4) movedRef.current = true;
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

        const persist = async (taskId: string, startMin: number, duration: number) => {
            const scheduledStart = minutesToHHMM(startMin);
            const sectionId = getPersistedSectionForTime(sections, scheduledStart);
            await updateTask(taskId, {
                scheduledStart,
                estimatedMinutes: duration,
                ...(sectionId ? { sectionId } : {}),
            });
        };

        const onUp = async (event: PointerEvent) => {
            const current = drag;
            setDrag(null);

            const weekDrag = weekDragRef?.current;
            if (weekSetDrag && weekDrag && weekDrag.taskId === current.taskId && current.kind !== 'resize') {
                weekSetDrag(null);
                setPreview({});
                await updateTask(
                    current.taskId,
                    buildTimelineDropUpdate({
                        source: weekDrag.source,
                        target: weekDrag.target,
                        duration: weekDrag.duration,
                        sections,
                    })
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
                if (event.clientY < rect.top || event.clientY > rect.bottom) {
                    setPreview({});
                    return;
                }
                const startMin = slot?.startMin ?? minutesFromClientY(event.clientY);
                const duration = slot?.duration ?? MIN_BLOCK_MINUTES;
                setPreview({});
                await persist(current.taskId, startMin, duration);
                return;
            }
            setPreview({});
            if (!slot || !movedRef.current) return;
            await persist(current.taskId, slot.startMin, slot.duration);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            // Never leave a preview behind in another column if this drag ends without a drop.
            weekClearDrag?.(drag.taskId);
        };
        // preview is read on pointerup; including it would rebind every pixel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, sections, tasks, updateTask, visible.endMin, visible.startMin, pixelsPerMinute, currentDate, weekSetDrag, weekClearDrag, weekDragRef]);

    const hourMarks: number[] = [];
    for (let minute = Math.floor(visible.startMin / 60) * 60; minute <= visible.endMin; minute += 60) {
        if (minute >= visible.startMin) hourMarks.push(minute);
    }

    const isToday = currentDate === format(currentTime, 'yyyy-MM-dd');
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const showNow = isToday && nowMin >= visible.startMin && nowMin <= visible.endMin;

    // A drag from another week column that would land here (or on this unscheduled area).
    const incoming = week?.drag && week.drag.target.date === currentDate ? week.drag : null;
    const incomingStartMin = incoming?.target.kind === 'grid' ? incoming.target.startMin : null;
    const incomingUnscheduled = incoming?.target.kind === 'unscheduled' ? incoming : null;
    // The task being carried away from this column is drawn faded in place.
    const carriedTaskId = week?.drag?.taskId ?? null;

    const titleLineHeight = compact ? 16 : 20;

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
                <h3 className="text-[11px] font-semibold text-gray-900">{t('unscheduled')}</h3>
                {incomingUnscheduled ? (
                    <p className="text-[11px] text-blue-800 mt-0.5">
                        {incomingUnscheduled.source === 'scheduled' ? t('dropToUnschedule') : t('dropToMove')}
                    </p>
                ) : (
                    unscheduledPlacement === 'top' && (
                        <p className="text-xs text-gray-600 mt-0.5 mb-2">{t('unscheduledHint')}</p>
                    )
                )}
                {unscheduled.length === 0 ? (
                    <p className="text-xs text-gray-400">—</p>
                ) : (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                        {unscheduled.map((task) => (
                            <button
                                key={task.id}
                                type="button"
                                data-task-id={task.id}
                                title={task.title}
                                onPointerDown={(event) => {
                                    if (!canEditTask(task)) return;
                                    event.preventDefault();
                                    movedRef.current = false;
                                    setDrag({ kind: 'schedule', taskId: task.id });
                                }}
                                onClick={() => {
                                    if (!movedRef.current) onEditTask(task);
                                }}
                                className={clsx(
                                    'max-w-full px-2 py-1 rounded-md border border-gray-200 bg-gray-50 text-left text-xs text-gray-900 break-words cursor-grab active:cursor-grabbing',
                                    carriedTaskId === task.id && 'opacity-40'
                                )}
                            >
                                {task.title}
                            </button>
                        ))}
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
                <div className="relative" style={{ height: gridHeight, marginLeft: labelGutter }}>
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
                        // The title comes first and takes every line the block has room for.
                        const titleLines = Math.max(1, Math.floor((height - BLOCK_PADDING_Y) / titleLineHeight));

                        return (
                            <div
                                key={task.id}
                                data-task-id={task.id}
                                className={clsx(
                                    'absolute rounded-lg border px-2 py-1 overflow-hidden shadow-sm',
                                    task.status === 'in_progress'
                                        ? 'bg-blue-50 border-blue-400'
                                        : task.status === 'done'
                                            ? 'bg-emerald-50 border-emerald-300'
                                            : 'bg-indigo-50 border-indigo-200',
                                    editable && 'cursor-grab active:cursor-grabbing',
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
                                    event.preventDefault();
                                    movedRef.current = false;
                                    setDrag({
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
                                <div className="flex items-start justify-between gap-1">
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
                                        <div className="flex-shrink-0 text-[11px] leading-5 font-mono text-gray-600">
                                            {minutesToHHMM(interval.startMin)}–{minutesToHHMM(interval.endMin)}
                                        </div>
                                    )}
                                    {editable && task.status !== 'done' && (
                                        <button
                                            type="button"
                                            className="text-xs text-blue-700 hover:underline cursor-pointer flex-shrink-0"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (task.status === 'in_progress') onStop(task);
                                                else onPlay(task);
                                            }}
                                        >
                                            {task.status === 'in_progress' ? '■' : '▶'}
                                        </button>
                                    )}
                                </div>
                                {editable && (
                                    <button
                                        type="button"
                                        data-resize="true"
                                        aria-label={t('resize')}
                                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                                        onPointerDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            movedRef.current = true;
                                            setDrag({
                                                kind: 'resize',
                                                taskId: task.id,
                                                originY: event.clientY,
                                                originDuration: interval.endMin - interval.startMin,
                                                startMin: interval.startMin,
                                            });
                                        }}
                                    />
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
