import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Task, Project } from '@/types';
import { Plus, GripVertical, CheckCircle2, Circle } from 'lucide-react';
import clsx from 'clsx';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AddTaskModal from './AddTaskModal';
import GoalItem from './GoalItem';

interface Props {
    weekId: string;
    goals: Task[];
}

interface SortableGoalItemProps {
    goal: Task;
    projects: Project[];
    onToggle: (id: string, current: string) => void;
    onDelete: (id: string) => void;
    onClick: (goal: Task) => void;
}

function SortableGoalItem({ goal, projects, onToggle, onDelete, onClick }: SortableGoalItemProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const project = projects.find(p => p.id === goal.projectId);

    return (
        <div ref={setNodeRef} style={style}>
            <GoalItem
                task={goal}
                project={project}
                onToggle={onToggle}
                onDelete={onDelete}
                onClick={onClick}
                isDragging={isDragging}
                dragHandleProps={{ ...attributes, ...listeners }}
            />
        </div>
    );
}



export default function WeeklyGoalList({ weekId, goals }: Props) {
    const { updateTask, deleteTask, projects, reorderTasks } = useStore();
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const toggleStatus = (taskId: string, currentStatus: string) => {
        updateTask(taskId, { status: currentStatus === 'done' ? 'open' : 'done' });
    };

    const { setNodeRef } = useDroppable({
        id: `week-${weekId}`,
    });

    return (
        <div ref={setNodeRef} className="bg-gray-50/50 p-4 rounded-xl h-full flex flex-col">
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    Weekly Goals <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">{goals.length}</span>
                </h3>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-white rounded transition-colors"
                >
                    <Plus size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                <SortableContext items={goals.map(g => g.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2 min-h-[50px]">
                        {goals.length === 0 && (
                            <div className="text-center py-6 text-gray-400 text-xs italic">
                                <p>No goals for this week</p>
                                <button onClick={() => setIsAddModalOpen(true)} className="mt-1 text-blue-500 hover:underline">
                                    Create one
                                </button>
                            </div>
                        )}
                        {goals.map(goal => (
                            <SortableGoalItem
                                key={goal.id}
                                goal={goal}
                                projects={projects}
                                onToggle={toggleStatus}
                                onDelete={deleteTask}
                                onClick={setEditingTask}
                            />
                        ))}
                    </div>
                </SortableContext>
            </div>

            {editingTask && (
                <AddTaskModal
                    isOpen={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    existingTask={editingTask}
                />
            )}

            <AddTaskModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                initialAssignedWeek={weekId}
            />
        </div>
    );
}
