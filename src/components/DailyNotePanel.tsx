'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';

export default function DailyNotePanel() {
    const { dailyNotes, saveDailyNote, currentDate } = useStore();
    const [isOpen, setIsOpen] = useState(false);
    const [noteContent, setNoteContent] = useState('');
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sync local content with store
    useEffect(() => {
        const note = dailyNotes.find(n => n.id === currentDate);
        setNoteContent(note?.content || '');
    }, [dailyNotes, currentDate]);

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

    return (
        <div className="border-b border-gray-200 bg-white shadow-sm mb-4 rounded-lg overflow-hidden border border-gray-200">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-2 text-gray-700 font-medium">
                    <FileText size={18} className="text-blue-600" />
                    <span>Daily Note</span>
                    <span className="text-xs text-gray-400 font-normal ml-2">
                        {currentDate}
                    </span>
                    {isOpen && (
                        <span className="text-xs text-gray-400 italic font-normal ml-auto mr-2">
                            Auto-saving...
                        </span>
                    )}
                </div>
                {isOpen ? <ChevronUp size={18} className="text-gray-500" /> : <ChevronDown size={18} className="text-gray-500" />}
            </button>

            {isOpen && (
                <div className="p-0">
                    <textarea
                        value={noteContent}
                        onChange={handleNoteChange}
                        className="w-full h-40 p-4 resize-y outline-none text-sm text-gray-800 leading-relaxed bg-white block"
                        placeholder={`Write your daily goals, plans, or reflections for ${currentDate}... (Markdown supported)`}
                    />
                </div>
            )}
        </div>
    );
}
