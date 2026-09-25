'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useStore } from '@/store/useStore';
import { Task, Attachment, ChecklistItem } from '@/types';
import { X, MessageSquare, Link2, Check, Trash2 } from 'lucide-react';
import { getSectionForTime, generateDisplaySections } from '@/lib/sectionUtils';
import { TaskCommentThread } from '@/components/TaskCommentThread';
import { TaskForm } from '@/components/TaskForm';
import { TaskAttachments } from '@/components/TaskAttachments';
import { TaskChecklistEditor } from '@/components/TaskChecklistEditor';
import { TaskAlarmSection } from '@/components/TaskAlarmSection';
import { TaskTagSelector } from '@/components/TaskTagSelector';
import { TaskDatePicker } from '@/components/TaskDatePicker';
import { persistAlarmDrafts, type AlarmDraft } from '@/lib/tasks/alarmDrafts';
import { taskStartToMillis } from '@/lib/alarmTime';
import { useCopyTaskLink } from '@/hooks/useCopyTaskLink';
import { FinanceRowsEditor } from '@/components/finance/FinanceRowsEditor';
import { resolveFinanceOccurrenceDate } from '@/lib/finance/dateRange';
import { financeEntryToDraft } from '@/lib/finance/mapping';
import type { FinanceDraftRow } from '@/lib/finance/types';
import { isBlankFinanceDraft, serializeFinanceDraftRows } from '@/lib/finance/validation';
import {
    deriveFinanceLoadState,
    gateExistingTaskFinanceReplace,
    resolvePendingFinanceSourceTaskId,
} from '@/lib/finance/taskEntriesGate';

type TaskType = 'task' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface AddTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultSectionId?: string;
    initialProjectId?: string;
    initialMilestoneId?: string; // NEW
    initialDate?: string; // "YYYY-MM-DD"
    initialScheduledStart?: string; // "HH:mm" for a new task created from an empty timeline slot
    initialAssignedWeek?: string; // "YYYY-Www"
    initialAssignedMonth?: string; // "YYYY-MM"
    initialAssignedYear?: string; // "YYYY"
    initialAssignedDate?: string; // NEW: "YYYY-MM-DD" for Daily Goals
    taskToEdit?: Task | null; // Changed props name to match usage in WeeklyDayColumn
    existingTask?: Task | null;
    onTaskCreatedWithAI?: (taskId: string, initialPrompt: string) => void;
}

