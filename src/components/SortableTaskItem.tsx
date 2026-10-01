'use client';

import { memo, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task } from '@/types';
import { TaskItem } from './TaskItem';
import { useTaskContext } from '@/contexts/TaskContext';
import { useIsExternalDragOver } from './dndDragOver';
import { useIsTaskHighlighted, useIsTaskSelected } from './taskRowFlags';

interface SortableTaskItemProps {
    task: Task;
    schedule?: { start: Date; end: Date } | null;
    isDraggable: boolean;
    canEdit: boolean;
}

export const SortableTaskItem = memo(function SortableTaskItem(props: SortableTaskItemProps) {
    const taskContext = useTaskContext();
    const isSelected = useIsTaskSelected(props.task.id);
    const isHighlighted = useIsTaskHighlighted(props.task.id);
    const isDropBefore = useIsExternalDragOver(props.task.id);

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

    const style = useMemo(() => ({
        transform: CSS.Translate.toString(transform),
        transition,
    }), [transform, transition]);

    return (
        <TaskItem
            task={props.task}
            schedule={props.schedule}
            isDraggable={props.isDraggable}
            innerRef={setNodeRef}
            style={style}
            isDragging={isDragging}
            dragHandleProps={{ ...attributes, ...listeners }}
            onEdit={taskContext.onEdit}
            canEdit={props.canEdit}
            onToggleSelection={taskContext.onToggleSelection}
            isSelected={isSelected}
            onPlay={taskContext.onPlay}
            onStop={taskContext.onStop}
            onToggleStatus={taskContext.onToggleStatus}
            onTagClick={taskContext.onTagClick}
            onImageClick={taskContext.onImageClick}
            isHighlighted={isHighlighted}
            className={isDropBefore ? "border-t-4 border-blue-500 transition-all custom-drop-indicator" : ""}
        />
    );
});
