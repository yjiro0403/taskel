'use client';

import { useState } from 'react';
import { ListChecks, Plus, X, BookmarkPlus } from 'lucide-react';
import clsx from 'clsx';
import { ChecklistItem } from '@/types';
import { useStore } from '@/store/useStore';

interface TaskChecklistEditorProps {
    checklist: ChecklistItem[];
    setChecklist: (items: ChecklistItem[]) => void;
}

// タスクの「持ち物リスト」編集セクション（AddTaskModal 内で使用）。
// リスト本体は親のフォーム state として保持し、保存ボタンでタスクと一緒に永続化される。
// テンプレート（itemTemplates）からの一括追加と、現在のリストのテンプレート保存ができる。
export function TaskChecklistEditor({ checklist, setChecklist }: TaskChecklistEditorProps) {
    const { itemTemplates, addItemTemplate, user } = useStore();

    const [newItemName, setNewItemName] = useState('');
    const [isComposing, setIsComposing] = useState(false);
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const [templateName, setTemplateName] = useState('');

    const checkedCount = checklist.filter((item) => item.checked).length;

    const addItem = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        setChecklist([
            ...checklist,
            { id: crypto.randomUUID(), name: trimmed, checked: false },
        ]);
        setNewItemName('');
    };

    const toggleItem = (itemId: string) => {
        setChecklist(
            checklist.map((item) =>
                item.id === itemId ? { ...item, checked: !item.checked } : item
            )
        );
    };

    const removeItem = (itemId: string) => {
        setChecklist(checklist.filter((item) => item.id !== itemId));
    };

    // テンプレートの持ち物を追加する。既にリストにある名前（trim一致）は重複させない。
    const applyTemplate = (templateId: string) => {
        const template = itemTemplates.find((entry) => entry.id === templateId);
        if (!template) return;

        const existingNames = new Set(checklist.map((item) => item.name.trim()));
        const additions = template.items
            .map((name) => name.trim())
            .filter((name) => name && !existingNames.has(name))
            .map((name) => ({ id: crypto.randomUUID(), name, checked: false }));

        if (additions.length > 0) {
            setChecklist([...checklist, ...additions]);
        }
    };

    const saveAsTemplate = async () => {
        const name = templateName.trim();
        if (!name || checklist.length === 0 || !user) return;

        const saved = await addItemTemplate({
            id: crypto.randomUUID(),
            userId: user.uid,
            name,
            items: checklist.map((item) => item.name),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        if (saved) {
            setTemplateName('');
            setShowSaveTemplate(false);
        }
    };

    return (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <ListChecks size={14} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-600">持ち物リスト</span>
                {checklist.length > 0 && (
                    <span
                        className={clsx(
                            'text-[10px]',
                            checkedCount === checklist.length ? 'text-green-600' : 'text-gray-400'
                        )}
                    >
                        ({checkedCount}/{checklist.length})
                    </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {itemTemplates.length > 0 && (
                        <select
                            value=""
                            onChange={(e) => {
                                if (e.target.value) applyTemplate(e.target.value);
                                e.target.value = '';
                            }}
                            className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white text-gray-600 outline-none focus:border-blue-500"
                        >
                            <option value="">テンプレートから追加...</option>
                            {itemTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                    {template.name}（{template.items.length}点）
                                </option>
                            ))}
                        </select>
                    )}
                    {checklist.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowSaveTemplate(!showSaveTemplate)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                            title="このリストをテンプレートとして保存"
                        >
                            <BookmarkPlus size={13} />
                        </button>
                    )}
                </div>
            </div>

            <div className="p-3 space-y-2">
                {showSaveTemplate && (
                    <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                        <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (!isComposing) void saveAsTemplate();
                                }
                            }}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            placeholder="テンプレート名（例: 現場セット）"
                            className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded-md bg-white text-gray-900 outline-none focus:border-blue-500"
                        />
                        <button
                            type="button"
                            onClick={() => void saveAsTemplate()}
                            disabled={!templateName.trim()}
                            className="px-2 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            保存
                        </button>
                    </div>
                )}

                {checklist.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 group">
                        <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => toggleItem(item.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span
                            className={clsx(
                                'flex-1 text-sm',
                                item.checked ? 'text-gray-400 line-through' : 'text-gray-800'
                            )}
                        >
                            {item.name}
                        </span>
                        <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            title="削除"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}

                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        onKeyDown={(e) => {
                            // IME変換確定のEnterでは追加しない（タグ入力と同じ扱い）
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (!isComposing) addItem(newItemName);
                            }
                        }}
                        onCompositionStart={() => setIsComposing(true)}
                        onCompositionEnd={() => setIsComposing(false)}
                        placeholder="持ち物を追加（例: 充電器）"
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-md text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                    <button
                        type="button"
                        onClick={() => addItem(newItemName)}
                        disabled={!newItemName.trim()}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors"
                        title="追加"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
