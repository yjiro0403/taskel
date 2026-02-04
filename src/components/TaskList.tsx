'use client';

import { useStore } from '@/store/useStore';
import { Task, Section } from '@/types';
import { Play, Square, Circle, CheckCircle2, Check, Copy, X, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { calculateTaskSchedule, formatTime } from '@/lib/timeUtils';
import { useEffect, useState, useMemo } from 'react';
import { addMinutes } from 'date-fns';
import { INTERVAL_SECTION_PREFIX, isIntervalSection, generateDisplaySections, getSectionForTime } from '@/lib/sectionUtils';

import AddTaskModal from './AddTaskModal';
import TagModal from './TagModal';
import DateNavigation from './DateNavigation';
import Link from 'next/link';
import DailyGoalList from './DailyGoalList';
import { SortableTaskItem } from './SortableTaskItem';
import { TaskContextProvider } from '@/contexts/TaskContext';

// DnD Imports
// DnD Imports removed (lifted to wrapper), but useDroppable is needed for SectionContainer
import { useDroppable, useDndContext } from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';

export default function TaskList() {
    const { tasks, sections, updateTask, currentTime, setCurrentTime, selectedTaskIds, toggleTaskSelection, currentDate, syncGoogleCalendar, user, tags, projects, getMergedTasks } = useStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    // DnD Sensors
    // DnD Sensors removed (lifted to wrapper)

    const handleSync = async () => {
        if (!user) return;
        setIsSyncing(true);

        try {
            const { googleProvider, auth } = await import('@/lib/firebase');
            const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');

            // Force re-consent
            googleProvider.setCustomParameters({ prompt: 'consent' });

            const result = await signInWithPopup(auth, googleProvider);
            const credential = GoogleAuthProvider.credentialFromResult(result);
            const accessToken = credential?.accessToken;

            if (accessToken) {
                await syncGoogleCalendar(accessToken, currentDate);
            } else {
                alert("Could not get access token.");
            }
        } catch (e) {
            console.error("Sync failed", e);
            alert("Sync failed. Check console.");
        } finally {
            setIsSyncing(false);
        }
    };

    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingTask(null);
    };

    // Update current time every minute
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, [setCurrentTime]);

    const displaySections = useMemo(() => {
        return generateDisplaySections(sections);
    }, [sections]);

    const filteredTasks = useMemo(() => {
        return getMergedTasks(currentDate);
    }, [getMergedTasks, currentDate, tasks]);

    const dailyGoals = useMemo(() => {
        return tasks.filter(t => t.assignedDate === currentDate && !t.date).sort((a, b) => a.order - b.order);
    }, [tasks, currentDate]);

    const compareTasks = (a: Task, b: Task) => {
        // Priority Order: Done (Top) > In Progress > Open (Bottom)
        const getRank = (t: Task) => {
            if (t.status === 'done') return 0;
            if (t.status === 'in_progress') return 1;
            return 2;
        };

        const rankA = getRank(a);
        const rankB = getRank(b);

        if (rankA !== rankB) {
            return rankA - rankB; // 0 < 1 < 2
        }

        // Helper to check if a task has a valid scheduled time
        const hasScheduleA = !!a.scheduledStart && a.scheduledStart.trim() !== '';
        const hasScheduleB = !!b.scheduledStart && b.scheduledStart.trim() !== '';

        // 1. Sort by Scheduled Start Time (if both have it)
        if (hasScheduleA && hasScheduleB) {
            const timeCompare = a.scheduledStart!.localeCompare(b.scheduledStart!);
            if (timeCompare !== 0) return timeCompare;
        }

        // 2. Otherwise, trust the Order (User's manual sort)
        if (a.order !== b.order) {
            return a.order - b.order;
        }

        // 3. Tiebreaker: Unscheduled tasks come BEFORE Scheduled tasks
        if (hasScheduleA && !hasScheduleB) return 1;
        if (!hasScheduleA && hasScheduleB) return -1;
        return 0;
    };

    const getSortedTasks = () => {
        let allTasks: Task[] = [];
        displaySections.forEach(section => {
            const sectionTasks = filteredTasks
                .filter(t => t.sectionId === section.id)
                .sort(compareTasks);
            allTasks = [...allTasks, ...sectionTasks];
        });
        return allTasks;
    };

    const globalSchedule = calculateTaskSchedule(getSortedTasks(), currentTime);

    // VISUAL SORTING LOGIC
    // VISUAL SORTING LOGIC REMOVED: Now unified with compareTasks order-based logic.

    const getTasksBySection = (sectionId: string) => {
        const sectionTasks = filteredTasks
            .filter((task) => task.sectionId === sectionId);
        // UNIFIED SORT: Use 'compareTasks' (order-based) instead of 'compareTasksByTime'.
        // This ensures that the visual order matches the draggable 'order' property.
        // Scheduled tasks are handled by the tie-breaker in 'compareTasks'.
        return sectionTasks.sort(compareTasks);
    };

    const canEditTask = (task: Task) => {
        if (!user) return false;
        if (!task.projectId) return true;

        const project = projects.find(p => p.id === task.projectId);
        if (!project) return false;

        if (project.ownerId === user.uid) return true;

        const role = project.roles?.[user.uid] || 'member';
        return role !== 'viewer';
    };

    const handlePlay = (task: Task) => {
        if (task.status === 'in_progress') return;

        const now = new Date();
        const currentSectionId = getSectionForTime(sections, now);

        updateTask(task.id, {
            status: 'in_progress',
            startedAt: now.getTime(),
            sectionId: currentSectionId
        });
    };

    const handleStop = (task: Task) => {
        if (task.status !== 'in_progress' || !task.startedAt) return;

        const now = Date.now();
        const elapsedMinutes = (now - task.startedAt) / 60000;

        updateTask(task.id, {
            status: 'open',
            startedAt: undefined,
            actualMinutes: (task.actualMinutes || 0) + elapsedMinutes
        });
    };

    const handleStatusToggle = (task: Task) => {
        if (task.status === 'in_progress' && task.startedAt) {
            const now = Date.now();
            const elapsedMinutes = (now - task.startedAt) / 60000;

            updateTask(task.id, {
                status: 'done',
                startedAt: undefined,
                actualMinutes: (task.actualMinutes || 0) + elapsedMinutes,
                completedAt: now
            });
            return;
        }

        const newStatus = task.status === 'done' ? 'open' : 'done';
        updateTask(task.id, {
            status: newStatus,
            completedAt: newStatus === 'done' ? Date.now() : undefined
        });
    };

    const getSectionEndTime = (sectionId: string) => {
        const sectionTasks = getTasksBySection(sectionId);
        if (sectionTasks.length === 0) return null;

        for (let i = sectionTasks.length - 1; i >= 0; i--) {
            const task = sectionTasks[i];
            const slot = globalSchedule.get(task.id);
            if (slot) return slot.end;
        }
        return null;
    };

    // --- Drag and Drop Logic ---

    const taskContextValue = {
        onEdit: handleEditTask,
        canEdit: true, // Will be computed per-task using canEditTask
        onToggleSelection: toggleTaskSelection,
        onPlay: handlePlay,
        onStop: handleStop,
        onToggleStatus: handleStatusToggle,
        onTagClick: (tagId: string) => setSelectedTagId(tagId),
        onImageClick: (url: string) => setLightboxImage(url),
        selectedTaskIds,
        projects,
        tags,
    };

    return (
        <TaskContextProvider value={taskContextValue}>
            <div id="tour-task-list" className="flex flex-col gap-6 max-w-4xl mx-auto p-4">
                <div className="flex justify-between items-center">
                    <DateNavigation />
                    <div className="flex gap-2">
                        <Link
                            href="/calendar"
                            className="p-2 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center"
                            title="Calendar View"
                        >
                            <Calendar size={18} />
                        </Link>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            className="text-sm bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                        >
                            {isSyncing ? "Syncing..." : "Sync Google Calendar"}
                        </button>
                    </div>
                </div>

                {/* Daily Goals */}
                <DailyGoalList date={currentDate} goals={dailyGoals} />

                {displaySections.map((section, idx) => {
                    const taskSectionEndTime = getSectionEndTime(section.id);
                    const isInterval = isIntervalSection(section.id);

                    // Calculate section end time
                    const nextStartTime = idx < displaySections.length - 1 ? displaySections[idx + 1].startTime : '24:00';
                    const sectionEndTime = section.endTime || nextStartTime;

                    const sectionTasks = getTasksBySection(section.id);
                    // Pass ALL tasks to SortableContext so dnd-kit can calculate indexes correctly
                    // relative to both scheduled and unscheduled tasks.
                    const sectionTaskIds = sectionTasks.map(t => t.id);

                    return (
                        <SortableContext
                            key={section.id}
                            id={section.id}
                            items={sectionTaskIds}
                            strategy={verticalListSortingStrategy}
                        >
                            <SectionContainer
                                section={section}
                                isInterval={isInterval}
                                sectionEndTime={sectionEndTime}
                                taskSectionEndTime={taskSectionEndTime}
                                tasks={sectionTasks}
                                canEditTask={canEditTask}
                                globalSchedule={globalSchedule}
                            />
                        </SortableContext>
                    );
                })}

                <AddTaskModal
                    isOpen={isModalOpen}
                    onClose={handleCloseModal}
                    taskToEdit={editingTask}
                />
                <TagModal
                    isOpen={!!selectedTagId}
                    onClose={() => setSelectedTagId(null)}
                    tagId={selectedTagId}
                />

                {/* Lightbox */}
                {
                    lightboxImage && (
                        <div
                            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-pointer animate-in fade-in duration-200"
                            onClick={() => setLightboxImage(null)}
                        >
                            <button
                                className="absolute top-4 right-4 text-white hover:text-gray-300 pointer-events-none"
                            >
                                <X size={32} />
                            </button>
                            <img
                                src={lightboxImage}
                                alt="Lightbox"
                                className="max-w-full max-h-full object-contain rounded-sm shadow-2xl"
                            />
                        </div>
                    )
                }
            </div>
        </TaskContextProvider>
    );
}

