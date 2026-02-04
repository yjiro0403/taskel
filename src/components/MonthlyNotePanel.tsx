'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { useDebouncedCallback } from 'use-debounce';

interface Props {
    monthId: string;
}

export default function MonthlyNotePanel({ monthId }: Props) {
    const { monthlyNotes, saveMonthlyNote } = useStore();
    const [content, setContent] = useState('');

    // Load content when monthId changes
    useEffect(() => {
        const note = monthlyNotes.find(n => n.id === monthId);
        setContent(note?.content || '');
    }, [monthId, monthlyNotes]);

    const debouncedSave = useDebouncedCallback((val: string) => {
        saveMonthlyNote(monthId, val);
    }, 1000);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setContent(val);
        debouncedSave(val);
    };

    return (
        <div className="h-full flex flex-col">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Monthly Notes</h3>
            <div className="flex-1 border border-blue-200 rounded-xl overflow-hidden shadow-sm bg-white hover:border-blue-300 transition-colors">
                <textarea
                    value={content}
                    onChange={handleChange}
                    placeholder="Write your monthly Review, Plans, or Thoughts here..."
                    className="w-full h-full p-4 resize-none focus:outline-none text-gray-700 text-sm leading-relaxed"
                />
            </div>
        </div>
    );
}
