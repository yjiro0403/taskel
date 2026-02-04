'use client';

import {
    DndContext,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useStore } from '@/store/useStore';
import { generateDisplaySections } from '@/lib/sectionUtils';
import DraggableUnscheduledTask from './RightSidebarDraggableItem';
import { TaskItem } from './TaskItem';
import { useState, useMemo } from 'react';
import { Task } from '@/types';

// Drag activation distance threshold (px) - prevents accidental drags during taps/scrolls
const DRAG_ACTIVATION_DISTANCE = 8;

export default function TasksDnDWrapper({ children }: { children: React.ReactNode }) {
    const {
        tasks,
        sections,
        updateTask,
        currentDate,
        getMergedTasks,
        projects
    } = useStore();

    const [activeId, setActiveId] = useState<string | null>(null);

    // Helper function to find task by ID in merged or global tasks
    const findTaskById = (id: string, mergedTasks: Task[]): Task | undefined => {
        return mergedTasks.find(t => String(t.id) === String(id))
            || tasks.find(t => String(t.id) === String(id));
    };

    // DnD Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: DRAG_ACTIVATION_DISTANCE,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const id = String(event.active.id);
        setActiveId(id);
    };

    // --- Drag and Drop Logic (Moved from TaskList) ---
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) {
            return;
        }
        if (active.id === over.id) {
            return;
        }

        const mergedTasks = getMergedTasks(currentDate);

        // Use helper function for cleaner task lookup
        const activeTask = findTaskById(String(active.id), mergedTasks);
        const overTask = findTaskById(String(over.id), mergedTasks);

        if (!activeTask) {
            return;
        }

        const getTasksBySection = (sectionId: string) => {
            return mergedTasks
                .filter(t => t.sectionId === sectionId)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
        };

        const displaySections = generateDisplaySections(sections);

        // Case 1: Dropped over another Task
        if (overTask) {
            const newSectionId = overTask.sectionId;
            const isSameSection = activeTask.sectionId === newSectionId;
            const sectionTasks = getTasksBySection(newSectionId);

            // Find indices in sorted order
            const activeIndex = sectionTasks.findIndex(t => t.id === activeTask.id);
            const overIndex = sectionTasks.findIndex(t => t.id === overTask.id);

            let newOrder: number;

            if (isSameSection && activeIndex !== -1 && overIndex !== -1) {
                // Same section reordering
                // Determine if moving up or down
                if (activeIndex < overIndex) {
                    // Moving down: place after overTask
                    const nextTask = sectionTasks[overIndex + 1];
                    if (nextTask) {
                        newOrder = (overTask.order + nextTask.order) / 2;
                    } else {
                        newOrder = overTask.order + 1;
                    }
                } else {
                    // Moving up: place before overTask
                    const prevTask = sectionTasks[overIndex - 1];
                    if (prevTask) {
                        newOrder = (prevTask.order + overTask.order) / 2;
                    } else {
                        newOrder = overTask.order - 1;
                    }
                }
            } else {
                // Cross-section move: insert before overTask
                const overIdx = sectionTasks.findIndex(t => t.id === overTask.id);
                if (overIdx > 0) {
                    const prevTask = sectionTasks[overIdx - 1];
                    newOrder = (prevTask.order + overTask.order) / 2;
                } else {
                    newOrder = overTask.order - 1;
                }
            }

            updateTask(String(active.id), {
                sectionId: newSectionId,
                order: newOrder,
                date: currentDate
            });
            return;
        }

        // Case 2: Dropped into a Section (empty section or section drop zone)
        const sectionIdMatch = displaySections.find(s => s.id === over.id);
        if (sectionIdMatch) {
            const targetTasks = getTasksBySection(sectionIdMatch.id);
            const maxOrder = targetTasks.length > 0 ? Math.max(...targetTasks.map(t => t.order)) : 0;
            updateTask(String(active.id), {
                sectionId: sectionIdMatch.id,
                order: maxOrder + 1,
                date: currentDate
            });
        }
    };

    // Memoize activeTask to avoid recalculating on every render
    const activeTask = useMemo(() => {
        if (!activeId) return null;
        const merged = getMergedTasks(currentDate);
        return findTaskById(activeId, merged);
    }, [activeId, currentDate, tasks, getMergedTasks]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            {children}
            <DragOverlay dropAnimation={{
                duration: 250,
                easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            }} className="z-[100]">
                {activeTask ? (
                    !activeTask.sectionId ? (
                        <DraggableUnscheduledTask
                            task={activeTask}
                            selectedTaskIds={[]}
                            toggleTaskSelection={() => { }}
                            handlePlay={() => { }}
                            handleStop={() => { }}
                            projects={projects}
                            isOverlay={true}
                        />
                    ) : (
                        <div className="pointer-events-none">
                            <TaskItem
                                task={activeTask}
                                schedule={undefined}
                                isDraggable={false}
                                onEdit={() => { }}
                                canEdit={true}
                                onToggleSelection={() => { }}
                                isSelected={false}
                                onPlay={() => { }}
                                onStop={() => { }}
                                onToggleStatus={() => { }}
                                onTagClick={() => { }}
                                onImageClick={() => { }}
                                isOverlay={true}
                            />
                        </div>
                    )
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
