'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { useDebounce } from 'use-debounce';

interface Props {
    weekId: string;
}

export default function WeeklyNotePanel({ weekId }: Props) {
    const { weeklyNotes, saveWeeklyNote } = useStore();

    // Find existing note
    const existingNote = weeklyNotes.find(n => n.id === weekId);

    const [content, setContent] = useState(existingNote?.content || '');

    // Debounce save
    const [debouncedContent] = useDebounce(content, 1000);

    // Sync state when weekId changes or notes load
    useEffect(() => {
        const note = weeklyNotes.find(n => n.id === weekId);
        setContent(note?.content || '');
    }, [weekId, weeklyNotes]);

    useEffect(() => {
        if (debouncedContent !== (existingNote?.content || '')) {
            saveWeeklyNote(weekId, debouncedContent);
        }
    }, [debouncedContent, weekId, saveWeeklyNote, existingNote?.content]);

    return (
        <div className="flex flex-col h-full bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Weekly Notes
            </h3>
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Reflections, priorities, or scratchpad for the week..."
                className="flex-1 w-full bg-transparent resize-none focus:outline-none text-sm text-gray-700 leading-relaxed placeholder:text-gray-400"
            />
            <div className="text-[10px] text-gray-400 text-right mt-2">
                {debouncedContent === content ? 'Saved' : 'Saving...'}
            </div>
        </div>
    );
}
