'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store/useStore';
import { Task, Attachment } from '@/types';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { getSectionForTime, generateDisplaySections } from '@/lib/sectionUtils';
import { format } from 'date-fns';

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
    existingTask
}: AddTaskModalProps) {
    const { sections, addTask, updateTask, currentDate, tasks, tags: tagsList, addTag, projects } = useStore();

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
            updateTask(targetTask.id, {
                title,
                sectionId: activeType === 'task' ? (finalSectionId || (sections[0]?.id || 'section-1')) : 'goal', // Dummy or empty for goals
                projectId: projectId || '',
                milestoneId: milestoneId || undefined,
                estimatedMinutes: activeType === 'task' ? Number(estimatedMinutes) : 0,
                actualMinutes: activeType === 'task' ? Number(actualMinutes) : 0,
                scheduledStart: activeType === 'task' ? (scheduledStart || '') : '',
                date: activeType === 'task' ? date : '',
                assignedDate: activeType === 'daily' ? (assignedDate || currentDate) : undefined,
                assignedWeek: activeType === 'weekly' ? assignedWeek : undefined,
                assignedMonth: activeType === 'monthly' ? assignedMonth : undefined,
                assignedYear: activeType === 'yearly' ? assignedYear : undefined,
                tags: finalTags,
                score: score === '' ? undefined : Number(score),
                memo,
                attachments,
            });
        } else {
            // Calculate new order: max order in this section + 1
            const sectionTasks = tasks.filter(t => t.sectionId === (finalSectionId || ''));
            const maxOrder = sectionTasks.length > 0 ? Math.max(...sectionTasks.map(t => t.order)) : 0;
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
                scheduledStart: activeType === 'task' ? (scheduledStart || '') : '',
                order: newOrder,
                tags: finalTags,
                memo,
                attachments,
                assignedDate: activeType === 'daily' ? (assignedDate || currentDate) : undefined,
                assignedWeek: activeType === 'weekly' ? assignedWeek : undefined,
                assignedMonth: activeType === 'monthly' ? assignedMonth : undefined,
                assignedYear: activeType === 'yearly' ? assignedYear : undefined,
                score: score === '' ? undefined : Number(score),
            };
            console.log("Creating new task:", newTaskPayload);
            addTask(newTaskPayload);
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
        setCurrentTag('');
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
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            placeholder={activeType === 'task' ? "e.g., Check emails" : `e.g., ${activeType} Goal`}
                            autoFocus
                        />
                    </div>

                    {/* Conditional Fields based on Type */}
                    {activeType === 'task' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="date"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    disabled={!date}
                                    className={clsx(
                                        "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900",
                                        !date && "bg-gray-100 text-gray-400"
                                    )}
                                />
                                <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap cursor-pointer hover:text-gray-900 select-none">
                                    <input
                                        type="checkbox"
                                        checked={!date}
                                        onChange={(e) => {
                                            if (e.target.checked) setDate('');
                                            else setDate(currentDate);
                                        }}
                                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                    />
                                    Unscheduled
                                </label>
                            </div>
                        </div>
                    )}

                    {activeType === 'daily' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                            <input
                                type="date"
                                value={assignedDate || currentDate}
                                onChange={(e) => setAssignedDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                    )}

                    {activeType === 'weekly' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Week</label>
                            <input
                                type="week"
                                value={assignedWeek}
                                onChange={(e) => setAssignedWeek(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                    )}

                    {activeType === 'monthly' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Month</label>
                            <input
                                type="month"
                                value={assignedMonth}
                                onChange={(e) => setAssignedMonth(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                    )}

                    {activeType === 'yearly' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Year</label>
                            <input
                                type="number"
                                min="2020"
                                max="2030"
                                value={assignedYear}
                                onChange={(e) => setAssignedYear(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                    )}

                    {activeType === 'task' && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Est. (min)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={estimatedMinutes}
                                        onChange={(e) => setEstimatedMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Act. (min)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={actualMinutes}
                                        onChange={(e) => setActualMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>


                                <select
                                    value={sectionId}
                                    onChange={(e) => {
                                        setSectionId(e.target.value);
                                        // Exclusive Logic: Clear time if section is manually chosen
                                        setScheduledStart('');
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                                >
                                    {displaySections.map((section, index) => {
                                        const endTime = section.endTime || (index < displaySections.length - 1 ? displaySections[index + 1].startTime : '24:00');
                                        return (
                                            <option key={section.id} value={section.id}>
                                                {section.name} ({section.startTime || '00:00'} - {endTime})
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>

                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start Time (Optional)</label>
                                <input
                                    type="time"
                                    value={scheduledStart}
                                    onChange={(e) => setScheduledStart(e.target.value)}
                                    className={clsx(
                                        "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900",
                                        isTimeSectionInconsistent ? "border-yellow-400 bg-yellow-50" : "border-gray-300"
                                    )}
                                />
                                {isTimeSectionInconsistent && (
                                    <p className="mt-1 text-xs text-yellow-700 font-medium">
                                        ⚠️ 時間 ({scheduledStart}) は別のセクション範囲外です
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Project Selector - Now common for all types */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project (Optional)</label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                        >
                            <option value="">No Project</option>
                            {projects.filter(p => p.status !== 'archived' || p.id === projectId).map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Milestone Selector (Conditional) */}
                    {(() => {
                        const selectedProject = projects.find(p => p.id === projectId);
                        if (selectedProject?.milestones && selectedProject.milestones.length > 0) {
                            return (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
                                    <select
                                        value={milestoneId}
                                        onChange={(e) => setMilestoneId(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                                    >
                                        <option value="">No Schedule</option>
                                        {selectedProject.milestones.map((milestone) => (
                                            <option key={milestone.id} value={milestone.id}>
                                                {milestone.title}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            );
                        }
                        return null;
                    })()}

                    {/* Tags and Score Section */}
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={currentTag}
                                    onChange={(e) => {
                                        setCurrentTag(e.target.value);
                                        setShowSuggestions(true);
                                    }}
                                    onFocus={() => setShowSuggestions(true)}
                                    onKeyDown={handleAddTag}
                                    onCompositionStart={() => setIsComposing(true)}
                                    onCompositionEnd={() => setIsComposing(false)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400"
                                    placeholder="Type tag and press Enter"
                                    enterKeyHint="enter"
                                />
                                {showSuggestions && currentTag && filteredTags.length > 0 && (
                                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                        {filteredTags.map(tag => (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => addTagToTask(tag)}
                                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {tags.map(tag => (
                                        <span key={tag} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                            {tag}
                                            <button
                                                type="button"
                                                onClick={() => removeTag(tag)}
                                                className="ml-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                            >
                                                <X size={12} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="w-24">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Score</label>
                            <input
                                type="number"
                                value={score}
                                onChange={(e) => setScore(e.target.value === '' ? '' : Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                                placeholder="0"
                            />
                        </div>
                    </div>

                    {/* Memo Section */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Memo (Markdown)</label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 min-h-[100px] font-mono text-sm"
                            placeholder="Add notes, meeting minutes..."
                        />
                    </div>

                    {/* Attachments Section */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Attachments</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map((att) => (
                                <div key={att.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                                    <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveAttachment(att.id)}
                                        className="absolute top-1 right-1 bg-black/50 text-white p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                            {isUploading && (
                                <div className="w-20 h-20 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
                                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                            <label className="w-20 h-20 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 cursor-pointer transition-colors">
                                <span className="text-2xl text-gray-400">+</span>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleFileSelect}
                                    disabled={isUploading}
                                />
                            </label>
                        </div>
                        <p className="text-xs text-gray-400">Supported images (Max 5MB). Auto-compressed.</p>
                    </div>

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
