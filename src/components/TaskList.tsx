'use client';

import { useStore } from '@/store/useStore';
import { Task, Section } from '@/types';
import { Play, Square, Circle, CheckCircle2, Check, Copy, X, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { calculateTaskSchedule, formatTime, type TimeSlot } from '@/lib/timeUtils';
import { useEffect, useState, useMemo, useRef } from 'react';
import { addMinutes } from 'date-fns';
import { INTERVAL_SECTION_PREFIX, isIntervalSection, generateDisplaySections, getSectionForTime } from '@/lib/sectionUtils';

import AddTaskModal from './AddTaskModal';
import TagModal from './TagModal';
import DateNavigation from './DateNavigation';
import Link from 'next/link';
import DailyGoalList from './DailyGoalList';
import { SortableTaskItem } from './SortableTaskItem';
import { TaskContextProvider } from '@/contexts/TaskContext';
import { useTour } from '@/hooks/useTour';
import { BottomDropZone } from './BottomDropZone';

// DnD Imports
// DnD Imports removed (lifted to wrapper), but useDroppable is needed for SectionContainer
import { useDroppable } from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { AIChatPanel } from './AIChatPanel';
import { createClient } from '@/lib/supabase/client';
import {
    PENDING_GOOGLE_CALENDAR_SYNC_KEY,
    writeStoredCurrentDate,
} from '@/lib/calendarService';

export default function TaskList() {
    const { tasks, sections, routines, updateTask, currentTime, setCurrentTime, selectedTaskIds, toggleTaskSelection, currentDate, setCurrentDate, syncGoogleCalendar, user, tags, projects, getMergedTasks, addUserComment, triggerAIProcess, highlightedTaskId } = useStore();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    // FTUE: 初回ユーザー向けオンボーディングツアー
    const { startTour } = useTour();
    const tourTriggered = useRef(false);
    useEffect(() => {
        // 二重発動防止
        if (tourTriggered.current) return;

        const hasSeenTour = localStorage.getItem('taskel_tour_completed');
        if (hasSeenTour) return;

        // シードタスクが読み込まれてからツアーを開始
        if (tasks.length > 0) {
            tourTriggered.current = true;
            const timer = setTimeout(() => {
                startTour();
                localStorage.setItem('taskel_tour_completed', 'true');
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [startTour, tasks.length]);

    // DnD Sensors
    // DnD Sensors removed (lifted to wrapper)

    const handleSync = async () => {
        if (!user) return;
        setIsSyncing(true);

        try {
            const supabase = createClient();
            const { data } = await supabase.auth.getSession();
            const accessToken = data.session?.provider_token;
            // Capture UI date at click time — do not re-read store after OAuth redirects.
            const selectedDate = currentDate;

            if (accessToken) {
                await syncGoogleCalendar(accessToken, selectedDate);
            } else {
                // Survive full page reload after /auth/callback (Zustand re-inits).
                localStorage.setItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY, selectedDate);
                writeStoredCurrentDate(selectedDate);
                const redirectTo = `${window.location.origin}/auth/callback?next=/tasks`;
                const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo,
                        scopes: 'https://www.googleapis.com/auth/calendar.readonly',
                        queryParams: {
                            access_type: 'offline',
                            prompt: 'consent',
                        },
                    },
                });
                if (error) {
                    throw error;
                }
            }
        } catch (e) {
            console.error("Sync failed", e);
            alert("Sync failed. Check console.");
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        const pendingDate = localStorage.getItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY);
        if (!pendingDate || !user) return;

        // Restore UI-selected date after OAuth full reload (store may have re-inited).
        // Do not depend on currentDate here — setCurrentDate would re-trigger an infinite loop.
        if (pendingDate !== useStore.getState().currentDate) {
            setCurrentDate(pendingDate);
        }

        let cancelled = false;
        const syncPending = async () => {
            const supabase = createClient();
            let accessToken = (await supabase.auth.getSession()).data.session?.provider_token;

            // OAuth callback may set user slightly before provider_token is readable.
            if (!accessToken) {
                await new Promise((resolve) => setTimeout(resolve, 400));
                if (cancelled) return;
                accessToken = (await supabase.auth.getSession()).data.session?.provider_token;
            }
            if (!accessToken || cancelled) return;

            localStorage.removeItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY);
            await syncGoogleCalendar(accessToken, pendingDate);
        };

        void syncPending();
        return () => {
            cancelled = true;
        };
    }, [syncGoogleCalendar, user, setCurrentDate]);

    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingTask(null);
    };

    const handleTaskCreatedWithAI = async (taskId: string, initialPrompt: string) => {
        // 初期プロンプトをコメントとして投稿し、AI処理をトリガー
        await addUserComment(taskId, initialPrompt);
        triggerAIProcess(taskId);
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
        const merged = getMergedTasks(currentDate);
        // 検索ジャンプ先が skipped など通常非表示の場合でも、ハイライト中は当日リストに差し込む
        if (!highlightedTaskId) return merged;
        if (merged.some((task) => task.id === highlightedTaskId)) return merged;
        const highlighted = tasks.find(
            (task) => task.id === highlightedTaskId && task.date === currentDate
        );
        if (!highlighted) return merged;
        return [...merged, highlighted];
        // routines を依存に含める。含めないと、起動時に tasks が routines より先に
        // 反映された場合などにルーチン仮想タスクが再計算されず「今日のルーチンが出ない」
        // 間欠不具合になる。
    }, [getMergedTasks, currentDate, tasks, routines, highlightedTaskId]);

    // 検索結果からのジャンプ: 対象タスクが描画されたらスクロールして目立たせる
    useEffect(() => {
        if (!highlightedTaskId) return;
        const timer = window.setTimeout(() => {
            const el = document.querySelector<HTMLElement>(
                `[data-task-id="${highlightedTaskId}"]`
            );
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [highlightedTaskId, currentDate, filteredTasks]);

    const dailyGoals = useMemo(() => {
        return tasks.filter(t => t.assignedDate === currentDate && !t.date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }, [tasks, currentDate]);

    const compareTasks = (a: Task, b: Task) => {
        // 0. 完了タスクは上に表示（done > in_progress > open）
        const statusRank = (t: Task) => {
            if (t.status === 'done') return 0;
            if (t.status === 'in_progress') return 1;
            return 2;
        };
        const rankDiff = statusRank(a) - statusRank(b);
        if (rankDiff !== 0) return rankDiff;

        // スケジュール有無の判定
        const hasScheduleA = !!a.scheduledStart && a.scheduledStart.trim() !== '';
        const hasScheduleB = !!b.scheduledStart && b.scheduledStart.trim() !== '';

        // 1. スケジュール済み同士は時間順
        if (hasScheduleA && hasScheduleB) {
            const timeCompare = a.scheduledStart!.localeCompare(b.scheduledStart!);
            if (timeCompare !== 0) return timeCompare;
        }

        // 2. スケジュール済み → 未スケジュール の順（時間軸で前に表示）
        if (hasScheduleA && !hasScheduleB) return -1;
        if (!hasScheduleA && hasScheduleB) return 1;

        // 3. order 順（ユーザーの手動ソート）
        return (a.order ?? 0) - (b.order ?? 0);
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

    const handlePlay = async (task: Task) => {
        if (task.status === 'in_progress') return;

        // Multi-active: other in_progress tasks keep running. Each task owns its own
        // startedAt / actualMinutes timer independently.
        const now = new Date();
        const currentSectionId = getSectionForTime(sections, now);

        await updateTask(task.id, {
            status: 'in_progress',
            startedAt: now.getTime(),
            sectionId: currentSectionId
        });
    };

    const handleStop = (task: Task) => {
        if (task.status !== 'in_progress' || !task.startedAt) return;

        const now = Date.now();
        const elapsedMinutes = Math.round((now - task.startedAt) / 60000);

        updateTask(task.id, {
            status: 'done',
            startedAt: undefined,
            actualMinutes: (task.actualMinutes || 0) + elapsedMinutes,
            completedAt: now
        });
    };

    const handleStatusToggle = (task: Task) => {
        if (task.status === 'in_progress' && task.startedAt) {
            const now = Date.now();
            const elapsedMinutes = Math.round((now - task.startedAt) / 60000);

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
                    onTaskCreatedWithAI={handleTaskCreatedWithAI}
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

                <AIChatPanel />
            </div>
        </TaskContextProvider >
    );
}

interface SectionContainerProps {
    section: Section;
    isInterval: boolean;
    sectionEndTime?: string;
    taskSectionEndTime: Date | null;
    tasks: Task[];
    canEditTask: (task: Task) => boolean;
    globalSchedule: Map<string, TimeSlot>;
}

function SectionContainer({
    section, isInterval, sectionEndTime, taskSectionEndTime, tasks,
    canEditTask, globalSchedule
}: SectionContainerProps) {
    const { setNodeRef } = useDroppable({
        id: section.id,
    });
    // 初期ロードは2段階（セクション等が先に描画され、タスクは後から届く）。
    // その間 getMergedTasks はルーチンの仮想タスクを生成しないため、ここで
    // 「タスクなし」と断定するとデータが消えたように見える。読み込み中を明示する。
    const tasksLoaded = useStore((state) => state.tasksLoaded);

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
                    {tasksLoaded ? `${tasks.length} tasks` : '読み込み中…'}
                </span>
            </div>

            <div className="divide-y divide-gray-100 min-h-[50px]">
                {tasks.map((task) => {
                    const schedule = globalSchedule.get(task.id);
                    // 全タスクをドラッグ可能にする（タスクシュートの思想）
                    const isSortable = true;

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
                    tasksLoaded ? (
                        <div className="p-8 text-center text-gray-400 text-sm italic">
                            No tasks in this section
                        </div>
                    ) : (
                        <div className="p-4 space-y-2" aria-busy="true" aria-label="タスクを読み込み中">
                            {[0, 1].map((i) => (
                                <div key={i} className="h-10 rounded bg-gray-100 animate-pulse" />
                            ))}
                        </div>
                    )
                )}
            </div>
            <BottomDropZone sectionId={section.id} />
        </div>
    );
}
