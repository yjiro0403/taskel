import { Task } from '@/types';
import { clsx } from 'clsx';
import { CheckCircle2, Circle, GripVertical } from 'lucide-react';

interface WeeklyTaskItemProps {
    task: Task;
    onToggle?: (id: string, current: string) => void;
    onClick?: (task: Task) => void;
    isDragging?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dragHandleProps?: any; // For dnd-kit listeners
    isOverlay?: boolean;
}

export default function WeeklyTaskItem({
    task,
    onToggle,
    onClick,
    isDragging,
    dragHandleProps, // Attached to the GripVertical handle
    isOverlay
}: WeeklyTaskItemProps) {
    return (
        <div
            className={clsx(
                "group flex items-start gap-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm cursor-pointer transition-all select-none",
                isDragging ? "opacity-30 bg-gray-50" : "hover:bg-gray-50 hover:scale-[1.02] active:scale-[0.98]",
                isOverlay ? "bg-white shadow-lg border-blue-200 rotate-2 scale-105 opacity-90 z-50 cursor-grabbing !opacity-90" : ""
            )}
            title={task.title}
            onClick={() => onClick?.(task)}
        >
            {/* Drag Handle */}
            <div
                {...dragHandleProps}
                className="mt-0.5 text-gray-300 hover:text-gray-500 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical size={14} />
            </div>

            {/* Checkbox */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle?.(task.id, task.status);
                }}
                className={clsx(
                    "mt-0.5 shrink-0 transition-colors",
                    task.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-green-500"
                )}
            >
                {task.status === 'done' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </button>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className={clsx(
                    "text-sm leading-tight break-words",
                    task.status === 'done' ? "line-through text-gray-400" : "text-gray-900"
                )}>
                    {task.title}
                    {task.score !== undefined && (
                        <span className="ml-1 text-[10px] text-gray-400 font-mono opacity-60">({task.score})</span>
                    )}
                </p>

                {/* Tags & Project Indicator */}
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
