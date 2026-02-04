import { Task, Project } from '@/types';
import { clsx } from 'clsx';
import { CheckCircle2, Circle, GripVertical, Plus } from 'lucide-react';

interface GoalItemProps {
    task: Task;
    project?: Project;
    onToggle?: (id: string, current: string) => void;
    onDelete?: (id: string) => void;
    onClick?: (task: Task) => void;
    isDragging?: boolean;
    dragHandleProps?: any; // For dnd-kit listeners
    isOverlay?: boolean;
}

export default function GoalItem({
    task,
    project,
    onToggle,
    onDelete,
    onClick,
    isDragging,
    dragHandleProps,
    isOverlay
}: GoalItemProps) {
    return (
        <div
            className={clsx(
                "group flex items-center gap-2 p-2 bg-white rounded-lg border shadow-sm transition-all cursor-pointer",
                isDragging ? "opacity-50 border-blue-300 pointer-events-none" : "border-gray-100 hover:border-gray-200 hover:shadow-md",
                isOverlay && "shadow-xl border-blue-500 cursor-grabbing opacity-90 scale-105 rotate-1 pointer-events-none"
            )}
            onClick={() => onClick?.(task)}
        >
            <div
                {...dragHandleProps}
                className={clsx(
                    "cursor-grab text-gray-300 hover:text-gray-500",
                    isOverlay && "cursor-grabbing"
                )}
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical size={16} />
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle?.(task.id, task.status);
                }}
                className={clsx(
                    "transition-colors",
                    task.status === 'done' ? "text-green-500" : "text-gray-300 hover:text-gray-400"
                )}
            >
                {task.status === 'done' ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </button>

            <div className="flex-1 min-w-0">
                <div className={clsx("text-sm text-gray-700 truncate", task.status === 'done' && "line-through text-gray-400")}>
                    {task.title}
                </div>
                <div className="flex items-center gap-2">
                    {project && (
                        <div className="text-xs text-blue-600 truncate opacity-75">
                            {project.title}
                        </div>
                    )}
                    {task.score !== undefined && (
                        <div className="text-[10px] text-gray-400 font-mono" title="Score">
                            Sc: {task.score}
                        </div>
                    )}
                    {task.tags?.map(tag => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">#{tag}</span>
                    ))}
                </div>
            </div>

            {onDelete && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(task.id);
                    }}
                    className={clsx(
                        "transition-opacity text-gray-300 hover:text-red-500",
                        isOverlay ? "opacity-100" : "opacity-0 group-hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                    )}
                >
                    <Plus size={16} className="rotate-45" />
                </button>
            )}
        </div>
    );
}
