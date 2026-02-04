'use client';

import { useStore } from '@/store/useStore';
import { Trash2, X, CircleArrowRight as MoveIcon, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

export default function SelectionHeader() {
    const { selectedTaskIds, bulkDeleteTasks, bulkUpdateTasks, clearSelection } = useStore();
    const [isDeleting, setIsDeleting] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [targetDate, setTargetDate] = useState('');

    if (selectedTaskIds.length === 0) return null;

    const handleDelete = async () => {
        if (!window.confirm(`Are you sure you want to delete ${selectedTaskIds.length} tasks?`)) return;

        setIsDeleting(true);
        await bulkDeleteTasks(selectedTaskIds);
        setIsDeleting(false);
    };

    const handleDateChange = async () => {
        if (!targetDate) return;
        if (!window.confirm(`Move ${selectedTaskIds.length} tasks to ${targetDate}?`)) return;

        setIsUpdating(true);
        await bulkUpdateTasks(selectedTaskIds, { date: targetDate });
        setIsUpdating(false);
        setTargetDate('');
        clearSelection();
    };

    return (
        <div className="fixed top-16 left-0 right-0 h-14 bg-blue-50/95 backdrop-blur-sm border-b border-blue-100 flex items-center justify-between px-4 z-40 animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-4">
                <button
                    onClick={clearSelection}
                    className="p-2 text-blue-600 hover:bg-blue-100 rounded-full transition-colors"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-2 font-medium text-blue-900">
                    <div className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">
                        {selectedTaskIds.length}
                    </div>
                    <span className="hidden sm:inline">Selected</span>
                </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-blue-100 shadow-sm">
                    <input
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                        className="border-none text-sm text-gray-700 focus:ring-0 py-1"
                    />
                    <button
                        onClick={handleDateChange}
                        disabled={!targetDate || isUpdating}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors disabled:opacity-50"
                        title="Move to date"
                    >
                        <MoveIcon size={18} />
                    </button>
                </div>

                <div className="h-6 w-px bg-blue-200" />

                <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="flex items-center gap-2 text-red-600 hover:bg-red-50 hover:text-red-700 px-3 py-1.5 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
                >
                    <Trash2 size={18} />
                    <span className="hidden sm:inline">Delete</span>
                </button>
            </div>
        </div>
    );
}
