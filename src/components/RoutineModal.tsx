'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Routine, Frequency } from '@/types';
import { format } from 'date-fns';

interface RoutineModalProps {
    isOpen: boolean;
    onClose: () => void;
    editRoutine?: Routine;
}

export default function RoutineModal({ isOpen, onClose, editRoutine }: RoutineModalProps) {
    const { addRoutine, updateRoutine, user, sections, projects, tags: tagsList, addTag } = useStore();
    const [title, setTitle] = useState('');
    const [frequency, setFrequency] = useState<Frequency>('daily');
    const [sectionId, setSectionId] = useState('');
    const [projectId, setProjectId] = useState(''); // NEW
    const [estimatedMinutes, setEstimatedMinutes] = useState<number | string>(30);
    const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [startTime, setStartTime] = useState('');
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
    const [tags, setTags] = useState<string[]>([]); // NEW
    const [currentTag, setCurrentTag] = useState(''); // NEW
    const [showSuggestions, setShowSuggestions] = useState(false); // NEW
    const [memo, setMemo] = useState(''); // NEW
    const [isComposing, setIsComposing] = useState(false); // NEW


    useEffect(() => {
        if (editRoutine) {
            setTitle(editRoutine.title);
            setFrequency(editRoutine.frequency);
            setSectionId(editRoutine.sectionId);
            setProjectId(editRoutine.projectId || ''); // NEW
            setEstimatedMinutes(editRoutine.estimatedMinutes !== undefined ? editRoutine.estimatedMinutes : 30);
            setStartDate(editRoutine.startDate || editRoutine.nextRun);
            setStartTime(editRoutine.startTime || '');
            setDaysOfWeek(editRoutine.daysOfWeek || []);
            setTags(editRoutine.tags || []); // NEW
            setMemo(editRoutine.memo || ''); // NEW

        } else {
            // Defaults
            setTitle('');
            setFrequency('daily');
            setSectionId(sections[0]?.id || '');
            setProjectId(''); // NEW
            setEstimatedMinutes(30);
            setStartDate(format(new Date(), 'yyyy-MM-dd'));
            setStartTime('');
            setDaysOfWeek([]);
            setTags([]); // NEW
            setMemo(''); // NEW

        }
    }, [editRoutine, isOpen, sections]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        // Handle pending tag
        let finalTags = [...tags];
        if (currentTag.trim() && !tags.includes(currentTag.trim())) {
            finalTags.push(currentTag.trim());
        }

        const routineData: any = {
            title,
            frequency,
            sectionId: sectionId || sections[0]?.id,
            projectId: projectId || undefined, // NEW
            estimatedMinutes: Number(estimatedMinutes),
            startDate,
            startTime: startTime || undefined,
            tags: finalTags.length > 0 ? finalTags : undefined, // NEW
            memo: memo || undefined, // NEW
            active: true
        };


        if (frequency === 'weekly') {
            routineData.daysOfWeek = daysOfWeek;
        }

        if (editRoutine) {
            await updateRoutine(editRoutine.id, routineData);
        } else {
            await addRoutine({
                id: crypto.randomUUID(),
                userId: user.uid,
                ...routineData
            } as Routine);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <h2 className="text-lg font-bold text-gray-800">
                        {editRoutine ? 'Edit Routine' : 'New Routine'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[85vh] overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900"
                            placeholder="e.g., Gym Workout"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                            <select
                                value={frequency}
                                onChange={(e) => setFrequency(e.target.value as Frequency)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Estimate (min)</label>
                            <input
                                type="number"
                                value={estimatedMinutes}
                                onChange={(e) => setEstimatedMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                            />
                        </div>
                    </div>

                    {frequency === 'weekly' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Days of Week</label>
                            <div className="flex justify-between gap-1">
                                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                            const newDays = daysOfWeek.includes(i)
                                                ? daysOfWeek.filter(d => d !== i)
                                                : [...daysOfWeek, i];
                                            setDaysOfWeek(newDays);
                                        }}
                                        className={`w-9 h-9 rounded-full text-sm font-medium transition-colors ${daysOfWeek.includes(i)
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">Daily routines will appear from this date onwards.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                        <select
                            value={sectionId}
                            onChange={(e) => setSectionId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                            {sections.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project (Optional)</label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                            <option value="">No Project</option>
                            {projects.filter(p => p.status !== 'archived' || p.id === projectId).map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.title}
                                </option>
                            ))}
                        </select>
                    </div>


                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Time (Optional)</label>
                        <input
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                        />
                    </div>

                    {/* Tags Section */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {tags.map(tag => (
                                <span key={tag} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                    {tag}
                                    <button
                                        type="button"
                                        onClick={() => setTags(tags.filter(t => t !== tag))}
                                        className="ml-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                    >
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                value={currentTag}
                                onChange={(e) => {
                                    setCurrentTag(e.target.value);
                                    setShowSuggestions(true);
                                }}
                                onFocus={() => setShowSuggestions(true)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (isComposing) return;
                                        if (currentTag.trim() && !tags.includes(currentTag.trim())) {
                                            setTags([...tags, currentTag.trim()]);
                                            setCurrentTag('');
                                            setShowSuggestions(false);
                                        }
                                    }
                                }}
                                onCompositionStart={() => setIsComposing(true)}
                                onCompositionEnd={() => setIsComposing(false)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400"
                                placeholder="Type tag and press Enter"
                                enterKeyHint="enter"
                            />
                            {showSuggestions && currentTag && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                    {tagsList
                                        .filter(t => t.name.toLowerCase().includes(currentTag.toLowerCase()) && !tags.includes(t.name))
                                        .map(tag => (
                                            <button
                                                key={tag.id}
                                                type="button"
                                                onClick={() => {
                                                    setTags([...tags, tag.name]);
                                                    setCurrentTag('');
                                                    setShowSuggestions(false);
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                            >
                                                {tag.name}
                                            </button>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Memo Section */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Memo (Markdown)</label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 min-h-[100px] font-mono text-sm"
                            placeholder="Add notes..."
                        />
                    </div>


                    <div className="pt-2">
                        <button
                            type="submit"
                            className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            {editRoutine ? 'Save Changes' : 'Create Routine'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
