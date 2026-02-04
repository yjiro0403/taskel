
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Task, Project } from '@/types';
import { Plus, GripVertical, CheckCircle2, Circle } from 'lucide-react';
import clsx from 'clsx';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AddTaskModal from './AddTaskModal';

interface Props {
    date: string; // YYYY-MM-DD
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
        zIndex: isDragging ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
    };

    const project = goalsProject(goal, projects);

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-100 shadow-sm group hover:border-gray-200 cursor-pointer"
            onClick={() => onClick(goal)}
        >
            <div {...attributes} {...listeners} className="cursor-grab text-gray-300 hover:text-gray-500" onClick={(e) => e.stopPropagation()}>
                <GripVertical size={16} />
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle(goal.id, goal.status);
                }}
                className={clsx("transition-colors", goal.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-gray-400")}
            >
                {goal.status === 'done' ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </button>
            <div className="flex-1 min-w-0">
                <div className={clsx("text-sm text-gray-700 truncate", goal.status === 'done' && "line-through text-gray-400")}>
                    {goal.title}
                </div>
                <div className="flex items-center gap-2">
                    {project && (
                        <div className="text-xs text-blue-600 truncate opacity-75">
                            {project.title}
                        </div>
                    )}
                    {goal.score !== undefined && (
                        <div className="text-[10px] text-gray-400 font-mono" title="Score">
                            Sc: {goal.score}
                        </div>
                    )}
                </div>
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(goal.id);
                }}
                className="opacity-100 lg:opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
            >
                <Plus size={16} className="rotate-45" />
            </button>
        </div>
    );
}

function goalsProject(goal: Task, projects: Project[]) {
    if (!goal.projectId) return null;
    return projects.find(p => p.id === goal.projectId);
}

export default function DailyGoalList({ date, goals }: Props) {
    const { updateTask, deleteTask, projects, reorderTasks } = useStore();
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    const toggleStatus = (taskId: string, currentStatus: string) => {
        updateTask(taskId, { status: currentStatus === 'done' ? 'open' : 'done' });
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
        <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/50">
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-semibold text-blue-800 uppercase tracking-wider flex items-center gap-2">
                    Daily Goals <span className="bg-white text-blue-600 px-2 py-0.5 rounded-full text-xs font-bold shadow-sm">{goals.length}</span>
                </h3>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="p-1 text-blue-400 hover:text-blue-600 hover:bg-white rounded transition-colors"
                >
                    <Plus size={18} />
                </button>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={goals.map(g => g.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {goals.length === 0 && (
                            <div className="text-center py-4 text-gray-400 text-xs italic">
                                <p>No daily goals set</p>
                                <button onClick={() => setIsAddModalOpen(true)} className="mt-1 text-blue-500 hover:underline">
                                    Set a goal
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
            </DndContext>

            {editingTask && (
                <AddTaskModal
                    isOpen={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    taskToEdit={editingTask}
                />
            )}

            <AddTaskModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                initialAssignedDate={date}
            />
        </div>
    );
}
