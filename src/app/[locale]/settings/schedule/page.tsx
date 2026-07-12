'use client';

import { useState, useEffect } from 'react';
import { useStore } from '@/store/useStore';
import type { SectionReferenceCounts } from '@/store/types';
import { Section } from '@/types';
import { Plus, Trash2, Save, Loader2, Clock, AlertTriangle } from 'lucide-react';
import SettingsLayout from '@/components/SettingsLayout';

// 削除保留中のセクション（インライン確認UI用）
interface PendingDelete {
    section: Section;
    counts: SectionReferenceCounts;
    // 参照タスク/ルーチンの移動先。'' はセクションなし（ルーチンが無い場合のみ選択可）。
    target: string;
}

// sections.name は unique (user_id, name) 制約があるため、追加時に必ず一意な名前を生成する。
function generateUniqueSectionName(existingNames: string[]) {
    const base = '新しいセクション';
    const taken = new Set(existingNames);
    if (!taken.has(base)) {
        return base;
    }
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`)) {
        suffix += 1;
    }
    return `${base} ${suffix}`;
}

function toErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

export default function ScheduleSettingsPage() {
    const { sections, addSection, updateSection, deleteSection, countSectionReferences, user } = useStore();
    const [localSections, setLocalSections] = useState<Section[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    // 削除確認中のセクション（window.confirm はレンダラをブロックするため使わない）
    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
    const [checkingId, setCheckingId] = useState<string | null>(null);
    // 削除確定済みセクション id → 参照行の移動先（null = セクションなし）
    const [deletePlans, setDeletePlans] = useState<Record<string, string | null>>({});

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
        // 既存名（保存済み + 画面上の未保存分）と重複しない名前を付ける
        const existingNames = [...sections, ...localSections].map((section) => section.name);
        const newSection: Section = {
            id: crypto.randomUUID(),
            userId: user?.uid || '',
            name: generateUniqueSectionName(existingNames),
            startTime: '12:00',
            order: localSections.length
        };
        setLocalSections([...localSections, newSection]);
    };

    // ローカルの一覧から取り除く（DBへの反映は保存時）
    const removeLocally = (sectionId: string) => {
        setLocalSections((current) => current.filter((section) => section.id !== sectionId));
    };

    // 参照行の移動先候補。
    //  - ストアの sections ではなく localSections を見る。既に削除予定にした（＝画面から消えた）
    //    セクションを移動先に選べてしまうと、保存時に「削除済みセクションへ移動」＝FK違反になる。
    //  - 未保存の新規セクションも候補に含める。handleSave は「追加/更新 → 削除」の順で実行するため、
    //    保存時点では実在する。
    const getMoveTargets = (sectionId: string) =>
        localSections.filter((item) => item.id !== sectionId && !(item.id in deletePlans));

    const handleDeleteClick = async (section: Section) => {
        setMessage(null);

        // 未保存（DB未登録）のセクションは参照が存在しないのでそのまま削除
        const isPersisted = sections.some((item) => item.id === section.id);
        if (!isPersisted) {
            removeLocally(section.id);
            return;
        }

        setCheckingId(section.id);
        try {
            const counts = await countSectionReferences(section.id);
            if (counts.tasks === 0 && counts.routines === 0) {
                setDeletePlans((current) => ({ ...current, [section.id]: null }));
                removeLocally(section.id);
                return;
            }

            // 参照行がある場合は移動先を選ばせる。ルーチンはセクション必須のため
            // 「セクションなし」は選べない（デフォルトは先頭の他セクション）。
            const candidates = getMoveTargets(section.id);
            if (counts.routines > 0 && candidates.length === 0) {
                setMessage({
                    type: 'error',
                    text: `「${section.name}」には${counts.routines}件のルーチンが紐づいており、移動先のセクションがありません。先に「セクションを追加」で移動先を作成してください。`,
                });
                return;
            }

            const defaultTarget = counts.routines > 0
                ? (candidates[0]?.id ?? '')
                : '';
            setPendingDelete({ section, counts, target: defaultTarget });
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: `削除の確認に失敗しました（${section.name}）: ${toErrorMessage(error)}` });
        } finally {
            setCheckingId(null);
        }
    };

    const handleConfirmDelete = () => {
        if (!pendingDelete) return;
        const { section, counts, target } = pendingDelete;

        if (counts.routines > 0 && !target) {
            setMessage({ type: 'error', text: 'ルーチンの移動先セクションを選択してください。' });
            return;
        }

        // 移動先が（別の削除操作などで）候補から外れていないか最終確認する
        if (target && !getMoveTargets(section.id).some((item) => item.id === target)) {
            setMessage({ type: 'error', text: '選択した移動先セクションは利用できません。別の移動先を選択してください。' });
            return;
        }

        setDeletePlans((current) => ({ ...current, [section.id]: target || null }));
        removeLocally(section.id);
        setPendingDelete(null);
    };

    const handleSave = async () => {
        setIsSaving(true);
        setMessage(null);
        setPendingDelete(null);

        // 削除されたセクションを検出
        const originalIds = sections.map(s => s.id);
        const currentIds = localSections.map(s => s.id);
        const deletedIds = originalIds.filter(id => !currentIds.includes(id));

        // 失敗はセクション単位で収集し、1件でもあれば成功メッセージは出さない
        const failures: string[] = [];
        // 追加/更新に失敗した id（削除の移動先として使えない）
        const failedSectionIds = new Set<string>();

        // 追加・更新を先に実行する。
        // 未保存の新規セクションを削除の移動先に選べるようにするため、削除より前に実体化させる必要がある。
        for (const section of localSections) {
            const original = sections.find(s => s.id === section.id);
            try {
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
            } catch (e) {
                console.error(e);
                failedSectionIds.add(section.id);
                failures.push(`「${section.name}」の${original ? '更新' : '追加'}: ${toErrorMessage(e)}`);
            }
        }

        // 削除実行（成功した id だけ後で deletePlans から取り除く）
        const deletedOkIds: string[] = [];
        for (const id of deletedIds) {
            const name = sections.find(s => s.id === id)?.name ?? id;
            const target = deletePlans[id] ?? null;

            // 移動先の追加/更新が失敗している場合、削除すると存在しないセクションへ
            // 移動しようとして FK 違反になる。移動先の選択を残したまま中止する。
            if (target && failedSectionIds.has(target)) {
                failures.push(`「${name}」の削除: 移動先セクションの保存に失敗したため中止しました。`);
                continue;
            }

            try {
                await deleteSection(id, target);
                deletedOkIds.push(id);
            } catch (e) {
                console.error(e);
                failures.push(`「${name}」の削除: ${toErrorMessage(e)}`);
            }
        }

        // 成功した削除の計画のみ破棄する。失敗した分を消すと、再表示されたセクションから
        // ユーザーが選んだ移動先が失われてしまう。
        if (deletedOkIds.length > 0) {
            setDeletePlans((current) => {
                const next = { ...current };
                for (const id of deletedOkIds) delete next[id];
                return next;
            });
        }

        if (failures.length > 0) {
            setMessage({ type: 'error', text: `保存に失敗しました。${failures.join(' / ')}` });

            // ストアの最新状態へ戻す。ただし削除に失敗した（＝計画が残っている）セクションは
            // 「削除待ち」のまま一覧から外しておく。移動先の選択も保持されるので、
            // もう一度「保存」を押すだけで同じ移動先で削除を再試行できる。
            const pendingDeleteIds = new Set(
                Object.keys(deletePlans).filter((id) => !deletedOkIds.includes(id))
            );
            const restored: Section[] = JSON.parse(JSON.stringify(useStore.getState().sections));
            setLocalSections(restored.filter((section) => !pendingDeleteIds.has(section.id)));
        } else {
            setMessage({ type: 'success', text: '設定を保存しました。' });
            setHasChanges(false);
        }

        setIsSaving(false);
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
                                <div key={section.id || index} className="space-y-2">
                                    <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
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
                                            onClick={() => handleDeleteClick(section)}
                                            disabled={checkingId === section.id}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                            title="セクションを削除"
                                        >
                                            {checkingId === section.id
                                                ? <Loader2 size={18} className="animate-spin" />
                                                : <Trash2 size={18} />}
                                        </button>
                                    </div>

                                    {/* 参照行がある場合の削除確認（window.confirm は使わない） */}
                                    {pendingDelete?.section.id === section.id && (
                                        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                                                <p className="text-sm text-amber-800">
                                                    「{section.name}」には
                                                    タスク{pendingDelete.counts.tasks}件・ルーチン{pendingDelete.counts.routines}件
                                                    が紐づいています。削除するには移動先を選択してください。
                                                </p>
                                            </div>

                                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                                <label className="text-xs font-semibold text-amber-800 uppercase shrink-0">
                                                    移動先
                                                </label>
                                                <select
                                                    value={pendingDelete.target}
                                                    onChange={(e) => setPendingDelete({ ...pendingDelete, target: e.target.value })}
                                                    className="flex-1 px-3 py-2 text-sm text-gray-900 bg-white border border-amber-300 rounded-lg focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-colors"
                                                >
                                                    {/* ルーチンはセクション必須のため「セクションなし」は出さない */}
                                                    {pendingDelete.counts.routines === 0 && (
                                                        <option value="">セクションなし（タスクをバックログへ）</option>
                                                    )}
                                                    {/* 移動先は画面上のセクション（＝保存後に実在するもの）から選ぶ */}
                                                    {getMoveTargets(section.id).map((item) => (
                                                        <option key={item.id} value={item.id}>{item.name}</option>
                                                    ))}
                                                </select>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        onClick={() => setPendingDelete(null)}
                                                        className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                                    >
                                                        キャンセル
                                                    </button>
                                                    <button
                                                        onClick={handleConfirmDelete}
                                                        className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-colors"
                                                    >
                                                        移動して削除
                                                    </button>
                                                </div>
                                            </div>

                                            <p className="text-xs text-amber-700">
                                                ※ 実際の削除は「保存」ボタンを押したときに実行されます。
                                            </p>
                                        </div>
                                    )}
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
