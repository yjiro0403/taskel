import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { CheckCircle2, Circle, Square, Play, GripVertical } from 'lucide-react';
import { Task } from '@/types';

interface DraggableUnscheduledTaskProps {
    task: Task;
    onClick?: () => void;
    selectedTaskIds?: string[];
    toggleTaskSelection?: (id: string) => void;
    handlePlay?: (task: Task) => void;
    handleStop?: (task: Task) => void;
    projects?: Array<{ id: string; title: string }>;
    isOverlay?: boolean;
}

interface TaskCardContentProps {
    task: Task;
    selectedTaskIds?: string[];
    toggleTaskSelection?: (id: string) => void;
    handlePlay?: (task: Task) => void;
    handleStop?: (task: Task) => void;
    projects?: Array<{ id: string; title: string }>;
    onClick?: () => void;
    isOverlay?: boolean;
}

export default function DraggableUnscheduledTask({
    task, onClick, selectedTaskIds, toggleTaskSelection, handlePlay, handleStop, projects, isOverlay
}: DraggableUnscheduledTaskProps) {
    const { attributes, listeners, setNodeRef, transform } = !isOverlay ? useDraggable({
        id: task.id,
        data: {
            type: 'Unscheduled',
            task
        }
    }) : { attributes: {}, listeners: {}, setNodeRef: null, transform: null };

    const style = transform ? {
        transform: CSS.Translate.toString(transform),
        touchAction: 'none'
    } : undefined;

    if (isOverlay) {
        return (
            <div
                className="bg-white border border-blue-500 rounded-lg p-2 shadow-xl mb-2 flex items-start gap-2 relative pr-8 cursor-grabbing"
            >
                {/* Drag Handle (Visual only) */}
                <div className="absolute right-2 top-2 p-1 text-gray-400">
                    <GripVertical size={16} />
                </div>
                <TaskCardContent
                    task={task}
                    selectedTaskIds={selectedTaskIds || []}
                    projects={projects}
                    onClick={onClick}
                    toggleTaskSelection={toggleTaskSelection}
                    handlePlay={handlePlay}
                    handleStop={handleStop}
                    isOverlay={true}
                />
            </div>
        )
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={clsx(
                "bg-white border border-gray-100 rounded-lg p-2 shadow-sm hover:shadow-md transition-shadow group mb-2 flex items-start gap-2 relative pr-8",

            )}
        >
            {/* Drag Handle */}
            <div
                {...listeners}
                {...attributes}
                className="absolute right-2 top-2 p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
            >
                <GripVertical size={16} />
            </div>

            <TaskCardContent
                task={task}
                selectedTaskIds={selectedTaskIds}
                toggleTaskSelection={toggleTaskSelection}
                handlePlay={handlePlay}
                handleStop={handleStop}
                projects={projects}
                onClick={onClick}
            />
        </div>
    );
}

function TaskCardContent({ task, selectedTaskIds, toggleTaskSelection, handlePlay, handleStop, projects, onClick, isOverlay }: TaskCardContentProps) {
    return (
        <>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    toggleTaskSelection && toggleTaskSelection(task.id);
                }}
                className="pt-0.5 text-gray-400 hover:text-blue-600 transition-colors shrink-0"
            >
                {selectedTaskIds && selectedTaskIds.includes(task.id) ? (
                    <CheckCircle2 size={16} className="text-blue-600" />
                ) : (
                    <Circle size={16} />
                )}
            </button>

            <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={onClick}
            >
                <h3 className="text-sm font-medium text-gray-800 break-words mb-1 pr-4">
                    {task.title}
                </h3>
                {task.tags && task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                        {task.tags.map((tag: string) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{task.estimatedMinutes} min</span>
                    {task.score !== undefined && (
                        <span className="text-gray-500 font-mono" title="Score">Sc: {task.score}</span>
                    )}
                    {task.projectId && (
                        <span className="flex items-center gap-1 bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                            {(projects || []).find((p) => p.id === task.projectId)?.title || 'Unknown Project'}
                        </span>
                    )}
                    {task.status === 'in_progress' && (
                        <span className="text-blue-600 font-semibold animate-pulse">Running</span>
                    )}
                </div>
            </div>

            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (task.status === 'in_progress') {
                        handleStop && handleStop(task);
                    } else {
                        handlePlay && handlePlay(task);
                    }
                }}
                className={clsx(
                    "p-1 rounded hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100 shrink-0",
                    task.status === 'in_progress' ? "text-blue-600 opacity-100" : "text-gray-400",
                    isOverlay ? "opacity-100" : ""
                )}
            >
                {task.status === 'in_progress' ? <Square size={16} fill="currentColor" /> : <Play size={16} />}
            </button>
        </>
    );
}
