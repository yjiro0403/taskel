'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Tag } from '@/types';
import { X } from 'lucide-react';

interface TagModalProps {
    isOpen: boolean;
    onClose: () => void;
    tagId: string | null;
}

export default function TagModal({ isOpen, onClose, tagId }: TagModalProps) {
    const { tags, updateTag, deleteTag } = useStore();
    const tag = tags.find(t => t.id === tagId);

    const [name, setName] = useState('');
    const [memo, setMemo] = useState('');

    useEffect(() => {
        if (tag) {
            setName(tag.name);
            setMemo(tag.memo || '');
        }
    }, [tag, isOpen]);

    if (!isOpen || !tag) return null;

    const handleSave = () => {
        if (!tagId) return;
        updateTag(tagId, { name, memo });
        onClose();
    };

    const handleDelete = async () => {
        if (confirm('Are you sure you want to delete this tag? This will remove it from global management, but tasks may still reference the ID until updated.')) {
            if (tagId) await deleteTag(tagId);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center p-4 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-800">Edit Tag</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Tag Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Memo (Markdown)</label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 min-h-[150px] font-mono text-sm"
                            placeholder="Add links, descriptions, etc..."
                        />
                    </div>

                    <div className="flex justify-between pt-2">
                        <button
                            onClick={handleDelete}
                            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm"
                        >
                            Delete Tag
                        </button>
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