function SectionContainer({
    section, isInterval, sectionEndTime, taskSectionEndTime, tasks,
    canEditTask, globalSchedule
}: any) {
    const { setNodeRef } = useDroppable({
        id: section.id,
    });

    return (
        <div
            ref={setNodeRef}
            className={clsx(
                "rounded-lg shadow-sm border overflow-hidden mb-6",
                isInterval ? "bg-gray-100 border-gray-200" : "bg-white border-gray-200"
            )}
        >
            <div className={clsx(
                "px-4 py-2 border-b flex justify-between items-center",
                isInterval ? "bg-gray-200 border-gray-300" : "bg-gray-50 border-gray-200"
            )}>
                <div className="flex items-center gap-3">
                    <h2 className={clsx("font-semibold", isInterval ? "text-gray-500 italic" : "text-gray-700")}>
                        {section.name} {section.startTime && <span className="text-sm font-normal text-gray-500 ml-2">({section.startTime} - {sectionEndTime})</span>}
                    </h2>
                    {taskSectionEndTime && (
                        <span className="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                            End: {formatTime(taskSectionEndTime)}
                        </span>
                    )}
                </div>
                <span className="text-xs text-gray-400">
                    {tasks.length} tasks
                </span>
            </div>

            <div className="divide-y divide-gray-100 min-h-[50px]">
                {tasks.map((task: any) => {
                    const schedule = globalSchedule.get(task.id);
                    const isUnscheduled = !task.scheduledStart;
                    const isSortable = isUnscheduled && task.status === 'open';

                    return (
                        <SortableTaskItem
                            key={task.id}
                            task={task}
                            schedule={schedule}
                            isDraggable={isSortable}
                            canEdit={canEditTask(task)}
                        />
                    );
                })}

                {tasks.length === 0 && (
                    <div className="p-8 text-center text-gray-400 text-sm italic">
                        No tasks in this section
                    </div>
                )}
            </div>

            {/* Bottom Drop Zone Indicator */}
            {(() => {
                // eslint-disable-next-line react-hooks/rules-of-hooks
                const { active, over } = useDndContext();
                const isOverSection = over?.id === section.id && active?.id !== over?.id;

                return (
                    <div className={clsx(
                        "transition-all duration-200 mx-2 mb-2 rounded border-2 border-dashed flex items-center justify-center text-sm font-medium",
                        isOverSection
                            ? "h-12 bg-blue-50 border-blue-400 text-blue-600 opacity-100"
                            : "h-2 border-transparent text-transparent opacity-0"
                    )}>
                        {isOverSection && "Drop here to add to end"}
                    </div>
                );
            })()}
        </div>
    );
}
