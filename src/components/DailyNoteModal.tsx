'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { FileText, X, Copy, Check } from 'lucide-react';
import { generateDailyReportMarkdown } from '@/lib/reportUtils';
import clsx from 'clsx';

export default function DailyNoteModal() {
    const { dailyNotes, saveDailyNote, currentDate, isDailyNoteModalOpen, toggleDailyNoteModal, tasks } = useStore();
    const [noteContent, setNoteContent] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sync local content with store
    useEffect(() => {
        if (isDailyNoteModalOpen) {
            const note = dailyNotes.find(n => n.id === currentDate);
            setNoteContent(note?.content || '');
        }
    }, [dailyNotes, currentDate, isDailyNoteModalOpen]);

    const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newContent = e.target.value;
        setNoteContent(newContent);

        // Debounced Save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
            saveDailyNote(currentDate, newContent);
        }, 1000);
    };

    const handleCopyReport = async () => {
        // Filter tasks for the current date
        const todaysTasks = tasks.filter(t => t.date === currentDate);

        const markdown = generateDailyReportMarkdown(currentDate, todaysTasks, noteContent);

        try {
            await navigator.clipboard.writeText(markdown);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy report:', err);
            alert('Failed to copy report to clipboard.');
        }
    };

    if (!isDailyNoteModalOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="fixed inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
                onClick={toggleDailyNoteModal}
            />

            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden relative z-10 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2 text-gray-700 font-semibold">
                        <FileText size={20} className="text-blue-600" />
                        <span>Daily Note</span>
                        <span className="text-sm font-normal text-gray-500 ml-2">
                            {currentDate}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-400 italic hidden sm:inline">
                            Auto-saving...
                        </span>

                        <button
                            onClick={handleCopyReport}
                            className={clsx(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                                isCopied
                                    ? "bg-green-100 text-green-700"
                                    : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                            )}
                            title="Copy Daily Report Markdown"
                        >
                            {isCopied ? <Check size={16} /> : <Copy size={16} />}
                            <span>{isCopied ? 'Copied!' : 'Copy Report'}</span>
                        </button>

                        <button
                            onClick={toggleDailyNoteModal}
                            className="p-1 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <textarea
                    value={noteContent}
                    onChange={handleNoteChange}
                    className="w-full h-[60vh] p-6 resize-none outline-none text-base text-gray-800 leading-relaxed"
                    placeholder={`Write your daily goals, plans, or reflections for ${currentDate}...\n(Markdown supported)`}
                    autoFocus
                />
            </div>
        </div>
    );
}
