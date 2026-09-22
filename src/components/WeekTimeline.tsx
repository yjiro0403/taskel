'use client';

import { useEffect, useMemo, useState } from 'react';
import { format, isToday } from 'date-fns';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useDroppable } from '@dnd-kit/core';

import AddTaskModal from '@/components/AddTaskModal';
import DayTimeline from '@/components/timeline/DayTimeline';
import { getSectionForTime } from '@/lib/sectionUtils';
import { canEditTask as canEditTaskPermission } from '@/lib/tasks/canEditTask';
import { computeVisibleRange, hhmmToMinutes } from '@/lib/timeline/time';
import { isUnscheduledTask } from '@/lib/timeline/layout';
import { useStore } from '@/store/useStore';
import type { Task } from '@/types';

const WEEK_PIXELS_PER_MINUTE = 0.8;
const WEEK_MAX_HEIGHT = 720;

interface WeekTimelineProps {
    days: Date[];
    dayTasksMap: Map<string, Task[]>;
}

function WeekDayColumn({
    date,
    tasks,
    visibleRange,
    showHourLabels,
    currentTime,
    onEditTask,
    onPlay,
    onStop,
    canEditTask,
    onAdd,
}: {
    date: Date;
    tasks: Task[];
    visibleRange: { startMin: number; endMin: number };
    showHourLabels: boolean;
    currentTime: Date;
    onEditTask: (task: Task) => void;
    onPlay: (task: Task) => void;
    onStop: (task: Task) => void;
    canEditTask: (task: Task) => boolean;
    onAdd: () => void;
}) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const today = isToday(date);
    const { setNodeRef, isOver } = useDroppable({ id: dateStr });
    const hideEmptyIntervals = useStore((state) => state.hideEmptyIntervals);
    const sections = useStore((state) => state.sections);
    const [hovered, setHovered] = useState(false);

    return (
        <div
            ref={setNodeRef}
            className={clsx(
                'flex flex-col min-w-[160px] flex-1 border-r border-gray-100 last:border-r-0',
                isOver && 'bg-blue-50/40',
                today && 'bg-blue-50/20'
            )}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div
                className={clsx(
                    'sticky top-0 z-10 px-2 py-2 border-b border-gray-100 flex items-baseline justify-between',
                    today ? 'bg-blue-50' : 'bg-white'
                )}
            >
                <div>
                    <div className={clsx('text-[11px] font-semibold uppercase', today ? 'text-blue-600' : 'text-gray-500')}>
                        {format(date, 'EEE')}
                    </div>
                    <div className={clsx('text-lg font-bold leading-none', today ? 'text-blue-700' : 'text-gray-900')}>
                        {format(date, 'd')}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onAdd}
                    title="Add Task"
                    className={clsx(
                        'p-1 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-opacity',
                        hovered ? 'opacity-100' : 'opacity-70'
                    )}
                >
                    <Plus size={14} />
                </button>
            </div>
            <DayTimeline
                tasks={tasks.filter((task) => task.status !== 'skipped')}
                sections={sections}
                currentTime={currentTime}
                currentDate={dateStr}
                hideEmptyIntervals={hideEmptyIntervals}
                canEditTask={canEditTask}
                onEditTask={onEditTask}
                onPlay={onPlay}
                onStop={onStop}
                visibleRangeOverride={visibleRange}
                showHourLabels={showHourLabels}
                unscheduledPlacement="bottom"
                pixelsPerMinute={WEEK_PIXELS_PER_MINUTE}
                maxHeight={WEEK_MAX_HEIGHT}
                gutter={showHourLabels ? 44 : 6}
                scrollable={false}
                plainChrome
            />
        </div>
    );
}

export default function WeekTimeline({ days, dayTasksMap }: WeekTimelineProps) {
    const sections = useStore((state) => state.sections);
    const hideEmptyIntervals = useStore((state) => state.hideEmptyIntervals);
    const updateTask = useStore((state) => state.updateTask);
    const user = useStore((state) => state.user);
    const projects = useStore((state) => state.projects);
    const currentTime = useStore((state) => state.currentTime);
    const setCurrentTime = useStore((state) => state.setCurrentTime);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [addDate, setAddDate] = useState<string | null>(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
        return () => clearInterval(timer);
    }, [setCurrentTime]);

    const visibleRange = useMemo(() => {
        const scheduledStarts: number[] = [];
        for (const tasks of dayTasksMap.values()) {
            for (const task of tasks) {
                if (isUnscheduledTask(task) || task.status === 'skipped') continue;
                const start = hhmmToMinutes(task.scheduledStart);
                if (start != null) scheduledStarts.push(start);
            }
        }
        return computeVisibleRange({ sections, scheduledStarts, hideEmptyIntervals });
    }, [dayTasksMap, hideEmptyIntervals, sections]);

    const canEditTask = (task: Task) => canEditTaskPermission(task, user?.uid, projects);

    const handlePlay = async (task: Task) => {
        if (task.status === 'in_progress') return;
        const now = new Date();
        await updateTask(task.id, {
            status: 'in_progress',
            startedAt: now.getTime(),
            sectionId: getSectionForTime(sections, now),
        });
    };

    const handleStop = (task: Task) => {
        if (task.status !== 'in_progress' || !task.startedAt) return;
        const now = Date.now();
        const elapsedMinutes = Math.max(0, Math.round((now - task.startedAt) / 60000));
        updateTask(task.id, {
            status: 'done',
            startedAt: undefined,
            actualMinutes: (task.actualMinutes || 0) + elapsedMinutes,
            completedAt: now,
        });
    };

    return (
        <>
            <div className="flex-1 min-h-0 overflow-auto">
                <div className="flex min-w-[980px] min-h-full border border-gray-200 rounded-xl overflow-hidden bg-white">
                    {days.map((day, index) => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        return (
                            <WeekDayColumn
                                key={dateStr}
                                date={day}
                                tasks={dayTasksMap.get(dateStr) || []}
                                visibleRange={visibleRange}
                                showHourLabels={index === 0}
                                currentTime={currentTime}
                                onEditTask={setEditingTask}
                                onPlay={handlePlay}
                                onStop={handleStop}
                                canEditTask={canEditTask}
                                onAdd={() => setAddDate(dateStr)}
                            />
                        );
                    })}
                </div>
            </div>

            <AddTaskModal
                isOpen={!!editingTask}
                onClose={() => setEditingTask(null)}
                existingTask={editingTask}
            />
            <AddTaskModal
                isOpen={!!addDate}
                onClose={() => setAddDate(null)}
                initialDate={addDate ?? undefined}
            />
        </>
    );
}
