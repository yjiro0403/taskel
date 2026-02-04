'use client';

import { useStore } from '@/store/useStore';
import { Task } from '@/types';
import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { GripVertical, Plus, CheckCircle2, Circle } from 'lucide-react';
import clsx from 'clsx';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AddTaskModal from './AddTaskModal';

interface Props {
    yearId: string; // YYYY
    goals: Task[];
}

function SortableItem({ task, onClick, onToggle }: { task: Task; onClick: (t: Task) => void; onToggle: (id: string, s: string) => void }) {
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
            className="group flex items-start gap-3 p-3 bg-white hover:bg-gray-50 rounded-lg border border-gray-200 shadow-sm cursor-pointer transition-all hover:shadow-md"
            onClick={() => onClick(task)}
        >
            <div {...attributes} {...listeners} className="mt-1 text-gray-300 hover:text-gray-500 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <GripVertical size={16} />
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onToggle(task.id, task.status); }}
                className={clsx("mt-1 transition-colors", task.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-green-500")}
            >
                {task.status === 'done' ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </button>
            <div className="flex-1 min-w-0">
                <p className={clsx("text-base text-gray-900 font-medium break-words", task.status === 'done' && "line-through text-gray-400")}>
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
                        {task.score !== undefined && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-400 rounded-full font-mono" title="Score">Sc: {task.score}</span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function YearlyGoalList({ yearId, goals }: Props) {
    const { updateTask, reorderTasks } = useStore();
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const { setNodeRef } = useDroppable({
        id: `year-goals-${yearId}`,
    });

    const toggleStatus = (id: string, current: string) => {
        updateTask(id, { status: current === 'done' ? 'open' : 'done' });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            const oldIndex = goals.findIndex((g) => g.id === active.id);
            const newIndex = goals.findIndex((g) => g.id === over?.id);
            const newOrder = arrayMove(goals, oldIndex, newIndex);
            reorderTasks(newOrder.map(g => g.id));
        }
    };

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800">Yearly Goals</h2>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                        {goals.length}
                    </span>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="p-1.5 text-gray-500 hover:bg-white hover:text-blue-600 rounded-lg transition-colors"
                    >
                        <Plus size={18} />
                    </button>
                </div>
            </div>

            <div ref={setNodeRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={goals.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        {goals.length === 0 ? (
                            <div className="text-center py-10 text-gray-400 text-sm">
                                No goals for {yearId}
                                <br />
                                <button onClick={() => setIsAddModalOpen(true)} className="mt-2 text-blue-500 hover:underline">
                                    Create one
                                </button>
                            </div>
                        ) : (
                            goals.map(goal => (
                                <SortableItem
                                    key={goal.id}
                                    task={goal}
                                    onClick={setEditingTask}
                                    onToggle={toggleStatus}
                                />
                            ))
                        )}
                    </SortableContext>
                </DndContext>
            </div>

            {/* Add/Edit Modals */}
            {editingTask && (
                <AddTaskModal
                    isOpen={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    existingTask={editingTask}
                />
            )}

            {/* Note: AddTaskModal needs to support initialAssignedYear in the future or we use a workaround if needed. 
               For now, we will update AddTaskModal in a separate step if it doesn't support assignedYear yet.
               It likely DOES NOT support assignedYear. We need to add that support.
            */}
            <AddTaskModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                initialAssignedYear={yearId}
            />
        </div>
    );
}
