'use client';

import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';

import { X } from 'lucide-react';

interface TaskTagSelectorProps {
    currentTag: string;
    setCurrentTag: Dispatch<SetStateAction<string>>;
    showSuggestions: boolean;
    setShowSuggestions: Dispatch<SetStateAction<boolean>>;
    handleAddTag: (event: KeyboardEvent) => void;
    setIsComposing: Dispatch<SetStateAction<boolean>>;
    filteredTags: string[];
    addTagToTask: (tag: string) => void;
    tags: string[];
    removeTag: (tag: string) => void;
    score: number | string;
    setScore: Dispatch<SetStateAction<number | string>>;
}

export function TaskTagSelector({
    currentTag,
    setCurrentTag,
    showSuggestions,
    setShowSuggestions,
    handleAddTag,
    setIsComposing,
    filteredTags,
    addTagToTask,
    tags,
    removeTag,
    score,
    setScore,
}: TaskTagSelectorProps) {
    return (
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
                            {filteredTags.map((tag) => (
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
                        {tags.map((tag) => (
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
    );
}
