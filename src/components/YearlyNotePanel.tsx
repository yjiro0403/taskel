'use client';

import { useStore } from '@/store/useStore';
import { useState, useEffect } from 'react';

export default function YearlyNotePanel({ yearId }: { yearId: string }) {
    const { yearlyNotes, saveYearlyNote } = useStore();
    const [content, setContent] = useState('');

    useEffect(() => {
        const note = yearlyNotes.find(n => n.id === yearId);
        setContent(note?.content || '');
    }, [yearId, yearlyNotes]);

    const handleSave = async () => {
        await saveYearlyNote(yearId, content);
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-700">Yearly Note</h3>
                <span className="text-xs text-gray-400">Markdown supported</span>
            </div>
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onBlur={handleSave}
                placeholder={`Reflections and high-level notes for ${yearId}...`}
                className="flex-1 w-full p-3 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
            />
        </div>
    );
}
