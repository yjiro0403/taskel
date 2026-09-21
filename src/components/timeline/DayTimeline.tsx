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
import { useStore } from '@/store/useStore';

const DEFAULT_PIXELS_PER_MINUTE = 1.2;
const DEFAULT_GUTTER = 56;
const DEFAULT_MAX_HEIGHT = 900;

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
}

type DragState =
    | { kind: 'move'; taskId: string; originY: number; originStart: number; duration: number }
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
}: DayTimelineProps) {
    const t = useTranslations('Timeline');
    const updateTask = useStore((state) => state.updateTask);
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

    const minutesFromClientY = (clientY: number) => {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return visible.startMin;
        const y = clientY - rect.top + (gridRef.current?.scrollTop ?? 0);
        return snapMinutes(visible.startMin + y / pixelsPerMinute);
    };

    useEffect(() => {
        if (!drag) return;

        const onMove = (event: PointerEvent) => {
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
        };
        // preview is read on pointerup; including it would rebind every pixel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, sections, tasks, updateTask, visible.endMin, visible.startMin, pixelsPerMinute]);

    const hourMarks: number[] = [];
    for (let minute = Math.floor(visible.startMin / 60) * 60; minute <= visible.endMin; minute += 60) {
        if (minute >= visible.startMin) hourMarks.push(minute);
    }

    const isToday = currentDate === format(currentTime, 'yyyy-MM-dd');
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const showNow = isToday && nowMin >= visible.startMin && nowMin <= visible.endMin;

    const unscheduledSection = showUnscheduled ? (
            <section className={clsx(
                'p-2',
                plainChrome ? 'bg-transparent border-t border-gray-100' : 'bg-white border border-gray-200',
                !plainChrome && (unscheduledPlacement === 'top' ? 'rounded-xl' : 'rounded-b-xl border-t-0')
            )}>
                <h3 className="text-[11px] font-semibold text-gray-900">{t('unscheduled')}</h3>
                {unscheduledPlacement === 'top' && (
                    <p className="text-xs text-gray-600 mt-0.5 mb-2">{t('unscheduledHint')}</p>
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
                                onPointerDown={(event) => {
                                    if (!canEditTask(task)) return;
                                    event.preventDefault();
                                    movedRef.current = false;
                                    setDrag({ kind: 'schedule', taskId: task.id });
                                }}
                                onClick={() => {
                                    if (!movedRef.current) onEditTask(task);
                                }}
                                className="px-2 py-1 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-900 cursor-grab active:cursor-grabbing"
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
                        const height = Math.max(24, (interval.endMin - interval.startMin) * pixelsPerMinute);
                        const editable = canEditTask(task);

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
                                    editable && 'cursor-grab active:cursor-grabbing'
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
                                    });
                                }}
                                onClick={() => {
                                    if (!movedRef.current) onEditTask(task);
                                }}
                            >
                                <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0">
                                        <div className="text-xs font-mono text-gray-600">
                                            {minutesToHHMM(interval.startMin)}–{minutesToHHMM(interval.endMin)}
                                        </div>
                                        <div className="text-sm font-medium text-gray-900 truncate">{task.title}</div>
                                    </div>
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
                </div>
            </div>
            {unscheduledPlacement === 'bottom' && unscheduledSection}
        </div>
    );
}
