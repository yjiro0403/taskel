'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { Section } from '@/types';
import { Plus, Trash2, Save, Loader2, Clock } from 'lucide-react';
import SettingsLayout from '@/components/SettingsLayout';

export default function ScheduleSettingsPage() {
    const { sections, addSection, updateSection, deleteSection, user } = useStore();
    const [localSections, setLocalSections] = useState<Section[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        setLocalSections(JSON.parse(JSON.stringify(sections)));
    }, [sections]);

    useEffect(() => {
        // 変更検知
        const hasChanged = JSON.stringify(localSections) !== JSON.stringify(sections);
        setHasChanges(hasChanged);
    }, [localSections, sections]);

    const handleUpdate = (index: number, field: keyof Section, value: string) => {
        const newSections = [...localSections];
        newSections[index] = { ...newSections[index], [field]: value };
        setLocalSections(newSections);
    };

    const handleAdd = () => {
        const newSection: Section = {
            id: crypto.randomUUID(),
            userId: user?.uid || '',
            name: '新しいセクション',
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
        setMessage(null);
        try {
            // 削除されたセクションを検出
            const originalIds = sections.map(s => s.id);
            const currentIds = localSections.map(s => s.id);
            const deletedIds = originalIds.filter(id => !currentIds.includes(id));

            // 削除実行
            for (const id of deletedIds) {
                await deleteSection(id);
            }

            // 更新・追加実行
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

            setMessage({ type: 'success', text: '設定を保存しました。' });
            setHasChanges(false);
        } catch (e) {
            console.error(e);
            setMessage({ type: 'error', text: '保存に失敗しました。' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <SettingsLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 mb-1">セクション設定</h2>
                        <p className="text-sm text-gray-500">1日のスケジュールを区切るセクションを管理できます。</p>
                    </div>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        保存
                    </button>
                </div>

                {message && (
                    <div className={`px-4 py-3 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* セクション一覧 */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Clock size={20} className="text-gray-600" />
                            <h3 className="font-semibold text-gray-900">セクション一覧</h3>
                        </div>
                    </div>

                    <div className="p-6 space-y-4">
                        {localSections.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">
                                セクションがありません。「追加」ボタンで作成してください。
                            </p>
                        ) : (
                            localSections.map((section, index) => (
                                <div
                                    key={section.id || index}
                                    className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100"
                                >
                                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                                                セクション名
                                            </label>
                                            <input
                                                type="text"
                                                value={section.name}
                                                onChange={(e) => handleUpdate(index, 'name', e.target.value)}
                                                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                                                placeholder="セクション名"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                                                開始時刻
                                            </label>
                                            <input
                                                type="time"
                                                value={section.startTime || ''}
                                                onChange={(e) => handleUpdate(index, 'startTime', e.target.value)}
                                                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(index)}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="セクションを削除"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))
                        )}

                        <button
                            onClick={handleAdd}
                            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/50 transition-colors"
                        >
                            <Plus size={18} />
                            <span>セクションを追加</span>
                        </button>
                    </div>
                </div>
            </div>
        </SettingsLayout>
    );
}