export default function AddTaskModal({
    isOpen,
    onClose,
    defaultSectionId,
    initialProjectId,
    initialMilestoneId,
    initialDate,
    initialScheduledStart,
    initialAssignedWeek,
    initialAssignedMonth,
    initialAssignedYear,
    initialAssignedDate,
    taskToEdit,
    existingTask,
    onTaskCreatedWithAI,
}: AddTaskModalProps) {
    const { sections, addTask, updateTask, deleteTask, currentDate, tasks, tags: tagsList, projects, taskComments, commentsLoading, aiProcessing, fetchComments, addUserComment, triggerAIReply, financeEnabled, financeCategories, loadFinanceCategories, loadFinanceEntriesForTask, replaceTaskFinanceEntries, user, addAlarm, updateAlarm } = useStore();
    const tLink = useTranslations('TaskLink');
    const tFinance = useTranslations('Finance');
    const tAlarm = useTranslations('Alarm');
    const tModal = useTranslations('TaskModal');

    /**
     * Delete the task being edited. A routine occurrence is skipped instead
     * (deleting its row would only let the virtual occurrence reappear).
     */
    const handleDelete = async () => {
        if (!targetTask || isSaving || isDeleting) return;
        const message = targetTask.routineId
            ? tModal('skipOccurrenceConfirm', { title: targetTask.title })
            : tModal('deleteConfirm', { title: targetTask.title });
        if (!window.confirm(message)) return;
        setIsDeleting(true);
        try {
            if (targetTask.routineId) {
                const result = await updateTask(targetTask.id, { status: 'skipped' }, { occurrenceDate: targetTask.date || undefined });
                if (!result.ok) return;
            } else {
                await deleteTask(targetTask.id, { occurrenceDate: targetTask.date || undefined });
            }
            onClose();
        } finally {
            setIsDeleting(false);
        }
    };
    const { copyTaskLink } = useCopyTaskLink();
    const [linkCopied, setLinkCopied] = useState(false);

    // Normalize task to edit
    const targetTask = taskToEdit || existingTask;

    // State for Task Type
    const [activeType, setActiveType] = useState<TaskType>(() => {
        if (initialAssignedDate) return 'daily';
        if (initialAssignedWeek) return 'weekly';
        if (initialAssignedMonth) return 'monthly';
        if (initialAssignedYear) return 'yearly';
        return 'task';
    });

    const [title, setTitle] = useState(targetTask?.title || '');
    const [score, setScore] = useState<number | string>(targetTask?.score !== undefined ? targetTask.score : '');

    const [estimatedMinutes, setEstimatedMinutes] = useState<number | string>(targetTask?.estimatedMinutes !== undefined ? targetTask.estimatedMinutes : 15);
    const [actualMinutes, setActualMinutes] = useState<number | string>(targetTask?.actualMinutes !== undefined ? targetTask.actualMinutes : 0);
    const [sectionId, setSectionId] = useState(() => {
        if (targetTask?.sectionId) return targetTask.sectionId;
        if (defaultSectionId) return defaultSectionId;
        const currentSection = getSectionForTime(sections, new Date());
        return currentSection || sections[0]?.id || '';
    });
    const [projectId, setProjectId] = useState(targetTask?.projectId || initialProjectId || '');
    const [milestoneId, setMilestoneId] = useState(targetTask?.milestoneId || initialMilestoneId || '');
    const [scheduledStart, setScheduledStart] = useState(targetTask?.scheduledStart || '');

    // Validation State
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [persistedTaskId, setPersistedTaskId] = useState<string | null>(targetTask?.id ?? null);
    const persistedTaskIdRef = useRef<string | null>(targetTask?.id ?? null);
    const draftTaskIdRef = useRef<string | null>(targetTask?.id ?? null);
    const financeSourceTaskIdRef = useRef<string | null>(null);
    const [financeRows, setFinanceRows] = useState<FinanceDraftRow[]>([]);
    const [financeLoadResult, setFinanceLoadResult] = useState<{
        status: 'loaded' | 'error';
        taskId: string;
        entryCount?: number;
    } | null>(null);
    const [financeLoadNonce, setFinanceLoadNonce] = useState(0);
    const financeSessionKey = `${isOpen ? 'open' : 'closed'}:${user?.uid ?? 'anonymous'}:${targetTask?.id ?? 'new'}:${financeEnabled ? 'on' : 'off'}`;
    const activeSessionRef = useRef(financeSessionKey);
    const [financeSession, setFinanceSession] = useState(financeSessionKey);
    if (financeSession !== financeSessionKey) {
        setFinanceSession(financeSessionKey);
        setFinanceRows([]);
        setFinanceLoadResult(null);
        persistedTaskIdRef.current = targetTask?.id ?? null;
        draftTaskIdRef.current = targetTask?.id ?? null;
        financeSourceTaskIdRef.current = null;
    }

    useEffect(() => {
        activeSessionRef.current = financeSessionKey;
    }, [financeSessionKey]);

    // Context-dependent Date Fields
    const [date, setDate] = useState(() => {
        if (targetTask) return targetTask.date || '';
        if (initialDate !== undefined) return initialDate;
        if (initialAssignedDate) return ''; // Daily goal doesn't use 'date' field for scheduling
        if (initialAssignedWeek || initialAssignedMonth || initialAssignedYear) return '';
        return currentDate;
    });

    // Goal specific fields
    const [assignedDate, setAssignedDate] = useState(targetTask?.assignedDate || initialAssignedDate || '');
    const [assignedWeek, setAssignedWeek] = useState(targetTask?.assignedWeek || initialAssignedWeek || '');
    const [assignedMonth, setAssignedMonth] = useState(targetTask?.assignedMonth || initialAssignedMonth || '');
    const [assignedYear, setAssignedYear] = useState(targetTask?.assignedYear || initialAssignedYear || '');

    const [memo, setMemo] = useState(targetTask?.memo || '');
    const [tags, setTags] = useState<string[]>(targetTask?.tags || []);
    const [currentTag, setCurrentTag] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isComposing, setIsComposing] = useState(false);

    // Taskel AI State
    const [taskelAIEnabled, setTaskelAIEnabled] = useState(
        targetTask?.aiTags?.includes('ai-workspace') ?? false
    );
    const [aiInitialPrompt, setAiInitialPrompt] = useState('');

    // 持ち物リスト State
    const [checklist, setChecklist] = useState<ChecklistItem[]>(targetTask?.checklist || []);
    // 新規作成時のアラーム下書き。編集時は TaskAlarmSection が即時保存するため空のまま。
    const [draftAlarms, setDraftAlarms] = useState<AlarmDraft[]>([]);

    // Attachment State
    const [attachments, setAttachments] = useState<Attachment[]>(targetTask?.attachments || []);
    const [isUploading, setIsUploading] = useState(false);
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        if (!user) {
            alert("Please login to upload files.");
            return;
        }

        setIsUploading(true);
        const files = Array.from(e.target.files);

        try {
            // Dynamic import to avoid circular dependencies if any, though standard import is fine usually.
            // Using standard import for now, assuming it's available.
            const { uploadTaskAttachment } = await import('@/lib/storage');

            const uploadPromises = files.map(file => uploadTaskAttachment(file, user.uid));
            const newAttachments = await Promise.all(uploadPromises);

            setAttachments(prev => [...prev, ...newAttachments]);
        } catch (error: unknown) {
            console.error("Upload failed", error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            alert(`Upload failed: ${message}`);
        } finally {
            setIsUploading(false);
            // Clear input value to allow selecting same file again if needed
            e.target.value = '';
        }
    };

    const handleRemoveAttachment = async (attachmentId: string) => {
        // Optimistic UI update
        const attachmentToRemove = attachments.find(a => a.id === attachmentId);
        setAttachments(prev => prev.filter(a => a.id !== attachmentId));

        if (attachmentToRemove) {
            try {
                const { deleteAttachment } = await import('@/lib/storage');
                await deleteAttachment(attachmentToRemove.path);
            } catch (error) {
                console.error("Failed to delete file from storage", error);
                // We don't revert UI because the link is gone from task anyway
            }
        }
    };

    // Use global tags for suggestions
    const availableTags = useMemo(() => {
        return tagsList.map(t => t.name).sort();
    }, [tagsList]);

    // Use Display Sections for dropdown to include Intervals
    const displaySections = useMemo(() => generateDisplaySections(sections), [sections]);

    // Reset state when modal opens/changes
    useEffect(() => {
        if (isOpen) {
            setTitle(targetTask?.title || '');

            setEstimatedMinutes(targetTask?.estimatedMinutes !== undefined ? targetTask.estimatedMinutes : 15);
            setActualMinutes(targetTask?.actualMinutes !== undefined ? targetTask.actualMinutes : 0);
            setProjectId(targetTask?.projectId || initialProjectId || '');
            setMilestoneId(targetTask?.milestoneId || initialMilestoneId || '');

            // Determine Type once and reuse it for dependent defaults.
            let nextActiveType: TaskType = 'task';
            if (targetTask?.assignedDate || initialAssignedDate) nextActiveType = 'daily';
            else if (targetTask?.assignedWeek || initialAssignedWeek) nextActiveType = 'weekly';
            else if (targetTask?.assignedMonth || initialAssignedMonth) nextActiveType = 'monthly';
            else if (targetTask?.assignedYear || initialAssignedYear) nextActiveType = 'yearly';
            setActiveType(nextActiveType);

            let initialSectionId = targetTask?.sectionId || defaultSectionId || sections[0]?.id || '';
            // Editing keeps the task's own time; a new task may start from a clicked timeline slot.
            const startingScheduledStart = targetTask ? targetTask.scheduledStart || '' : initialScheduledStart || '';

            if (startingScheduledStart && startingScheduledStart.length === 5) {
                const correctSection = getSectionForTime(sections, startingScheduledStart);
                if (correctSection !== initialSectionId) {
                    initialSectionId = correctSection;
                }
            }

            setSectionId(initialSectionId);
            setScheduledStart(startingScheduledStart);

            // Context Fields
            setDate(targetTask ? (targetTask.date || '') : (initialDate !== undefined ? initialDate : currentDate));
            setAssignedDate(targetTask?.assignedDate || initialAssignedDate || (nextActiveType === 'daily' ? currentDate : ''));
            setAssignedWeek(targetTask?.assignedWeek || initialAssignedWeek || '');
            setAssignedMonth(targetTask?.assignedMonth || initialAssignedMonth || '');
            setAssignedYear(targetTask?.assignedYear || initialAssignedYear || '');

            setMemo(targetTask?.memo || '');
            setTags(targetTask?.tags || []);
            setScore(targetTask?.score !== undefined ? targetTask.score : '');
            setCurrentTag('');
            setTaskelAIEnabled(targetTask?.aiTags?.includes('ai-workspace') ?? false);
            setAiInitialPrompt('');
            setChecklist(targetTask?.checklist || []);
            setAttachments(targetTask?.attachments || []);
            setDraftAlarms([]);
            setError(null);
            setIsSaving(false);
            persistedTaskIdRef.current = targetTask?.id ?? null;
            draftTaskIdRef.current = targetTask?.id ?? null;
            financeSourceTaskIdRef.current = null;
            setPersistedTaskId(targetTask?.id ?? null);
        }
    }, [isOpen, targetTask, defaultSectionId, initialProjectId, initialMilestoneId, initialDate, initialScheduledStart, initialAssignedWeek, initialAssignedMonth, initialAssignedYear, initialAssignedDate, sections, currentDate]);

    useEffect(() => {
        if (!isOpen || !financeEnabled) {
            return;
        }
        void loadFinanceCategories();
    }, [isOpen, financeEnabled, loadFinanceCategories]);

    const isFinanceCapableType = activeType === 'task' || activeType === 'daily';
    const originalTaskCouldHaveFinance = Boolean(targetTask?.date || targetTask?.assignedDate);
    const financeReadRequired = Boolean(
        isOpen &&
        financeEnabled &&
        targetTask?.id &&
        (isFinanceCapableType || originalTaskCouldHaveFinance)
    );

    useEffect(() => {
        if (!financeReadRequired || !targetTask?.id) {
            return;
        }

        const taskId = targetTask.id;
        let cancelled = false;
        loadFinanceEntriesForTask(taskId)
            .then((entries) => {
                if (!cancelled) {
                    setFinanceRows(entries.map(financeEntryToDraft));
                    setFinanceLoadResult({ status: 'loaded', taskId, entryCount: entries.length });
                }
            })
            .catch((loadError) => {
                console.error('Failed to load finance entries:', loadError);
                if (!cancelled) {
                    setFinanceLoadResult({ status: 'error', taskId });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [financeReadRequired, targetTask?.id, financeLoadNonce, loadFinanceEntriesForTask]);

    // Exclusive Logic: Auto-select section when time changes
    useEffect(() => {
        if (scheduledStart && scheduledStart.length === 5) {
            // Only auto-update if valid time string HH:mm
            const newSectionId = getSectionForTime(sections, scheduledStart);
            if (newSectionId && newSectionId !== sectionId) {
                setSectionId(newSectionId);
            }
        }
    }, [scheduledStart, sections, sectionId]);

    // Check for inconsistency (used for UI warning)
    const isTimeSectionInconsistent = useMemo(() => {
        if (!scheduledStart || !sectionId) return false;
        const calculatedSection = getSectionForTime(sections, scheduledStart);
        return calculatedSection !== sectionId;
    }, [scheduledStart, sectionId, sections]);

    if (!isOpen) return null;

    const occurrenceDate = resolveFinanceOccurrenceDate({
        activeType,
        date,
        assignedDate,
    });
    const showFinanceEditor = financeEnabled && isFinanceCapableType;
    const existingFinanceTaskId = targetTask?.id ?? null;
    const financeLoad = deriveFinanceLoadState({
        existingTaskId: financeReadRequired ? existingFinanceTaskId : null,
        result: financeLoadResult,
    });
    const financeReplaceGate = gateExistingTaskFinanceReplace({
        enabled: showFinanceEditor,
        occurrenceDate,
        existingTaskId: existingFinanceTaskId,
        load: financeLoad,
    });
    const financeLoading = financeLoad.status === 'loading';
    const financeLoadError = financeLoad.status === 'error';
    const existingFinanceEntryCount =
        financeLoadResult?.status === 'loaded' &&
        financeLoadResult.taskId === existingFinanceTaskId
            ? financeLoadResult.entryCount ?? 0
            : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const submitSessionKey = financeSessionKey;
        setError(null);

        // Validation Logic
        if (!title.trim()) {
            setError('Title is required.');
            return;
        }

        if (activeType === 'daily' && !assignedDate && !initialAssignedDate && !targetTask?.assignedDate) {
            // Check current input for assignedDate. Note: assignedDate state might be initialized empty if not passed.
            // We need to enforce it. The input field is bound to `assignedDate`.
            // Default `assignedDate` is often `currentDate` in state init if type is daily, so this might be safe, but let's be strict.
            if (!assignedDate) {
                setError('Daily Goal requires a date.');
                return;
            }
        }

        if (activeType === 'weekly' && !assignedWeek) {
            setError('Weekly Goal requires a target week.');
            return;
        }

        if (activeType === 'monthly' && !assignedMonth) {
            setError('Monthly Goal requires a target month.');
            return;
        }

        if (activeType === 'yearly' && !assignedYear) {
            setError('Yearly Goal requires a target year.');
            return;
        }

        // if (!sectionId) return; // Removed section check because it's optional for goals


        // Final check: if they typed a time and disregarded the auto-selected section
        // or vice versa, we follow the "Last set" rule. 
        // In this UI, changing section clears time anyway. 
        // Changing time sets section. 
        // So the current state SHOULD be consistent.
        // But let's be double sure for saving:
        let finalSectionId = sectionId;
        if (scheduledStart && scheduledStart.length === 5) {
            finalSectionId = getSectionForTime(sections, scheduledStart);
        }

        // Include currentTag if the user hasn't pressed Enter to add it yet but submits
        const finalTags = [...tags];
        if (currentTag.trim() && !tags.includes(currentTag.trim())) {
            finalTags.push(currentTag.trim());
        }

        let financePayload: ReturnType<typeof serializeFinanceDraftRows> | null = null;
        const hasFinanceDraft = financeRows.some((row) => !isBlankFinanceDraft(row));
        const hadExistingFinance = existingFinanceEntryCount > 0;
        if (financeReadRequired && existingFinanceTaskId && financeLoad.status !== 'loaded') {
            setError(
                financeLoad.status === 'loading'
                    ? tFinance('saveBlockedFinanceLoading')
                    : tFinance('saveBlockedFinanceError')
            );
            return;
        }
        if (financeEnabled && !occurrenceDate && (hasFinanceDraft || hadExistingFinance)) {
            setError(tFinance('datedTypeRequired'));
            return;
        }
        if (showFinanceEditor && occurrenceDate) {
            if (!financeReplaceGate.allow) {
                setError(
                    financeReplaceGate.reason === 'loading'
                        ? tFinance('saveBlockedFinanceLoading')
                        : tFinance('saveBlockedFinanceError')
                );
                return;
            }
            financePayload = serializeFinanceDraftRows(financeRows);
            if (!financePayload.ok) {
                if (financePayload.error.code === 'too_many') {
                    setError(tFinance('validationTooMany', { max: financePayload.error.max }));
                } else if (financePayload.error.code === 'category') {
                    setError(tFinance('validationCategory'));
                } else if (financePayload.error.code === 'amount') {
                    setError(tFinance('validationAmount'));
                } else {
                    setError(tFinance('validationRows'));
                }
                return;
            }
        }

        const existingAiTags = targetTask?.aiTags || [];
        const updatedAiTags = taskelAIEnabled
            ? (existingAiTags.includes('ai-workspace') ? existingAiTags : [...existingAiTags, 'ai-workspace'])
            : existingAiTags.filter(tag => tag !== 'ai-workspace');

        const taskFields = {
            title,
            sectionId: activeType === 'task' ? (finalSectionId || (sections[0]?.id || 'section-1')) : 'goal',
            projectId: projectId || '',
            milestoneId: milestoneId || undefined,
            estimatedMinutes: activeType === 'task' ? Number(estimatedMinutes) : 0,
            actualMinutes: activeType === 'task' ? Number(actualMinutes) : 0,
            scheduledStart: activeType === 'task' ? (scheduledStart || undefined) : undefined,
            date: activeType === 'task' ? date : '',
            assignedDate: activeType === 'daily' ? (assignedDate || currentDate) : undefined,
            assignedWeek: activeType === 'weekly' ? assignedWeek : undefined,
            assignedMonth: activeType === 'monthly' ? assignedMonth : undefined,
            assignedYear: activeType === 'yearly' ? assignedYear : undefined,
            tags: finalTags,
            score: score === '' ? undefined : Number(score),
            memo,
            checklist,
            attachments,
        };

        setIsSaving(true);
        try {
            const existingId = persistedTaskIdRef.current ?? persistedTaskId ?? targetTask?.id ?? null;
            let savedId = existingId;

            if (existingId) {
                const persistResult = await updateTask(existingId, {
                    ...taskFields,
                    aiTags: updatedAiTags.length > 0 ? updatedAiTags : undefined,
                    ...(taskelAIEnabled && !targetTask?.aiStatus ? { aiStatus: 'pending' as const } : {}),
                });
                if (!persistResult.ok) {
                    setError(tFinance('saveTaskFailed'));
                    return;
                }
                savedId = persistResult.persistedId;
                financeSourceTaskIdRef.current = resolvePendingFinanceSourceTaskId({
                    pendingSourceTaskId: financeSourceTaskIdRef.current,
                    attemptedTaskId: existingId,
                    persistedTaskId: savedId,
                });
                persistedTaskIdRef.current = persistResult.persistedId;
                setPersistedTaskId(persistResult.persistedId);
            } else {
                const sectionTasks = tasks.filter(task => task.sectionId === (finalSectionId || ''));
                const maxOrder = sectionTasks.length > 0 ? Math.max(...sectionTasks.map(task => task.order ?? 0)) : 0;
                const draftTaskId = draftTaskIdRef.current ?? crypto.randomUUID();
                draftTaskIdRef.current = draftTaskId;
                const newTaskPayload = {
                    id: draftTaskId,
                    userId: useStore.getState().user?.uid || 'user-1',
                    status: 'open' as const,
                    order: maxOrder + 1,
                    ...taskFields,
                    ...(taskelAIEnabled ? {
                        aiTags: ['ai-workspace'],
                        aiStatus: 'pending' as const,
                    } : {}),
                };
                const persistResult = await addTask(newTaskPayload);
                if (!persistResult.ok) {
                    setError(tFinance('saveTaskFailed'));
                    return;
                }
                savedId = persistResult.persistedId;
                persistedTaskIdRef.current = persistResult.persistedId;
                setPersistedTaskId(persistResult.persistedId);
                if (taskelAIEnabled && aiInitialPrompt.trim() && onTaskCreatedWithAI) {
                    onTaskCreatedWithAI(persistResult.persistedId, aiInitialPrompt.trim());
                }
            }

            if (showFinanceEditor && occurrenceDate && financePayload?.ok && savedId && user) {
                const financeOk = await replaceTaskFinanceEntries(
                    savedId,
                    financePayload.entries,
                    financeSourceTaskIdRef.current ?? undefined
                );
                if (!financeOk) {
                    setError(tFinance('saveFinanceFailed'));
                    return;
                }
                financeSourceTaskIdRef.current = null;
            }

            if (activeType === 'task' && savedId && draftAlarms.length > 0) {
                const { remaining } = await persistAlarmDrafts({
                    drafts: draftAlarms,
                    taskId: savedId,
                    label: title,
                    startMillis: taskStartToMillis(date, scheduledStart),
                    addAlarm,
                    updateAlarm,
                });
                setDraftAlarms(remaining);
                if (remaining.length > 0) {
                    setError(tAlarm('save_failed'));
                    return;
                }
            }

            if (activeSessionRef.current !== submitSessionKey) {
                return;
            }

            setTitle('');
            setScore('');
            setEstimatedMinutes(15);
            setActualMinutes(0);
            setScheduledStart('');
            setProjectId('');
            setMilestoneId('');
            setMemo('');
            setTags([]);
            setChecklist([]);
            setCurrentTag('');
            setTaskelAIEnabled(false);
            setAiInitialPrompt('');
            setFinanceRows([]);
            setDraftAlarms([]);
            onClose();
        } finally {
            if (activeSessionRef.current === submitSessionKey) {
                setIsSaving(false);
            }
        }
    };

    const handleAddTag = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (isComposing) return; // Ignore Enter during IME composition

            if (currentTag.trim() && !tags.includes(currentTag.trim())) {
                setTags([...tags, currentTag.trim()]);
                setCurrentTag('');
                setShowSuggestions(false);
            }
        }
    };

    const addTagToTask = (tag: string) => {
        if (!tags.includes(tag)) {
            setTags([...tags, tag]);
            setCurrentTag('');
            setShowSuggestions(false);
        }
    };

    const filteredTags = availableTags.filter(tag =>
        tag.toLowerCase().includes(currentTag.toLowerCase()) &&
        !tags.includes(tag)
    );

    const removeTag = (tagToRemove: string) => {
        setTags(tags.filter(tag => tag !== tagToRemove));
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex flex-col border-b border-gray-100">
                    <div className="flex justify-between items-center p-4">
                        <h2 className="text-lg font-semibold text-gray-800">{targetTask ? 'Edit Item' : 'Add New Item'}</h2>
                        <div className="flex items-center gap-1">
                            {targetTask && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        const ok = await copyTaskLink(
                                            targetTask.id,
                                            targetTask.isVirtual ? targetTask.date : undefined
                                        );
                                        if (ok) {
                                            setLinkCopied(true);
                                            window.setTimeout(() => setLinkCopied(false), 2000);
                                        }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    title={tLink('copy')}
                                    aria-label={tLink('copy')}
                                >
                                    {linkCopied ? <Check size={14} className="text-green-600" /> : <Link2 size={14} />}
                                    <span className="hidden sm:inline">
                                        {linkCopied ? tLink('copied') : tLink('copy')}
                                    </span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSaving}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label={tFinance('closeTaskModal')}
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                    {/* Type Selector Dropdown */}
                    <div className="px-4 pb-4">
                        <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Item Type</label>
                        <select
                            value={activeType}
                            onChange={(e) => setActiveType(e.target.value as TaskType)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                        >
                            <option value="task">Task</option>
                            <option value="daily">Daily Goal</option>
                            <option value="weekly">Weekly Goal</option>
                            <option value="monthly">Monthly Goal</option>
                            <option value="yearly">Yearly Goal</option>
                        </select>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                    <TaskForm
                        title={title}
                        setTitle={setTitle}
                        activeType={activeType}
                        projectId={projectId}
                        setProjectId={setProjectId}
                        milestoneId={milestoneId}
                        setMilestoneId={setMilestoneId}
                        projects={projects}
                        memo={memo}
                        setMemo={setMemo}
                    />

                    <TaskDatePicker
                        activeType={activeType}
                        date={date}
                        setDate={setDate}
                        currentDate={currentDate}
                        assignedDate={assignedDate}
                        setAssignedDate={setAssignedDate}
                        assignedWeek={assignedWeek}
                        setAssignedWeek={setAssignedWeek}
                        assignedMonth={assignedMonth}
                        setAssignedMonth={setAssignedMonth}
                        assignedYear={assignedYear}
                        setAssignedYear={setAssignedYear}
                        estimatedMinutes={estimatedMinutes}
                        setEstimatedMinutes={setEstimatedMinutes}
                        actualMinutes={actualMinutes}
                        setActualMinutes={setActualMinutes}
                        sectionId={sectionId}
                        setSectionId={setSectionId}
                        scheduledStart={scheduledStart}
                        setScheduledStart={setScheduledStart}
                        displaySections={displaySections}
                        isTimeSectionInconsistent={isTimeSectionInconsistent}
                    />

                    <TaskTagSelector
                        currentTag={currentTag}
                        setCurrentTag={setCurrentTag}
                        showSuggestions={showSuggestions}
                        setShowSuggestions={setShowSuggestions}
                        handleAddTag={handleAddTag}
                        setIsComposing={setIsComposing}
                        filteredTags={filteredTags}
                        addTagToTask={addTagToTask}
                        tags={tags}
                        removeTag={removeTag}
                        score={score}
                        setScore={setScore}
                    />

                    {/* Taskel AI Toggle + Inline Prompt - コメントアウト: エラー多発のため一旦無効化 */}
                    {/* {activeType === 'task' && (
                        <div className={clsx(
                            "rounded-lg border transition-colors overflow-hidden",
                            taskelAIEnabled
                                ? "bg-indigo-50 border-indigo-200"
                                : "bg-gray-50 border-gray-200 hover:bg-gray-100"
                        )}>
                            <div
                                className="flex items-center justify-between p-3 cursor-pointer"
                                onClick={() => setTaskelAIEnabled(!taskelAIEnabled)}
                            >
                                <div className="flex items-center gap-2.5">
                                    <Sparkles size={16} className={clsx(
                                        taskelAIEnabled ? "text-indigo-600" : "text-gray-400"
                                    )} />
                                    <div>
                                        <span className={clsx(
                                            "text-sm font-medium",
                                            taskelAIEnabled ? "text-indigo-900" : "text-gray-700"
                                        )}>
                                            Taskel AI
                                        </span>
                                        <p className={clsx(
                                            "text-xs",
                                            taskelAIEnabled ? "text-indigo-600" : "text-gray-500"
                                        )}>
                                            タスクについてAIと会話できます
                                        </p>
                                    </div>
                                </div>
                                <div
                                    className={clsx(
                                        "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
                                        taskelAIEnabled ? "bg-indigo-600" : "bg-gray-300"
                                    )}
                                >
                                    <div
                                        className={clsx(
                                            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                                            taskelAIEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                                        )}
                                    />
                                </div>
                            </div>
                            {taskelAIEnabled && (
                                <div className="px-3 pb-3">
                                    <textarea
                                        value={aiInitialPrompt}
                                        onChange={(e) => setAiInitialPrompt(e.target.value)}
                                        className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                                        placeholder="AIへの指示（例：このURLを分析して、タスクを分解して）"
                                        rows={3}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <p className="text-[10px] text-indigo-400 mt-1">
                                        作成後、タスク詳細画面でAIが応答します
                                    </p>
                                </div>
                            )}
                        </div>
                    )} */}

                    {/* アラーム設定（Phase A: Web + DB）。
                        未実体化の仮想ルーチンタスクは対象外。新規作成時は下書きとして保持し、
                        タスク保存後に alarms.task_id へ紐付けて書き込む。 */}
                    {activeType === 'task' && !targetTask?.isVirtual && (
                        <TaskAlarmSection
                            task={targetTask}
                            title={title}
                            date={date}
                            scheduledStart={scheduledStart}
                            drafts={draftAlarms}
                            onDraftsChange={setDraftAlarms}
                        />
                    )}

                    {financeEnabled && (
                        showFinanceEditor ||
                        financeLoading ||
                        financeLoadError ||
                        existingFinanceEntryCount > 0
                    ) && (
                        <FinanceRowsEditor
                            rows={financeRows}
                            categories={financeCategories}
                            occurrenceDate={occurrenceDate}
                            disabled={isSaving || financeLoading || financeLoadError}
                            loading={financeLoading}
                            loadError={financeLoadError}
                            onChange={setFinanceRows}
                            onRetryLoad={() => {
                                setFinanceLoadResult(null);
                                setFinanceLoadNonce((nonce) => nonce + 1);
                            }}
                        />
                    )}

                    {activeType === 'task' && (
                        <TaskChecklistEditor checklist={checklist} setChecklist={setChecklist} />
                    )}

                    <TaskAttachments
                        attachments={attachments}
                        isUploading={isUploading}
                        handleFileSelect={handleFileSelect}
                        handleRemoveAttachment={handleRemoveAttachment}
                    />

                    {/* Taskel AI Conversation (既存のai-workspaceタスク編集時のみ) */}
                    {targetTask && targetTask.aiTags?.includes('ai-workspace') && (
                        <ConversationSection
                            taskId={targetTask.id}
                            taskComments={taskComments}
                            commentsLoading={commentsLoading}
                            aiProcessing={aiProcessing}
                            fetchComments={fetchComments}
                            addUserComment={addUserComment}
                            triggerAIReply={triggerAIReply}
                        />
                    )}

                    <div className="flex flex-col items-end pt-2">
                        {error && (
                            <p role="alert" className="text-red-500 text-sm mb-2 font-medium">{error}</p>
                        )}
                        <div className="flex w-full items-center justify-between gap-2">
                            <div>
                                {/* 削除はここから（通常表示の選択バー以外の唯一の経路。タイムライン表記でも使える）。
                                    ルーチン由来のタスクは「今回分をスキップ」にし、ルーチン自体は残す。 */}
                                {targetTask && (
                                    <button
                                        type="button"
                                        data-testid="task-modal-delete"
                                        onClick={handleDelete}
                                        disabled={isSaving || isDeleting}
                                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                        <Trash2 size={16} />
                                        {isDeleting ? tModal('deleting') : targetTask.routineId ? tModal('skipOccurrence') : tModal('delete')}
                                    </button>
                                )}
                            </div>
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isSaving || isDeleting}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg mr-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isUploading || isSaving || isDeleting || financeLoading || financeLoadError}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
                                >
                                    {isSaving ? tFinance('saving') : targetTask ? 'Update Task' : 'Add Task'}
                                </button>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}

