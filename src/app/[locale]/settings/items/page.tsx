'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { ItemTemplate } from '@/types';
import { Plus, Trash2, Save, Loader2, ListChecks } from 'lucide-react';
import SettingsLayout from '@/components/SettingsLayout';

// 編集用のローカル表現。items はテキストエリアで1行1項目として編集する。
interface EditableTemplate {
    id: string;
    name: string;
    itemsText: string;
    isNew: boolean;
}

function toEditable(template: ItemTemplate): EditableTemplate {
    return {
        id: template.id,
        name: template.name,
        itemsText: template.items.join('\n'),
        isNew: false,
    };
}

function parseItemsText(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

export default function ItemTemplateSettingsPage() {
    const { itemTemplates, addItemTemplate, updateItemTemplate, deleteItemTemplate, user } = useStore();
    const [localTemplates, setLocalTemplates] = useState<EditableTemplate[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        setLocalTemplates(itemTemplates.map(toEditable));
    }, [itemTemplates]);

    useEffect(() => {
        // 変更検知
        const original = itemTemplates.map(toEditable);
        setHasChanges(JSON.stringify(localTemplates) !== JSON.stringify(original));
    }, [localTemplates, itemTemplates]);

    const handleUpdate = (index: number, field: 'name' | 'itemsText', value: string) => {
        const next = [...localTemplates];
        next[index] = { ...next[index], [field]: value };
        setLocalTemplates(next);
    };

    const handleAdd = () => {
        setLocalTemplates([
            ...localTemplates,
            {
                id: crypto.randomUUID(),
                name: '新しいテンプレート',
                itemsText: '',
                isNew: true,
            },
        ]);
    };

    const handleDelete = (index: number) => {
        setLocalTemplates(localTemplates.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        setMessage(null);
        try {
            // 削除されたテンプレートを検出
            const originalIds = itemTemplates.map((template) => template.id);
            const currentIds = localTemplates.map((template) => template.id);
            const deletedIds = originalIds.filter((id) => !currentIds.includes(id));

            for (const id of deletedIds) {
                if (!(await deleteItemTemplate(id))) {
                    throw new Error('delete failed');
                }
            }

            // 更新・追加実行
            for (const template of localTemplates) {
                const items = parseItemsText(template.itemsText);
                const original = itemTemplates.find((entry) => entry.id === template.id);

                if (!original) {
                    const created = await addItemTemplate({
                        id: template.id,
                        userId: user.uid,
                        name: template.name.trim() || '無題のテンプレート',
                        items,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    });
                    if (!created) throw new Error('create failed');
                } else if (
                    original.name !== template.name ||
                    JSON.stringify(original.items) !== JSON.stringify(items)
                ) {
                    const updated = await updateItemTemplate(template.id, {
                        name: template.name.trim() || '無題のテンプレート',
                        items,
                    });
                    if (!updated) throw new Error('update failed');
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
                        <h2 className="text-xl font-bold text-gray-900 mb-1">持ち物テンプレート</h2>
                        <p className="text-sm text-gray-500">
                            毎回持っていくものをテンプレートにしておくと、タスクの持ち物リストへワンクリックで追加できます。
                        </p>
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

                {/* テンプレート一覧 */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <ListChecks size={20} className="text-gray-600" />
                            <h3 className="font-semibold text-gray-900">テンプレート一覧</h3>
                        </div>
                    </div>

                    <div className="p-6 space-y-4">
                        {localTemplates.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">
                                テンプレートがありません。「追加」ボタンで作成してください。
                            </p>
                        ) : (
                            localTemplates.map((template, index) => (
                                <div
                                    key={template.id}
                                    className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100"
                                >
                                    <div className="flex-1 space-y-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                                                テンプレート名
                                            </label>
                                            <input
                                                type="text"
                                                value={template.name}
                                                onChange={(e) => handleUpdate(index, 'name', e.target.value)}
                                                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors"
                                                placeholder="例: 現場セット"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                                                持ち物（1行に1つ）
                                            </label>
                                            <textarea
                                                value={template.itemsText}
                                                onChange={(e) => handleUpdate(index, 'itemsText', e.target.value)}
                                                rows={Math.max(3, template.itemsText.split('\n').length)}
                                                className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-colors resize-y"
                                                placeholder={'例:\n充電器\nノートPC\n名刺'}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(index)}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="テンプレートを削除"
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
                            <span>テンプレートを追加</span>
                        </button>
                    </div>
                </div>
            </div>
        </SettingsLayout>
    );
}
