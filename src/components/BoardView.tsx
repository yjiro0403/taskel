'use client';

import { useMemo } from 'react';
import { Task, TaskStatus } from '@/types';
import { DndContext, DragOverlay, useDraggable, useDroppable, DragEndEvent, closestCorners } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Circle, CheckCircle2, Clock } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface BoardViewProps {
    tasks: Task[];
    onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
    onEditTask: (task: Task) => void;
}

const COLUMNS: { id: TaskStatus; title: string; color: string; icon: any }[] = [
    { id: 'open', title: 'To Do', color: 'bg-gray-100', icon: Circle },
    { id: 'in_progress', title: 'Doing', color: 'bg-blue-50', icon: Clock },
    { id: 'done', title: 'Done', color: 'bg-green-50', icon: CheckCircle2 },
];

export default function BoardView({ tasks, onUpdateTask, onEditTask }: BoardViewProps) {

    // Group tasks by status
    const groupedTasks = useMemo(() => {
        const groups: Record<string, Task[]> = { open: [], in_progress: [], done: [] };
        tasks.forEach(t => {
            const status = t.status === 'skipped' ? 'done' : t.status; // Treat skipped as done for board simplicity or handle separately? 
            // Let's stick to strict map or fallback to open
            if (groups[status]) {
                groups[status].push(t);
            } else {
                // If status is not one of the main ones (e.g. skipped), maybe put in done or ignore?
                // For now, let's map 'skipped' to 'done' or just display widely.
                groups['done'].push(t);
            }
        });
        return groups;
    }, [tasks]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        // Find task
        const task = tasks.find(t => t.id === activeId);
        if (!task) return;

        // Determine new status
        // overId could be a container (status) or another task
        let newStatus: TaskStatus | null = null;

        if (COLUMNS.some(c => c.id === overId)) {
            newStatus = overId as TaskStatus;
        } else {
            // Find the task we dropped over to see its status
            const overTask = tasks.find(t => t.id === overId);
            if (overTask) {
                newStatus = overTask.status === 'skipped' ? 'done' : overTask.status;
            }
        }

        if (newStatus && newStatus !== task.status) {
            onUpdateTask(activeId, { status: newStatus });
        }
    };

    return (
        <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCorners}>
            <div className="flex gap-4 overflow-x-auto pb-4 h-[calc(100vh-250px)] min-h-[500px]">
                {COLUMNS.map(col => (
                    <Column
                        key={col.id}
                        column={col}
                        tasks={groupedTasks[col.id] || []}
                        onEditTask={onEditTask}
                    />
                ))}
            </div>
        </DndContext>
    );
}

function Column({ column, tasks, onEditTask }: { column: typeof COLUMNS[0], tasks: Task[], onEditTask: (t: Task) => void }) {
    const { setNodeRef } = useDroppable({
        id: column.id,
    });

    const Icon = column.icon;

    return (
        <div ref={setNodeRef} className={clsx("flex-1 min-w-[300px] flex flex-col rounded-xl border border-gray-200", column.color)}>
            <div className="p-3 border-b border-gray-200/50 flex justify-between items-center bg-white/50 backdrop-blur-sm rounded-t-xl sticky top-0 z-10">
                <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <Icon size={18} className={clsx(
                        column.id === 'done' ? "text-green-600" :
                            column.id === 'in_progress' ? "text-blue-600" : "text-gray-500"
                    )} />
                    {column.title}
                    <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                        {tasks.length}
                    </span>
                </div>
            </div>

            <div className="p-2 flex-1 overflow-y-auto space-y-2">
                {tasks.map(task => (
                    <DraggableTask key={task.id} task={task} onEditTask={onEditTask} />
                ))}
                {tasks.length === 0 && (
                    <div className="h-20 border-2 border-dashed border-gray-300/50 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                        No tasks
                    </div>
                )}
            </div>
        </div>
    );
}

function DraggableTask({ task, onEditTask }: { task: Task, onEditTask: (t: Task) => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.id,
    });

    const style = transform ? {
        transform: CSS.Translate.toString(transform),
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={() => onEditTask(task)} // Allow click to edit
            className={clsx(
                "bg-white p-3 rounded-lg shadow-sm border border-gray-200 group hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing",
                isDragging && "opacity-50 ring-2 ring-blue-500 z-50",
                task.status === 'done' && "opacity-75"
            )}
        >
            <div className="flex justify-between items-start mb-1">
                <h4 className={clsx("text-sm font-medium text-gray-900 line-clamp-2", task.status === 'done' && "line-through text-gray-500")}>
                    {task.title}
                </h4>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                {task.estimatedMinutes > 0 && (
                    <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {task.estimatedMinutes}m
                    </span>
                )}
                {task.date && (
                    <span className="bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                        {format(new Date(task.date), 'M/d')}
                    </span>
                )}
            </div>
        </div>
    );
}
