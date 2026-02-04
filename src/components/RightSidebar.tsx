'use client';

import { useStore } from '@/store/useStore';
import { Task } from '@/types';
import { X, Calendar, Play, Square, Circle, CheckCircle2, Search, Filter, Tag as TagIcon } from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import AddTaskModal from './AddTaskModal';
import { getSectionForTime } from '@/lib/sectionUtils';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import DraggableUnscheduledTask from './RightSidebarDraggableItem';

export default function RightSidebar() {
    const {
        isRightSidebarOpen,
        toggleRightSidebar,
        tasks,
        updateTask,
        selectedTaskIds,
        toggleTaskSelection,
        projects,
        getUniqueTags // NEW: Get available tags
    } = useStore();
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Filter State
    const [filterText, setFilterText] = useState('');
    const [filterProjectId, setFilterProjectId] = useState<string>('all'); // 'all' | 'no-project' | uuid
    const [filterTags, setFilterTags] = useState<string[]>([]); // NEW: Multi-select tags
    const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false); // Dropdown visibility

    // Sort State
    type SortOption = 'score' | 'date' | 'order';
    const [sortBy, setSortBy] = useState<SortOption>('score');

    if (!isRightSidebarOpen) return null;

    // Filter tasks that have NO date set (empty string or null/undefined)
    const unscheduledTasks = tasks
        .filter(t => !t.date && t.status !== 'done')
        .filter(t => {
            // Text Filter
            if (filterText && !t.title.toLowerCase().includes(filterText.toLowerCase())) {
                return false;
            }
            // Project Filter
            if (filterProjectId === 'no-project') {
                if (t.projectId) return false;
            } else if (filterProjectId !== 'all') {
                if (t.projectId !== filterProjectId) return false;
            }

            // Tag Filter (Multi-select OR logic)
            if (filterTags.length > 0) {
                const hasNoTagFilter = filterTags.includes('no-tag');
                const specificTags = filterTags.filter(tag => tag !== 'no-tag');

                const matchesNoTag = hasNoTagFilter && (!t.tags || t.tags.length === 0);
                const matchesSpecificTag = specificTags.length > 0 && t.tags && t.tags.some(tag => specificTags.includes(tag));

                if (!matchesNoTag && !matchesSpecificTag) {
                    return false;
                }
            }

            return true;
        })
        .sort((t1, t2) => {
            if (sortBy === 'score') {
                // Score Descending (null/0 last)
                const score1 = t1.score || -1; // Treat undefined/0 as -1 for simple comparison if needed, but logic below handles explicit 0/undefined
                const score2 = t2.score || -1;

                // If both have scores > 0, compare properly
                if (score1 > 0 && score2 > 0) {
                    return score2 - score1; // Desc logic
                }
                // If one has score > 0 and other doesn't
                if (score1 > 0 && score2 <= 0) return -1; // t1 first
                if (score1 <= 0 && score2 > 0) return 1;  // t2 first

                // If both are 0/undefined, fall back to Order
                return (t1.order || 0) - (t2.order || 0);

            } else if (sortBy === 'date') {
                // Date Asc (Oldest first)
                // Note: Unscheduled list items usually don't have date, but just in case
                if (t1.date !== t2.date) {
                    return (t1.date || '').localeCompare(t2.date || '');
                }
            }

            // Default / Fallback: Order Asc
            return (t1.order || 0) - (t2.order || 0);
        });

    const uniqueTags = getUniqueTags(); // Get available tags for dropdown

    const toggleTagFilter = (tag: string) => {
        setFilterTags(prev => {
            if (prev.includes(tag)) {
                return prev.filter(t => t !== tag);
            } else {
                return [...prev, tag];
            }
        });
    };

    const clearTagFilters = () => {
        setFilterTags([]);
        setIsTagDropdownOpen(false);
    };

    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingTask(null);
    };

    const handlePlay = (task: Task) => {
        // Start task immediately and move to Today AND Correct Section
        const now = new Date();
        const currentSectionId = getSectionForTime(useStore.getState().sections, now);

        updateTask(task.id, {
            status: 'in_progress',
            startedAt: now.getTime(),
            date: useStore.getState().currentDate, // Assign to today
            sectionId: currentSectionId || task.sectionId // Move to current section if found
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

    return (
        <div className="w-80 h-[calc(100vh-64px)] sticky top-16 bg-white border-l border-gray-200 flex flex-col shadow-xl z-20">
            {/* Header */}
            <div className="flex border-b border-gray-100 bg-gray-50 items-center justify-between p-3">
                <div className="flex items-center gap-2 text-gray-700 font-medium text-sm">
                    <Calendar size={16} />
                    Unscheduled
                    <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                        {unscheduledTasks.length}
                    </span>
                </div>
                <button
                    onClick={toggleRightSidebar}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Filter Bar */}
            <div className="p-2 border-b border-gray-100 space-y-2 bg-white">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
                    <input
                        type="text"
                        placeholder="Search tasks..."
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-gray-50 text-gray-900 placeholder:text-gray-400"
                    />
                </div>

                <div className="flex gap-2">
                    <div className="relative flex-[2]">
                        <Filter className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
                        <select
                            value={filterProjectId}
                            onChange={(e) => setFilterProjectId(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-gray-50 appearance-none cursor-pointer text-gray-900"
                        >
                            <option value="all">All Projects</option>
                            <option value="no-project">No Project</option>
                            {(projects || []).filter(p => p.status !== 'archived').map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.title}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* Explicit Sort Dropdown */}
                    <div className="relative flex-1">
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-gray-50 appearance-none cursor-pointer text-gray-700 font-medium"
                        >
                            <option value="score">Score (High-Low)</option>
                            <option value="date">Date (Oldest)</option>
                            <option value="order">Manual Order</option>
                        </select>
                    </div>
                </div>

                <div className="relative">
                    <button
                        onClick={() => setIsTagDropdownOpen(!isTagDropdownOpen)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-gray-50 text-left text-gray-900 flex items-center justify-between"
                    >
                        <TagIcon className="absolute left-2.5 top-2.5 text-gray-400" size={14} />
                        <span className="truncate">
                            {filterTags.length === 0 ? 'All Tags' : `Selected (${filterTags.length})`}
                        </span>
                    </button>

                    {isTagDropdownOpen && (
                        <>
                            <div
                                className="fixed inset-0 z-30"
                                onClick={() => setIsTagDropdownOpen(false)}
                            />
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-40 max-h-60 overflow-y-auto p-2">
                                <div
                                    className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm text-gray-700"
                                    onClick={() => toggleTagFilter('no-tag')}
                                >
                                    <div className={clsx(
                                        "w-4 h-4 border rounded flex items-center justify-center transition-colors",
                                        filterTags.includes('no-tag') ? "bg-blue-500 border-blue-500 text-white" : "border-gray-300 bg-white"
                                    )}>
                                        {filterTags.includes('no-tag') && <CheckCircle2 size={12} />}
                                    </div>
                                    <span>No Tags</span>
                                </div>
                                {uniqueTags.map(tag => (
                                    <div
                                        key={tag}
                                        className="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer text-sm text-gray-700"
                                        onClick={() => toggleTagFilter(tag)}
                                    >
                                        <div className={clsx(
                                            "w-4 h-4 border rounded flex items-center justify-center transition-colors",
                                            filterTags.includes(tag) ? "bg-blue-500 border-blue-500 text-white" : "border-gray-300 bg-white"
                                        )}>
                                            {filterTags.includes(tag) && <CheckCircle2 size={12} />}
                                        </div>
                                        <span className="truncate">{tag}</span>
                                    </div>
                                ))}
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                    <button
                                        onClick={clearTagFilters}
                                        className="w-full text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 py-1 rounded"
                                    >
                                        Clear Selection
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto bg-gray-50/50 p-2 space-y-2">
                {unscheduledTasks.length === 0 ? (
                    <div className="text-center text-gray-400 text-sm mt-10 p-4">
                        <p>No tasks found.</p>
                        <p className="text-xs mt-2">Adjust your filters or add a new task.</p>
                    </div>
                ) : (
                    unscheduledTasks.map(task => (
                        <DraggableUnscheduledTask
                            key={task.id}
                            task={task}
                            onClick={() => handleEditTask(task)}
                            selectedTaskIds={selectedTaskIds}
                            toggleTaskSelection={toggleTaskSelection}
                            handlePlay={handlePlay}
                            handleStop={handleStop}
                            projects={projects}
                        />
                    ))
                )}
            </div>

            <AddTaskModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                taskToEdit={editingTask}
            />
        </div>
    );
}
