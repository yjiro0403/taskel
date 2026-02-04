'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Section } from '@/types';
import { X, Plus, Trash2, Save } from 'lucide-react';

interface SectionSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SectionSettingsModal({ isOpen, onClose }: SectionSettingsModalProps) {
    const { sections, addSection, updateSection, deleteSection, user } = useStore();
    const [localSections, setLocalSections] = useState<Section[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLocalSections(JSON.parse(JSON.stringify(sections)));
        }
    }, [isOpen, sections]);

    const handleUpdate = (index: number, field: keyof Section, value: string) => {
        const newSections = [...localSections];
        newSections[index] = { ...newSections[index], [field]: value };
        setLocalSections(newSections);
    };

    const handleAdd = () => {
        const newSection: Section = {
            id: crypto.randomUUID(), // Temp ID, will be replaced or used
            userId: user?.uid || '',
            name: 'New Section',
            startTime: '12:00',
            order: localSections.length
        };
        setLocalSections([...localSections, newSection]);
    };

    const handleDelete = (index: number) => {
        const newSections = localSections.filter((_, i) => i !== index);
        setLocalSections(newSections);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Check for deletions
            const originalIds = sections.map(s => s.id);
            const currentIds = localSections.map(s => s.id);
            const deletedIds = originalIds.filter(id => !currentIds.includes(id));

            // Execute deletions
            for (const id of deletedIds) {
                await deleteSection(id);
            }

            // Execute updates/adds
            for (const section of localSections) {
                const original = sections.find(s => s.id === section.id);
                if (!original) {
                    await addSection(section);
                } else if (JSON.stringify(original) !== JSON.stringify(section)) {
                    await updateSection(section.id, {
                        name: section.name,
                        startTime: section.startTime,
                        endTime: section.endTime,
                        order: section.order
                    });
                }
            }
            onClose();
        } catch (e) {
            console.error(e);
            alert('Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
                className="fixed inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden relative z-10 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50">
                    <h2 className="font-semibold text-gray-800">Section Settings</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full text-gray-400">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 max-h-[60vh] overflow-y-auto">
                    <div className="space-y-3">
                        {localSections.map((section, index) => (
                            <div key={section.id || index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-gray-700 uppercase w-16">Name</label>
                                        <input
                                            type="text"
                                            value={section.name}
                                            onChange={(e) => handleUpdate(index, 'name', e.target.value)}
                                            className="flex-1 text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-1 text-gray-900 bg-white"
                                            placeholder="Section Name"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-bold text-gray-700 uppercase w-16">Start</label>
                                        <input
                                            type="time"
                                            value={section.startTime || ''}
                                            onChange={(e) => handleUpdate(index, 'startTime', e.target.value)}
                                            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-1 text-gray-900 bg-white"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDelete(index)}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Delete Section"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleAdd}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500 transition-colors bg-gray-50/50"
                    >
                        <Plus size={18} />
                        <span>Add New Section</span>
                    </button>
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                        <Save size={16} />
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    );
}
