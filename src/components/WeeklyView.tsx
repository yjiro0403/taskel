'use client';

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { Task } from '@/types';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, getISOWeek, getISOWeekYear } from 'date-fns';
import WeeklyGoalList from './WeeklyGoalList';
import WeeklyDayColumn from './WeeklyDayColumn';
import WeeklyNotePanel from './WeeklyNotePanel';
import {
    DndContext,
    closestCenter,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState } from 'react';
import GoalItem from './GoalItem';
import WeeklyTaskItem from './WeeklyTaskItem';

interface WeeklyViewProps {
    currentDate?: Date;
}

export default function WeeklyView({ currentDate = new Date() }: WeeklyViewProps) {
    const { tasks, getMergedTasks, updateTask } = useStore();

    // Calculate Week Range
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

    // Calculate Week ID: YYYY-Www
    const weekId = `${getISOWeekYear(weekStart)}-W${String(getISOWeek(weekStart)).padStart(2, '0')}`;

    // Filter Weekly Goals
    const weeklyGoals = useMemo(() => {
        return tasks.filter(t => t.assignedWeek === weekId && !t.date).sort((a, b) => a.order - b.order);
    }, [tasks, weekId]);

    // Get Tasks for each day
    const dayTasksMap = useMemo(() => {
        const map = new Map<string, Task[]>();
        days.forEach(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const dayTasks = getMergedTasks(dateStr);
            map.set(dateStr, dayTasks);
        });
        return map;
    }, [days, getMergedTasks]);

    // --- DnD Logic ---
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const [activeId, setActiveId] = useState<string | null>(null);

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(String(event.active.id));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeTaskId = String(active.id);
        const overId = String(over.id);

        if (activeTaskId === overId) return;

        const activeTask = tasks.find(t => t.id === activeTaskId);
        if (!activeTask) return;

        // 1. Dropped on Weekly Goal List Container
        if (overId === `week-${weekId}`) {
            updateTask(activeTaskId, { assignedWeek: weekId, date: undefined });
            return;
        }

        // 2. Dropped on a Day Column Container (yyyy-MM-dd)
        if (/\d{4}-\d{2}-\d{2}/.test(overId) && overId.length === 10) {
            updateTask(activeTaskId, { date: overId });
            return;
        }

        // 3. Dropped on another item (Task or Goal)
        const overTask = tasks.find(t => t.id === overId);
        if (overTask) {
            if (overTask.date) {
                // Dropped onto a daily task -> Assign to that date
                if (activeTask.date !== overTask.date) {
                    updateTask(activeTaskId, { date: overTask.date });
                }
            } else if (overTask.assignedWeek) {
                // Dropped onto a weekly goal -> Assign to week (remove date)
                if (activeTask.date || activeTask.assignedWeek !== overTask.assignedWeek) {
                    updateTask(activeTaskId, { assignedWeek: overTask.assignedWeek, date: undefined });
                }
            }
        }
    };

    const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="flex flex-col h-full bg-white">
                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                    {/* Main Area: Goals + Days */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">
                        {/* Goals Section */}
                        <div className="shrink-0">
                            <WeeklyGoalList weekId={weekId} goals={weeklyGoals} />
                        </div>

                        {/* Days Grid */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4 min-w-0 lg:min-w-[800px] min-h-[300px]">
                            {days.map(day => (
                                <WeeklyDayColumn
                                    key={day.toISOString()}
                                    date={day}
                                    tasks={dayTasksMap.get(format(day, 'yyyy-MM-dd')) || []}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Right Panel: Notes */}
                    <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-gray-200 bg-white p-4 overflow-y-auto shrink-0 md:h-[300px] lg:h-auto">
                        <WeeklyNotePanel weekId={weekId} />
                    </div>
                </div>
            </div>

            <DragOverlay>
                {activeTask ? (
                    <div className="w-[200px]">
                        {activeTask.date ? (
                            <WeeklyTaskItem task={activeTask} isOverlay />
                        ) : (
                            <GoalItem task={activeTask} isOverlay />
                        )}
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
