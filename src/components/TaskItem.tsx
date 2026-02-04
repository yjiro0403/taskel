'use client';

import { Task } from '@/types';
import clsx from 'clsx';
import { Play, Square, Circle, CheckCircle2, Check, Copy, GripVertical } from 'lucide-react';
import { formatTime } from '@/lib/timeUtils';
import { addMinutes } from 'date-fns';
import { useStore } from '@/store/useStore';
import { CSSProperties } from 'react';

export interface TaskItemProps {
    task: Task;
    schedule?: { start: Date; end: Date } | null;
    isDraggable: boolean;
    isDragging?: boolean;
    dragHandleProps?: any;
    innerRef?: (node: HTMLElement | null) => void;
    style?: CSSProperties;
    onEdit: (task: Task) => void;
    canEdit: boolean;
    onToggleSelection: (id: string) => void;
    isSelected: boolean;
    onPlay: (task: Task) => void;
    onStop: (task: Task) => void;
    onToggleStatus: (task: Task) => void;
    onTagClick: (tagId: string) => void;
    onImageClick: (url: string) => void;
    isOverlay?: boolean;
    className?: string;
}

export function TaskItem({
    task,
    schedule,
    isDraggable,
    isDragging,
    dragHandleProps,
    innerRef,
    style,
    onEdit,
    canEdit,
    onToggleSelection,
    isSelected,
    onPlay,
    onStop,
    onToggleStatus,
    onTagClick,
    onImageClick,
    isOverlay,
    className
}: TaskItemProps) {
    const { projects, tags } = useStore();

    return (
        <div
            ref={innerRef}
            style={style}
            className={clsx(
                "group flex items-center p-3 transition-colors bg-white",
                !isOverlay && "hover:bg-gray-50",
                task.status === 'done' && "bg-gray-50/50",
                // When dragging (original item): keep it visible but dims it slightly and add dashed border
                isDragging && "opacity-40 border-2 border-dashed border-gray-300 bg-gray-50/50",
                // Overlay item: fully opaque, elevated, and styled
                isOverlay && "opacity-100 shadow-2xl rounded-lg ring-2 ring-blue-500 cursor-grabbing bg-white scale-[1.02] z-50",
                className
            )}
        >
            {/* Drag Handle */}
            <div
                className={clsx(
                    "mr-2 text-gray-300 flex items-center justify-center rounded",
                    !isOverlay && "cursor-grab active:cursor-grabbing hover:bg-gray-100",
                    !isDraggable && !isOverlay && "invisible pointer-events-none",
                    // Accessibility focus styles
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:bg-blue-50",
                    // Mobile: prevent scroll on drag handle
                    "touch-none"
                )}
                tabIndex={isDraggable && !isOverlay ? 0 : undefined}
                role="button"
                aria-label="Drag handle. Press space to lift."
                {...dragHandleProps}
            >
                <GripVertical size={20} />
            </div>

            {/* Controls */}
            <div className="mr-4 flex gap-2" onPointerDown={(e) => e.stopPropagation()}>
                <button
                    onClick={() => onToggleSelection(task.id)}
                    disabled={!canEdit}
                    className={clsx("transition-colors", !canEdit ? "opacity-30 cursor-not-allowed" : "text-gray-400 hover:text-blue-600")}
                >
                    {isSelected ? (
                        <CheckCircle2 size={20} className="text-blue-600" />
                    ) : (
                        <Circle size={20} />
                    )}
                </button>
                <button
                    onClick={() => {
                        if (task.status === 'in_progress') onToggleStatus(task);
                        else if (task.status !== 'done') onPlay(task);
                    }}
                    disabled={task.status === 'done' || !canEdit}
                    className={clsx(
                        "transition-colors tour-play-btn",
                        !canEdit && "opacity-30 cursor-not-allowed",
                        task.status === 'in_progress' ? "text-blue-600" :
                            task.status === 'done' ? "text-gray-300" : "text-gray-300 hover:text-blue-600"
                    )}
                >
                    {task.status === 'in_progress' ? <Square size={20} fill="currentColor" /> :
                        task.status === 'done' ? <Check size={20} /> : <Play size={20} />}
                </button>
            </div>

            {/* Task Content */}
            <div
                className={clsx(
                    "flex-1 min-w-0",
                    canEdit && !isOverlay ? "cursor-pointer" : "cursor-default"
                )}
                onClick={() => canEdit && !isOverlay && onEdit(task)}
            >
                <h3 className={clsx(
                    "text-sm font-medium truncate mb-1",
                    task.status === 'done' ? "text-gray-400 line-through" : "text-gray-900"
                )}>
                    {task.title}
                </h3>
                {((task.tags && task.tags.length > 0) || task.projectId) && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {task.projectId && (
                            <span className={clsx(
                                "px-2 py-0.5 text-[10px] rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 flex items-center gap-1",
                                !isOverlay && "cursor-pointer hover:bg-indigo-100"
                            )}>
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                                {projects.find(p => p.id === task.projectId)?.title || 'Unknown Project'}
                            </span>
                        )}
                        {task.tags && task.tags.map(tagName => {
                            const tagObj = tags.find(t => t.name === tagName);
                            return (
                                <span
                                    key={tagName}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (tagObj && !isOverlay) onTagClick(tagObj.id);
                                    }}
                                    className={clsx(
                                        "px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full border border-gray-200",
                                        tagObj && !isOverlay && "cursor-pointer hover:bg-gray-200 hover:border-gray-300"
                                    )}
                                >
                                    {tagName}
                                </span>
                            );
                        })}
                    </div>
                )}
                {task.attachments && task.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {task.attachments.map(att => (
                            <div
                                key={att.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isOverlay) onImageClick(att.url);
                                }}
                                className="relative w-16 h-16 rounded-md overflow-hidden border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                            >
                                <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex text-xs text-gray-500 gap-3 items-center mt-1">
                    <span>Min: {task.estimatedMinutes}</span>
                    <span className="font-mono text-blue-600">Act: {task.actualMinutes ? task.actualMinutes.toFixed(1) : 0}</span>
                    {task.score !== undefined && (
                        <span className="text-gray-500" title="Score">Sc: {task.score}</span>
                    )}
                    {task.externalLink && (
                        <a
                            href={task.externalLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className={clsx(
                                "text-gray-400 transition-colors",
                                !isOverlay && "hover:text-blue-600"
                            )}
                            title="Open in Google Calendar"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        </a>
                    )}
                </div>
            </div>

            {/* Time Display */}
            <div className="ml-4 flex items-center gap-3 font-mono text-xs">
                {canEdit && !isOverlay && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            useStore.getState().duplicateTask(task.id);
                        }}
                        className="text-gray-300 hover:text-blue-600 transition-colors"
                        title="Duplicate Task"
                        onPointerDown={(e) => e.stopPropagation()} // Prevent drag
                    >
                        <Copy size={16} />
                    </button>
                )}
                <div className="flex flex-col items-end">
                    {task.status === 'done' && task.completedAt ? (
                        <>
                            <span className="text-gray-400">
                                {formatTime(addMinutes(new Date(task.completedAt), -task.actualMinutes))}
                            </span>
                            <span className="text-gray-400 font-medium">⬇</span>
                            <span className="text-gray-400">
                                {formatTime(new Date(task.completedAt))}
                            </span>
                        </>
                    ) : schedule && task.status !== 'done' ? (
                        !task.scheduledStart && task.status === 'open' ? (
                            <span className="text-gray-300">--:--</span>
                        ) : (
                            <>
                                <span className="text-gray-400">{formatTime(schedule.start)}</span>
                                <span className="text-gray-800 font-medium">⬇</span>
                                <span className="text-gray-800">{formatTime(schedule.end)}</span>
                            </>
                        )
                    ) : (
                        <span className="text-gray-300">--:--</span>
                    )}
                </div>
            </div>
        </div>
    );
}
