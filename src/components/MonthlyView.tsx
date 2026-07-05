'use client';

import { useStore } from '@/store/useStore';
import { format, startOfMonth, endOfMonth, eachWeekOfInterval, startOfWeek, endOfWeek } from 'date-fns';
import MonthlyGoalList from './MonthlyGoalList';
import MonthlyWeekColumn from './MonthlyWeekColumn';
import MonthlyNotePanel from './MonthlyNotePanel';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { useState } from 'react';
import GoalItem from './GoalItem';

interface MonthlyViewProps {
    currentDate?: Date;
    toggleLeftSidebar?: () => void; // Optional/Deprecated but keeping signature compatible if needed elsewhere
}

export default function MonthlyView({ currentDate = new Date() }: MonthlyViewProps) {
    const { tasks, updateTask, reorderTasks } = useStore();

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const monthId = format(currentDate, 'yyyy-MM');

    // Calculate weeks for this month
    const weeks = eachWeekOfInterval({
        start: startOfWeek(monthStart, { weekStartsOn: 1 }),
        end: endOfWeek(monthEnd, { weekStartsOn: 1 })
    }, { weekStartsOn: 1 });

    // Filter tasks
    // Filter tasks
    const monthlyGoals = tasks.filter(t => t.assignedMonth === monthId && !t.assignedWeek); // Month goals only (not assigned to a week)

    // Group Weekly Goals by weekId
    const weeklyGoalsMap = new Map<string, typeof tasks>();
    const allWeeklyGoals = tasks.filter(t => t.assignedWeek && !t.date);

    allWeeklyGoals.forEach(t => {
        const wId = t.assignedWeek!;
        if (!weeklyGoalsMap.has(wId)) weeklyGoalsMap.set(wId, []);
        weeklyGoalsMap.get(wId)!.push(t);
    });

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

        // Determine destination
        // 1. Dropped on another Goal（週ゴール or 月ゴール）
        const overTask = tasks.find(t => t.id === overId);
        if (overTask) {
            const activeTask = tasks.find(t => t.id === activeTaskId);
            if (!activeTask) return;

            const targetWeekId = overTask.assignedWeek;

            if (targetWeekId) {
                // 週ゴールの上にドロップ
                if (activeTask.assignedWeek !== targetWeekId) {
                    // 別の週へ移動
                    updateTask(activeTaskId, { assignedWeek: targetWeekId });
                } else {
                    // 同一週内での並び替え（従来は未実装で元に戻っていた）
                    const list = (weeklyGoalsMap.get(targetWeekId) ?? [])
                        .slice()
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                    const oldIndex = list.findIndex(g => g.id === activeTaskId);
                    const newIndex = list.findIndex(g => g.id === overId);
                    if (oldIndex !== -1 && newIndex !== -1) {
                        reorderTasks(arrayMove(list, oldIndex, newIndex).map(g => g.id));
                    }
                }
            } else if (overTask.assignedMonth && !overTask.assignedWeek) {
                // 月ゴールの上にドロップ → 月ゴール一覧内での並び替え
                if (!activeTask.assignedWeek && activeTask.assignedMonth === overTask.assignedMonth) {
                    const list = monthlyGoals
                        .slice()
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                    const oldIndex = list.findIndex(g => g.id === activeTaskId);
                    const newIndex = list.findIndex(g => g.id === overId);
                    if (oldIndex !== -1 && newIndex !== -1) {
                        reorderTasks(arrayMove(list, oldIndex, newIndex).map(g => g.id));
                    }
                }
            }
            return;
        }

        // 2. Dropped on a Week Column (empty or not)
        // Week IDs format: RRRR-'W'II (e.g., 2026-W05)
        if (overId.includes('-W')) {
            updateTask(activeTaskId, { assignedWeek: overId, assignedMonth: undefined });
            return;
        }

        // 3. Dropped back to Monthly Goal List
        if (overId === `month-${monthId}`) {
            updateTask(activeTaskId, { assignedWeek: undefined, assignedMonth: monthId });
            return;
        }
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="flex flex-col h-full bg-white relative">
                {/* Header Removed - Controlled by PlanningView */}

                {/* Content Container */}
                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                    {/* Main Area: Goals + Weeks */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">
                        <div className="flex flex-col lg:flex-row gap-6 h-full">
                            {/* Monthly Goals (Left Column) */}
                            <div className="w-full lg:w-64 shrink-0">
                                <MonthlyGoalList monthId={monthId} goals={monthlyGoals} />
                            </div>

                            {/* Weeks Grid (Center) */}
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
                                {weeks.map((weekStart, index) => {
                                    const wId = format(weekStart, "RRRR-'W'II", { weekStartsOn: 1 });
                                    const endDate = endOfWeek(weekStart, { weekStartsOn: 1 });
                                    const dateRange = `${format(weekStart, 'MMM d')} - ${format(endDate, 'MMM d')}`;
                                    const weekLabel = `Week ${index + 1}`;

                                    return (
                                        <MonthlyWeekColumn
                                            key={wId}
                                            weekId={wId}
                                            weekLabel={weekLabel}
                                            dateRange={dateRange}
                                            goals={weeklyGoalsMap.get(wId) || []}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Monthly Notes */}
                    <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-gray-200 bg-white p-4 overflow-y-auto shrink-0 md:h-[300px] lg:h-auto">
                        <MonthlyNotePanel monthId={monthId} />
                    </div>
                </div>
            </div>
            <DragOverlay>
                {activeId ? (
                    <div style={{ transform: 'rotate(2deg)' }}>
                        <GoalItem
                            task={tasks.find(t => t.id === activeId)!}
                            isOverlay
                        />
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
