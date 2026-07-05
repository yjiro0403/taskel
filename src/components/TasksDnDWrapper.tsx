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
    arrayMove,
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
        reorderTasks,
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

    // 表示順（セクション内）のソート。TaskList.compareTasks と同一ロジック。
    const sortSectionForDisplay = (list: Task[]): Task[] => {
        const hasSchedule = (t: Task) => !!t.scheduledStart && t.scheduledStart.trim() !== '';
        const statusRank = (t: Task) => {
            if (t.status === 'done') return 0;
            if (t.status === 'in_progress') return 1;
            return 2;
        };
        return [...list].sort((a, b) => {
            const rd = statusRank(a) - statusRank(b);
            if (rd !== 0) return rd;
            const hasA = hasSchedule(a);
            const hasB = hasSchedule(b);
            if (hasA && hasB) {
                const tc = a.scheduledStart!.localeCompare(b.scheduledStart!);
                if (tc !== 0) return tc;
            }
            if (hasA && !hasB) return -1;
            if (!hasA && hasB) return 1;
            return (a.order ?? 0) - (b.order ?? 0);
        });
    };

    const handleDragStart = (event: DragStartEvent) => {
        const id = String(event.active.id);
        setActiveId(id);
    };

    // --- Drag and Drop Logic (Moved from TaskList) ---
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;
        if (active.id === over.id) return;

        const mergedTasks = getMergedTasks(currentDate);
        const activeTask = findTaskById(String(active.id), mergedTasks);
        const overTask = findTaskById(String(over.id), mergedTasks);

        if (!activeTask) return;

        const displaySections = generateDisplaySections(sections);

        // Case 1: 別タスクの上にドロップ（並び替え or セクション移動）
        if (overTask) {
            const newSectionId = overTask.sectionId;
            const isSameSection = activeTask.sectionId === newSectionId;

            // 1) セクション移動 or 仮想タスクの実体化が必要なら先に確定（await して順序を保証）
            if (!isSameSection || activeTask.isVirtual) {
                await updateTask(String(active.id), { sectionId: newSectionId, date: currentDate });
            }

            // 2) 最新の表示順を再計算し、arrayMove で目標の並びを作る。
            //    従来は表示順（status/時刻優先で order 非単調）から中点を計算していたため、
            //    挿入位置が区間外に飛んでスナップバックしていた（本修正で解消）。
            const freshMerged = getMergedTasks(currentDate);
            const freshSection = sortSectionForDisplay(
                freshMerged.filter(t => t.sectionId === newSectionId)
            );
            const ids = freshSection.map(t => t.id);
            const fromIdx = ids.indexOf(String(active.id));
            const toIdx = ids.indexOf(String(over.id));
            if (fromIdx === -1 || toIdx === -1) return;
            const newOrderIds = arrayMove(ids, fromIdx, toIdx);

            // 3) 実タスク（純粋仮想を除く。実体化済みルーチンは含む）のみ 0..n に再採番。
            //    整数連番のため精度枯渇も起きない。
            const virtualIds = new Set(freshSection.filter(t => t.isVirtual).map(t => t.id));
            const realIds = newOrderIds.filter(id => !virtualIds.has(id));
            if (realIds.length > 0) {
                await reorderTasks(realIds);
            }
            return;
        }

        // Case 2: セクション枠（空セクション/ドロップゾーン）にドロップ → 末尾へ移動
        const sectionIdMatch = displaySections.find(s => s.id === over.id);
        if (sectionIdMatch) {
            const targetTasks = mergedTasks.filter(t => t.sectionId === sectionIdMatch.id);
            const maxOrder = targetTasks.length > 0 ? Math.max(...targetTasks.map(t => t.order ?? 0)) : 0;
            await updateTask(String(active.id), {
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
