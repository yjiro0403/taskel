'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store/useStore';
import { Task, Attachment, ChecklistItem } from '@/types';
import { X, Sparkles, MessageSquare } from 'lucide-react';
import { getSectionForTime, generateDisplaySections } from '@/lib/sectionUtils';
import { TaskCommentThread } from '@/components/TaskCommentThread';
import { TaskForm } from '@/components/TaskForm';
import { TaskAttachments } from '@/components/TaskAttachments';
import { TaskChecklistEditor } from '@/components/TaskChecklistEditor';
import { TaskTagSelector } from '@/components/TaskTagSelector';
import { TaskDatePicker } from '@/components/TaskDatePicker';

type TaskType = 'task' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface AddTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    defaultSectionId?: string;
    initialProjectId?: string;
    initialMilestoneId?: string; // NEW
    initialDate?: string; // "YYYY-MM-DD"
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
    initialAssignedWeek,
    initialAssignedMonth,
    initialAssignedYear,
    initialAssignedDate,
    taskToEdit,
    existingTask,
    onTaskCreatedWithAI,
}: AddTaskModalProps) {
    const { sections, addTask, updateTask, currentDate, tasks, tags: tagsList, addTag, projects, taskComments, commentsLoading, aiProcessing, fetchComments, addUserComment, triggerAIReply } = useStore();

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

    // Attachment State
    const [attachments, setAttachments] = useState<Attachment[]>(targetTask?.attachments || []);
    const [isUploading, setIsUploading] = useState(false);
    const { user } = useStore(); // Need user for upload path

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
        } catch (error: any) {
            console.error("Upload failed", error);
            alert(`Upload failed: ${error.message}`);
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

            // Determine Type
            if (targetTask?.assignedDate || initialAssignedDate) setActiveType('daily');
            else if (targetTask?.assignedWeek || initialAssignedWeek) setActiveType('weekly');
            else if (targetTask?.assignedMonth || initialAssignedMonth) setActiveType('monthly');
            else if (targetTask?.assignedYear || initialAssignedYear) setActiveType('yearly');
            else setActiveType('task');

            let initialSectionId = targetTask?.sectionId || defaultSectionId || sections[0]?.id || '';
            let initialScheduledStart = targetTask?.scheduledStart || '';

            if (initialScheduledStart && initialScheduledStart.length === 5) {
                const correctSection = getSectionForTime(sections, initialScheduledStart);
                if (correctSection !== initialSectionId) {
                    initialSectionId = correctSection;
                }
            }

            setSectionId(initialSectionId);
            setScheduledStart(initialScheduledStart);

            // Context Fields
            setDate(targetTask ? (targetTask.date || '') : (initialDate !== undefined ? initialDate : currentDate));
            setAssignedDate(targetTask?.assignedDate || initialAssignedDate || (activeType === 'daily' ? currentDate : ''));
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
            setError(null);
        }
    }, [isOpen, targetTask, defaultSectionId, initialProjectId, initialMilestoneId, initialDate, initialAssignedWeek, initialAssignedMonth, initialAssignedYear, initialAssignedDate, sections, currentDate]);

    // Exclusive Logic: Auto-select section when time changes
    useEffect(() => {
        if (scheduledStart && scheduledStart.length === 5) {
            // Only auto-update if valid time string HH:mm
            const newSectionId = getSectionForTime(sections, scheduledStart);
            if (newSectionId && newSectionId !== sectionId) {
                setSectionId(newSectionId);
            }
        }
    }, [scheduledStart, sections]);

    // Check for inconsistency (used for UI warning)
    const isTimeSectionInconsistent = useMemo(() => {
        if (!scheduledStart || !sectionId) return false;
        const calculatedSection = getSectionForTime(sections, scheduledStart);
        return calculatedSection !== sectionId;
    }, [scheduledStart, sectionId, sections]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
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
        let finalTags = [...tags];
        if (currentTag.trim() && !tags.includes(currentTag.trim())) {
            finalTags.push(currentTag.trim());
        }

        finalTags.forEach(tagName => {
            const exists = tagsList.find(t => t.name === tagName);
            if (!exists) {
                // Auto-create new global tag
                addTag({
                    id: crypto.randomUUID(),
                    userId: 'user-1',
                    name: tagName,
                    memo: ''
                });
            }
        });

        if (targetTask) {
            console.log("AddTaskModal Update:", { taskId: targetTask.id, projectId, finalTags });
            // Taskel AI: aiTags の計算
            const existingAiTags = targetTask.aiTags || [];
            const updatedAiTags = taskelAIEnabled
                ? (existingAiTags.includes('ai-workspace') ? existingAiTags : [...existingAiTags, 'ai-workspace'])
                : existingAiTags.filter(t => t !== 'ai-workspace');

            updateTask(targetTask.id, {
                title,
                sectionId: activeType === 'task' ? (finalSectionId || (sections[0]?.id || 'section-1')) : 'goal', // Dummy or empty for goals
                projectId: projectId || '',
                milestoneId: milestoneId || undefined,
                estimatedMinutes: activeType === 'task' ? Number(estimatedMinutes) : 0,
                actualMinutes: activeType === 'task' ? Number(actualMinutes) : 0,
                // 空文字は time 列(scheduled_start)に渡せないため undefined を送る。
                // 明示的 undefined は withClearedNullables で null（クリア）に変換される。
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
                aiTags: updatedAiTags.length > 0 ? updatedAiTags : undefined,
                ...(taskelAIEnabled && !targetTask.aiStatus ? { aiStatus: 'pending' as const } : {}),
            });
        } else {
            // Calculate new order: max order in this section + 1
            const sectionTasks = tasks.filter(t => t.sectionId === (finalSectionId || ''));
            const maxOrder = sectionTasks.length > 0 ? Math.max(...sectionTasks.map(t => t.order ?? 0)) : 0;
            const newOrder = maxOrder + 1;

            const newTaskPayload = {
                id: crypto.randomUUID(),
                userId: useStore.getState().user?.uid || 'user-1', // Use actual user ID
                title,
                sectionId: activeType === 'task' ? (finalSectionId || (sections[0]?.id || 'section-1')) : 'goal',
                projectId: projectId || '',
                milestoneId: milestoneId || undefined,
                date: activeType === 'task' ? date : '',
                status: 'open' as const,
                estimatedMinutes: activeType === 'task' ? Number(estimatedMinutes) : 0,
                actualMinutes: activeType === 'task' ? Number(actualMinutes) : 0,
                // 空文字は time 列(scheduled_start)に渡せないため undefined を送る（未設定）。
                scheduledStart: activeType === 'task' ? (scheduledStart || undefined) : undefined,
                order: newOrder,
                tags: finalTags,
                memo,
                checklist,
                attachments,
                assignedDate: activeType === 'daily' ? (assignedDate || currentDate) : undefined,
                assignedWeek: activeType === 'weekly' ? assignedWeek : undefined,
                assignedMonth: activeType === 'monthly' ? assignedMonth : undefined,
                assignedYear: activeType === 'yearly' ? assignedYear : undefined,
                score: score === '' ? undefined : Number(score),
                ...(taskelAIEnabled ? {
                    aiTags: ['ai-workspace'],
                    aiStatus: 'pending' as const,
                } : {}),
            };
            console.log("Creating new task:", newTaskPayload);
            addTask(newTaskPayload);

            // Taskel AI: 初期プロンプトがあればコールバックでトリガー
            if (taskelAIEnabled && aiInitialPrompt.trim() && onTaskCreatedWithAI) {
                onTaskCreatedWithAI(newTaskPayload.id, aiInitialPrompt.trim());
            }
        }

        // ... (reset)
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
        onClose();
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
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                            <X size={20} />
                        </button>
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
                            <p className="text-red-500 text-sm mb-2 font-medium">{error}</p>
                        )}
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg mr-2 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isUploading}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
                            >
                                {targetTask ? 'Update Task' : 'Add Task'}
                            </button>
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