/**
 * コンバセーションセクション（ai-workspaceタスク編集時に表示）
 * useEffectを使うため別コンポーネントに切り出し
 */
function ConversationSection({
    taskId,
    taskComments,
    commentsLoading,
    aiProcessing,
    fetchComments,
    addUserComment,
    triggerAIReply,
}: {
    taskId: string;
    taskComments: Record<string, import('@/types').TaskComment[]>;
    commentsLoading: Record<string, boolean>;
    aiProcessing: Record<string, boolean>;
    fetchComments: (taskId: string) => Promise<void>;
    addUserComment: (taskId: string, content: string) => Promise<void>;
    triggerAIReply: (taskId: string) => Promise<void>;
}) {
    const comments = taskComments[taskId] || [];
    const isLoading = commentsLoading[taskId] || false;
    const isAIProcessing = aiProcessing[taskId] || false;

    useEffect(() => {
        fetchComments(taskId);
        // AI処理中はポーリングで更新を取得（Firestoreクライアント直接アクセスを避ける）
        const interval = setInterval(() => {
            fetchComments(taskId);
        }, 5000);
        return () => clearInterval(interval);
    }, [taskId, fetchComments]);

    return (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <MessageSquare size={14} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-600">
                    Taskel AI コンバセーション
                </span>
                {comments.length > 0 && (
                    <span className="text-[10px] text-gray-400">({comments.length})</span>
                )}
            </div>
            <div className="h-[280px]">
                <TaskCommentThread
                    taskId={taskId}
                    comments={comments}
                    isLoading={isLoading}
                    isAIProcessing={isAIProcessing}
                    isAIWorkspace={true}
                    onAddComment={(content) => addUserComment(taskId, content)}
                    onTriggerAIReply={() => triggerAIReply(taskId)}
                />
            </div>
        </div>
    );
}
