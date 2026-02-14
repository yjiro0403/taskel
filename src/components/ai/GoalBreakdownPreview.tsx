'use client';

import React, { useState } from 'react';
import { Target, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskCandidate } from '@/lib/ai/types';

interface GoalBreakdownPreviewProps {
  /** 分解元のGoal情報（breakdownGoalツール結果から） */
  sourceGoal: {
    id: string;
    title: string;
    type: string;
  };
  /** 分解されたタスク候補群（fromGoalBreakdown=trueのTaskCandidates） */
  candidates: TaskCandidate[];
  /** 選択した候補を一括確認 */
  onConfirmSelected: (tempIds: string[]) => void;
  /** 全候補を一括破棄 */
  onDismissAll: (tempIds: string[]) => void;
  /** 個別候補の編集 */
  onEditCandidate: (tempId: string, updates: Partial<TaskCandidate>) => void;
}

export const GoalBreakdownPreview: React.FC<GoalBreakdownPreviewProps> = ({
  sourceGoal,
  candidates,
  onConfirmSelected,
  onDismissAll,
  onEditCandidate,
}) => {
  // デフォルトで全選択
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(candidates.map(c => c.tempId))
  );

  // 全候補がconfirmed/dismissedなら非表示
  const activeCandidates = candidates.filter(c => c.status === 'pending');
  if (activeCandidates.length === 0) return null;

  const selectedCandidates = activeCandidates.filter(c => selectedIds.has(c.tempId));
  const totalEstimated = selectedCandidates.reduce(
    (sum, c) => sum + c.estimatedMinutes, 0
  );

  const toggleSelection = (tempId: string) => {
    const next = new Set(selectedIds);
    if (next.has(tempId)) {
      next.delete(tempId);
    } else {
      next.add(tempId);
    }
    setSelectedIds(next);
  };

  const handleConfirmSelected = () => {
    const ids = activeCandidates
      .filter(c => selectedIds.has(c.tempId))
      .map(c => c.tempId);
    onConfirmSelected(ids);
  };

  const handleDismissAll = () => {
    onDismissAll(activeCandidates.map(c => c.tempId));
  };

  return (
    <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-indigo-700 font-medium">
        <Target size={16} />
        <span className="text-sm">目標分解: 「{sourceGoal.title}」</span>
      </div>

      {/* 合計見積もり */}
      <div className="text-xs text-zinc-500">
        選択中: {selectedCandidates.length}/{activeCandidates.length}件 |
        合計見積もり: {totalEstimated}分（{Math.round(totalEstimated / 60 * 10) / 10}時間）
      </div>

      {/* タスク候補リスト */}
      <div className="space-y-1">
        {activeCandidates.map((c, idx) => (
          <div
            key={c.tempId}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded text-sm",
              "hover:bg-indigo-100 transition-colors"
            )}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(c.tempId)}
              onChange={() => toggleSelection(c.tempId)}
              className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-zinc-500 text-xs min-w-[20px]">{idx + 1}.</span>
            <span className="flex-1 text-zinc-900">{c.title}</span>
            <span className="text-zinc-500 text-xs">{c.date}</span>
            <span className="text-zinc-500 text-xs">{c.estimatedMinutes}分</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleConfirmSelected}
          disabled={selectedCandidates.length === 0}
          className={cn(
            "flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors",
            selectedCandidates.length > 0
              ? "bg-indigo-600 hover:bg-indigo-700 text-white"
              : "bg-zinc-200 text-zinc-400 cursor-not-allowed"
          )}
        >
          <Check size={14} />
          選択を作成 ({selectedCandidates.length}件)
        </button>
        <button
          onClick={handleDismissAll}
          className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded text-sm transition-colors"
        >
          <X size={14} />
          すべてキャンセル
        </button>
      </div>
    </div>
  );
};
