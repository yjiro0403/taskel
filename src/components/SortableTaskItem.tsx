'use client';

import { useSortable } from '@dnd-kit/sortable';
import { useDndContext } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { TaskItem } from './TaskItem';
import { useTaskContext } from '@/contexts/TaskContext';

interface SortableTaskItemProps {
    task: Task;
    schedule?: { start: Date; end: Date } | null;
    isDraggable: boolean;
    canEdit: boolean; // Computed per-task
}

export function SortableTaskItem(props: SortableTaskItemProps) {
    const taskContext = useTaskContext();

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: props.task.id,
        disabled: !props.isDraggable,
        data: {
            type: 'Task',
            task: props.task,
        }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
    };

    const { active, over } = useDndContext();
    const isExternalDrag = active?.data?.current?.type === 'Unscheduled';
    const isOver = over?.id === props.task.id;

    return (
        <TaskItem
            task={props.task}
            schedule={props.schedule}
            isDraggable={props.isDraggable}
            innerRef={setNodeRef}
            style={style}
            isDragging={isDragging}
            dragHandleProps={{ ...attributes, ...listeners }}
            // From Context
            onEdit={taskContext.onEdit}
            canEdit={props.canEdit}
            onToggleSelection={taskContext.onToggleSelection}
            isSelected={taskContext.selectedTaskIds.includes(props.task.id)}
            onPlay={taskContext.onPlay}
            onStop={taskContext.onStop}
            onToggleStatus={taskContext.onToggleStatus}
            onTagClick={taskContext.onTagClick}
            onImageClick={taskContext.onImageClick}
            // Add a visual indicator (top border) when an external item is dragged over this task
            // This indicates insertion BEFORE the current task
            className={isExternalDrag && isOver ? "border-t-4 border-blue-500 transition-all custom-drop-indicator" : ""}
        />
    );
}
