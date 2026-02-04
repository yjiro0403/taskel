'use client';

import { useState } from 'react';
import { Task } from '@/types';
import { useStore } from '@/store/useStore';
import clsx from 'clsx';
import { CheckCircle2, Circle, Plus, GripVertical } from 'lucide-react';
import AddTaskModal from './AddTaskModal';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Props {
    weekId: string; // YYYY-Www
    weekLabel: string; // "Week 1", etc.
    dateRange: string; // "Jan 1 - Jan 7"
    goals: Task[]; // Weekly Goals for this week
}

function SortableItem({ task, onClick, onDelete, onToggle }: { task: Task; onClick: (t: Task) => void; onDelete: (id: string) => void; onToggle: (id: string, s: string) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group flex items-start gap-2 p-3 bg-white hover:bg-gray-50 rounded-lg border border-gray-200 shadow-sm cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
            onClick={() => onClick(task)}
        >
            <div {...attributes} {...listeners} className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <GripVertical size={14} />
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onToggle(task.id, task.status); }}
                className={clsx("mt-0.5 transition-colors", task.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-green-500")}
            >
                {task.status === 'done' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </button>
            <div className="flex-1 min-w-0">
                <p className={clsx("text-sm text-gray-900 leading-tight break-words", task.status === 'done' && "line-through text-gray-400")}>
                    {task.title}
                </p>
                {(task.projectId || (task.tags && task.tags.length > 0)) && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {task.projectId && (
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400/50" />
                        )}
                        {task.tags?.map(tag => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">#{tag}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MonthlyWeekColumn({ weekId, weekLabel, dateRange, goals }: Props) {
    const { updateTask, deleteTask } = useStore();
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const { setNodeRef } = useDroppable({
        id: weekId,
    });

    const toggleStatus = (id: string, current: string) => {
        updateTask(id, { status: current === 'done' ? 'open' : 'done' });
    };

    return (
        <div ref={setNodeRef} className="flex flex-col h-full min-h-[150px] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden relative group/column">
            {/* Header */}
            <div className="p-3 border-b border-gray-100 bg-gray-50/50">
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-900">{weekLabel}</span>
                    <span className="text-xs text-gray-500 mt-0.5">{dateRange}</span>
                </div>
                {/* Progress Bar could go here */}
            </div>

            {/* Content */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                <SortableContext items={goals.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {goals.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-300 text-xs italic p-4 text-center">
                            No goals for this week
                        </div>
                    ) : (
                        goals.map(goal => (
                            <SortableItem
                                key={goal.id}
                                task={goal}
                                onClick={setEditingTask}
                                onDelete={deleteTask}
                                onToggle={toggleStatus}
                            />
                        ))
                    )}
                </SortableContext>
            </div>

            {/* Add Button */}
            <button
                onClick={() => setIsAddModalOpen(true)}
                className="absolute bottom-2 right-2 p-1.5 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all opacity-100 lg:opacity-0 lg:group-hover/column:opacity-100"
                title="Add Weekly Goal"
            >
                <Plus size={16} />
            </button>

            {/* Edit/Add Modals */}
            {editingTask && (
                <AddTaskModal
                    isOpen={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    existingTask={editingTask}
                />
            )}

            {/* When adding from here, we are adding a Task, assigning it to this week, BUT NO DATE. 
                Using `initialDate` prop in AddTaskModal would set a specific date.
                We need a way to pass `assignedWeek` to AddTaskModal instead.
                Since AddTaskModal doesn't natively support `assignedWeek` prop yet (only existingTask or initialDate),
                we might need to update AddTaskModal AGAIN or pass a partial Task object as `existingTask` (hacky)
                or just update AddTaskModal to accept `initialAssignedWeek`.
                
                Let's use the hacky way for now: pass `taskToEdit` with just the assignedWeek set? 
                No, simpler: Update AddTaskModal to accept `initialAssignedWeek`.
            */}
            <AddTaskModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                initialAssignedWeek={weekId}
            />
        </div>
    );
}
