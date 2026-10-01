import { memo, type CSSProperties } from 'react';
import { useDraggable, type DraggableAttributes, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';
import { CheckCircle2, Circle, Square, Play, GripVertical } from 'lucide-react';
import { Task } from '@/types';
import { useIsTaskHighlighted, useIsTaskSelected } from './taskRowFlags';

interface DraggableUnscheduledTaskProps {
    task: Task;
    onEdit?: (task: Task) => void;
    toggleTaskSelection?: (id: string) => void;
    handlePlay?: (task: Task) => void;
    handleStop?: (task: Task) => void;
    projects?: Array<{ id: string; title: string }>;
    isOverlay?: boolean;
}

interface TaskCardContentProps {
    task: Task;
    isSelected: boolean;
    toggleTaskSelection?: (id: string) => void;
    handlePlay?: (task: Task) => void;
    handleStop?: (task: Task) => void;
    projects?: Array<{ id: string; title: string }>;
    onClick?: () => void;
    isOverlay?: boolean;
}

function DraggableUnscheduledTask(props: DraggableUnscheduledTaskProps) {
    if (props.isOverlay) return <UnscheduledTaskSurface {...props} />;
    return <DraggableUnscheduledTaskRow {...props} />;
}

function DraggableUnscheduledTaskRow({
    task, onEdit, toggleTaskSelection, handlePlay, handleStop, projects,
}: DraggableUnscheduledTaskProps) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: task.id,
        data: {
            type: 'Unscheduled',
            task,
        },
    });
    const style = transform ? {
        transform: CSS.Translate.toString(transform),
        touchAction: 'none' as const,
    } : undefined;

    return (
        <UnscheduledTaskSurface
            task={task}
            onEdit={onEdit}
            toggleTaskSelection={toggleTaskSelection}
            handlePlay={handlePlay}
            handleStop={handleStop}
            projects={projects}
            setNodeRef={setNodeRef}
            listeners={listeners}
            attributes={attributes}
            style={style}
        />
    );
}

export default memo(DraggableUnscheduledTask);

function UnscheduledTaskSurface({
    task,
    onEdit,
    toggleTaskSelection,
    handlePlay,
    handleStop,
    projects,
    isOverlay,
    setNodeRef,
    listeners,
    attributes,
    style,
}: DraggableUnscheduledTaskProps & {
    setNodeRef?: (element: HTMLElement | null) => void;
    listeners?: DraggableSyntheticListeners;
    attributes?: DraggableAttributes;
    style?: CSSProperties;
}) {
    const isSelected = useIsTaskSelected(task.id);
    const isHighlighted = useIsTaskHighlighted(task.id);
    const openTask = onEdit ? () => onEdit(task) : undefined;

    return (
        <div
            ref={setNodeRef}
            data-task-id={task.id}
            style={style}
            className={clsx(
                "bg-white rounded-lg p-2 flex items-start gap-2 relative pr-8",
                isOverlay
                    ? "border border-blue-500 shadow-xl mb-2 cursor-grabbing"
                    : "border border-gray-100 shadow-sm hover:shadow-md transition-shadow group",
                !isOverlay && isHighlighted && "ring-2 ring-amber-400 bg-amber-50 shadow-md border-amber-200",
            )}
        >
            <div
                {...listeners}
                {...attributes}
                className={clsx(
                    "absolute right-2 top-2 p-1",
                    isOverlay ? "text-gray-400" : "text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none",
                )}
            >
                <GripVertical size={16} />
            </div>
            <TaskCardContent
                task={task}
                isSelected={isSelected}
                toggleTaskSelection={toggleTaskSelection}
                handlePlay={handlePlay}
                handleStop={handleStop}
                projects={projects}
                onClick={openTask}
                isOverlay={isOverlay}
            />
        </div>
    );
}

function TaskCardContent({ task, isSelected, toggleTaskSelection, handlePlay, handleStop, projects, onClick, isOverlay }: TaskCardContentProps) {
    return (
        <>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    toggleTaskSelection?.(task.id);
                }}
                className="pt-0.5 text-gray-400 hover:text-blue-600 transition-colors shrink-0"
            >
                {isSelected ? (
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
                            {(projects || []).find((project) => project.id === task.projectId)?.title || 'Unknown Project'}
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
                        handleStop?.(task);
                    } else {
                        handlePlay?.(task);
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
