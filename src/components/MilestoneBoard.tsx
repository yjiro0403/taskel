'use client';

import { useMemo } from 'react';
import { Milestone } from '@/types';
import { DndContext, DragEndEvent, closestCorners, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Circle, CheckCircle2, Clock, Calendar, Edit2, Trash2, GripVertical } from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface MilestoneBoardProps {
    milestones: Milestone[];
    onUpdateMilestone: (id: string, updates: Partial<Milestone>) => void;
    onEditMilestone: (milestone: Milestone) => void;
    onDeleteMilestone: (id: string) => void;
    onMilestoneClick: (id: string) => void;
    selectedMilestoneId: string | null;
}

const COLUMNS: { id: Milestone['status']; title: string; color: string; icon: any }[] = [
    { id: 'open', title: 'To Do', color: 'bg-gray-100', icon: Circle },
    { id: 'in_progress', title: 'Doing', color: 'bg-blue-50', icon: Clock },
    { id: 'done', title: 'Done', color: 'bg-green-50', icon: CheckCircle2 },
];

export default function MilestoneBoard({ milestones, onUpdateMilestone, onEditMilestone, onDeleteMilestone, onMilestoneClick, selectedMilestoneId }: MilestoneBoardProps) {

    const sensors = useSensors(
        useSensor(PointerSensor)
    );

    // Group milestones by status
    const groupedMilestones = useMemo(() => {
        const groups: Record<string, Milestone[]> = { open: [], in_progress: [], done: [] };
        milestones.forEach(m => {
            const status = m.status || 'open'; // Default to open if missing
            if (groups[status]) {
                groups[status].push(m);
            } else {
                groups['open'].push(m);
            }
        });
        return groups;
    }, [milestones]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        const milestone = milestones.find(m => m.id === activeId);
        if (!milestone) return;

        let newStatus: Milestone['status'] | null = null;

        if (COLUMNS.some(c => c.id === overId)) {
            newStatus = overId as Milestone['status'];
        } else {
            // Dropped on another milestone
            const overMilestone = milestones.find(m => m.id === overId);
            if (overMilestone) {
                newStatus = overMilestone.status || 'open';
            }
        }

        if (newStatus && newStatus !== milestone.status) {
            onUpdateMilestone(activeId, { status: newStatus });
        }
    };

    return (
        <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCorners} sensors={sensors}>
            <div className="flex gap-4 overflow-x-auto pb-4 min-h-[300px]">
                {COLUMNS.map(col => (
                    <Column
                        key={col.id}
                        column={col}
                        milestones={groupedMilestones[col.id] || []}
                        onEditMilestone={onEditMilestone}
                        onDeleteMilestone={onDeleteMilestone}
                        onMilestoneClick={onMilestoneClick}
                        selectedMilestoneId={selectedMilestoneId}
                    />
                ))}
            </div>
        </DndContext>
    );
}

function Column({ column, milestones, onEditMilestone, onDeleteMilestone, onMilestoneClick, selectedMilestoneId }: {
    column: typeof COLUMNS[0],
    milestones: Milestone[],
    onEditMilestone: (m: Milestone) => void,
    onDeleteMilestone: (id: string) => void,
    onMilestoneClick: (id: string) => void,
    selectedMilestoneId: string | null
}) {
    const { setNodeRef } = useDroppable({
        id: column.id,
    });

    const Icon = column.icon;

    return (
        <div ref={setNodeRef} className={clsx("flex-1 min-w-[280px] flex flex-col rounded-xl border border-gray-200", column.color)}>
            <div className="p-3 border-b border-gray-200/50 flex justify-between items-center bg-white/50 backdrop-blur-sm rounded-t-xl sticky top-0 z-10">
                <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <Icon size={18} className={clsx(
                        column.id === 'done' ? "text-green-600" :
                            column.id === 'in_progress' ? "text-blue-600" : "text-gray-500"
                    )} />
                    {column.title}
                    <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                        {milestones.length}
                    </span>
                </div>
            </div>

            <div className="p-2 flex-1 space-y-2">
                {milestones.map(milestone => (
                    <DraggableMilestone
                        key={milestone.id}
                        milestone={milestone}
                        onEditMilestone={onEditMilestone}
                        onDeleteMilestone={onDeleteMilestone}
                        onMilestoneClick={onMilestoneClick}
                        isSelected={selectedMilestoneId === milestone.id}
                    />
                ))}
                {milestones.length === 0 && (
                    <div className="h-20 border-2 border-dashed border-gray-300/50 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                        No schedules
                    </div>
                )}
            </div>
        </div>
    );
}

function DraggableMilestone({ milestone, onEditMilestone, onDeleteMilestone, onMilestoneClick, isSelected }: {
    milestone: Milestone,
    onEditMilestone: (m: Milestone) => void,
    onDeleteMilestone: (id: string) => void,
    onMilestoneClick: (id: string) => void,
    isSelected: boolean
}) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: milestone.id,
    });

    const style = transform ? {
        transform: CSS.Translate.toString(transform),
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={() => onMilestoneClick(milestone.id)}
            className={clsx(
                "bg-white p-3 rounded-lg shadow-sm border border-gray-200 group hover:shadow-md relative flex flex-col",
                // Only apply transition when NOT dragging to avoid sluggish movement
                !isDragging && "transition-all",
                isDragging && "opacity-50 ring-2 ring-blue-500 z-50",
                milestone.status === 'done' && "opacity-75",
                isSelected ? "ring-2 ring-blue-500 border-blue-500 bg-blue-50" : "cursor-pointer"
            )}
        >
            {/* Drag Handle */}
            <div
                {...listeners}
                {...attributes}
                className="absolute top-2 right-2 p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing hover:bg-gray-50 rounded z-10"
                onClick={(e) => e.stopPropagation()}
            >
                <GripVertical size={14} />
            </div>

            <div className="flex justify-between items-start mb-1 pr-6">
                <h4 className={clsx("text-sm font-medium text-gray-900", milestone.status === 'done' && "line-through text-gray-500")}>
                    {milestone.title}
                </h4>
            </div>

            <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    {(milestone.startDate || milestone.endDate) && (
                        <span className="flex items-center gap-1 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                            <Calendar size={10} />
                            {milestone.startDate ? format(new Date(milestone.startDate), 'M/d') : '?'} - {milestone.endDate ? format(new Date(milestone.endDate), 'M/d') : '?'}
                        </span>
                    )}
                </div>

                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onEditMilestone(milestone); }}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-white rounded z-20"
                    >
                        <Edit2 size={12} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete schedule?')) onDeleteMilestone(milestone.id); }}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-white rounded z-20"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
}
