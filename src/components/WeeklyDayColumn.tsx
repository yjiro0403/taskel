import { Task } from '@/types';
import { format, isToday } from 'date-fns';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useState } from 'react';
import AddTaskModal from './AddTaskModal';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WeeklyTaskItem from './WeeklyTaskItem';

interface Props {
    date: Date;
    tasks: Task[];
}

interface SortableTaskItemProps {
    task: Task;
    onToggle: (id: string, current: string) => void;
    onClick: (task: Task) => void;
}

function SortableTaskItem({ task, onToggle, onClick }: SortableTaskItemProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className={isDragging ? "pointer-events-none z-0" : "z-10"}>
            <WeeklyTaskItem
                task={task}
                onToggle={onToggle}
                onClick={onClick}
                isDragging={isDragging}
                dragHandleProps={{ ...attributes, ...listeners }}
            />
        </div>
    );
}

export default function WeeklyDayColumn({ date, tasks }: Props) {
    const { updateTask } = useStore();
    const formattedDate = format(date, 'd');
    const dayName = format(date, 'EEE');
    const isCurrentDay = isToday(date);
    const dateStr = format(date, 'yyyy-MM-dd'); // Correct format for reuse

    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const { setNodeRef } = useDroppable({
        id: dateStr,
    });

    const completedCount = tasks.filter(t => t.status === 'done').length;
    const totalCount = tasks.length;
    const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

    const handleToggle = (taskId: string, currentStatus: string) => {
        updateTask(taskId, { status: currentStatus === 'done' ? 'open' : 'done' });
    };

    return (
        <div
            ref={setNodeRef}
            className={clsx(
                "flex flex-col h-full bg-white rounded-xl border transition-colors relative group/column",
                isCurrentDay ? "border-blue-500 shadow-sm" : "border-gray-100"
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Header */}
            <div className={clsx(
                "p-3 border-b border-gray-100 rounded-t-xl relative",
                isCurrentDay ? "bg-blue-50" : "bg-white"
            )}>
                <div className="flex justify-between items-baseline mb-1">
                    <span className={clsx("text-sm font-semibold uppercase", isCurrentDay ? "text-blue-600" : "text-gray-500")}>
                        {dayName}
                    </span>
                    <span className={clsx("text-lg font-bold", isCurrentDay ? "text-blue-700" : "text-gray-900")}>
                        {formattedDate}
                    </span>
                </div>

                {/* Progress Bar (mini) */}
                <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                        className={clsx("h-full rounded-full transition-all duration-500", isCurrentDay ? "bg-blue-500" : "bg-green-500")}
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <div className="text-[10px] text-gray-400 mt-1 text-right">
                    {completedCount}/{totalCount}
                </div>
            </div>

            {/* Task List */}
            <div className="flex-1 p-2 space-y-1 overflow-y-auto min-h-[150px] pb-10">
                <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {tasks.map(task => (
                        <SortableTaskItem
                            key={task.id}
                            task={task}
                            onToggle={handleToggle}
                            onClick={setEditingTask}
                        />
                    ))}
                    {tasks.length === 0 && (
                        <div className="h-full flex items-center justify-center text-gray-300 text-xs italic min-h-[50px]">
                            Empty
                        </div>
                    )}
                </SortableContext>
            </div>

            {/* Add Button (Floating at bottom right of the column) */}
            <button
                onClick={() => setIsAddModalOpen(true)}
                className={clsx(
                    "absolute bottom-2 right-2 p-1.5 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 hover:scale-105 active:scale-95 transition-all",
                    isHovered || isAddModalOpen ? "opacity-100" : "opacity-0 lg:opacity-0"
                )}
                title="Add Task"
            >
                <Plus size={16} />
            </button>

            {/* Modals */}
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
                initialDate={dateStr}
            />
        </div>
    );
}
