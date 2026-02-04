'use client';

import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import YearlyGoalList from './YearlyGoalList';
import YearlyMonthColumn from './YearlyMonthColumn';
import YearlyNotePanel from './YearlyNotePanel';
import { DndContext, closestCenter } from '@dnd-kit/core';

interface YearlyViewProps {
    currentDate?: Date;
    toggleLeftSidebar?: () => void;
}

export default function YearlyView({ currentDate = new Date() }: YearlyViewProps) {
    const { tasks } = useStore();
    const yearId = format(currentDate, 'yyyy');

    // Filter tasks
    const yearlyGoals = tasks.filter(t => t.assignedYear === yearId);

    // Group Monthly Goals
    const monthlyGoalsMap = new Map<string, typeof tasks>();

    // Monthly Goals are tasks with `assignedMonth` matching the year
    tasks.filter(t => t.assignedMonth && t.assignedMonth.startsWith(yearId)).forEach(t => {
        const mId = t.assignedMonth!;
        if (!monthlyGoalsMap.has(mId)) monthlyGoalsMap.set(mId, []);
        monthlyGoalsMap.get(mId)!.push(t);
    });

    const months = Array.from({ length: 12 }, (_, i) => {
        const monthNum = String(i + 1).padStart(2, '0');
        return {
            id: `${yearId}-${monthNum}`,
            label: format(new Date(parseInt(yearId), i, 1), 'MMMM'), // January, February...
            shortLabel: format(new Date(parseInt(yearId), i, 1), 'MMM'), // Jan, Feb...
        };
    });

    return (
        <div className="flex flex-col h-full text-gray-900 bg-gray-50">
            {/* Header Removed - Controlled by PlanningView */}

            {/* Content Container */}
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                {/* Main Area: Goals + Months */}
                <div className="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 gap-6">
                    <div className="flex flex-col lg:flex-row gap-6 h-full">
                        {/* Yearly Goals (Left Column) */}
                        <div className="w-full lg:w-64 shrink-0">
                            <YearlyGoalList yearId={yearId} goals={yearlyGoals} />
                        </div>

                        {/* Months Grid (Center) */}
                        {/* Ensure this grid has enough height to show content. layout is h-full, needs overflow handled above. */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
                            {months.map((month) => (
                                <YearlyMonthColumn
                                    key={month.id}
                                    monthId={month.id}
                                    monthLabel={month.label}
                                    goals={monthlyGoalsMap.get(month.id) || []}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Panel: Yearly Notes */}
                <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-gray-200 bg-white p-4 overflow-y-auto shrink-0 md:h-[300px] lg:h-auto">
                    <YearlyNotePanel yearId={yearId} />
                </div>
            </div>

            <DndContext collisionDetection={closestCenter}>
                {/* Context for potential future drag-and-drop */}
            </DndContext>
        </div>
    );
}
