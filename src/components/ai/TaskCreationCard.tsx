'use client';

import React, { useState } from 'react';
import { TaskCandidate, GoalSummary } from '@/lib/ai/types';
import { Sparkles, Check, X, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { GoalSelector } from './GoalSelector';

interface TaskCreationCardProps {
  candidate: TaskCandidate;
  onConfirm: (candidate: TaskCandidate) => void;
  onDismiss: (tempId: string) => void;
  onEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
  // Phase 2追加
  availableGoals?: GoalSummary[];
}

export const TaskCreationCard: React.FC<TaskCreationCardProps> = ({
  candidate,
  onConfirm,
  onDismiss,
  onEdit,
  availableGoals,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Partial<TaskCandidate>>({});

  const currentValues = { ...candidate, ...editValues };

  const handleConfirm = () => {
    const mergedCandidate = { ...candidate, ...editValues };
    onConfirm(mergedCandidate);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    onEdit(candidate.tempId, editValues);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValues({});
    setIsEditing(false);
  };

  if (candidate.status === 'dismissed') {
    return null;
  }

  if (candidate.status === 'confirmed') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 rounded-lg p-3 mt-2"
      >
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
          <Check size={16} />
          <span className="font-medium">タスク「{candidate.title}」を作成しました</span>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-medium">
        <Sparkles size={16} />
        <span className="text-sm">タスクの提案</span>
      </div>

      {/* Fields */}
      <div className="space-y-2 text-sm">
        {/* Title */}
        <div className="flex items-start gap-2">
          <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">タイトル:</span>
          {isEditing ? (
            <input
              type="text"
              value={editValues.title ?? currentValues.title}
              onChange={(e) => setEditValues({ ...editValues, title: e.target.value })}
              className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-white"
            />
          ) : (
            <span className="flex-1 text-zinc-900 dark:text-white">{currentValues.title}</span>
          )}
        </div>

        {/* Date */}
        <div className="flex items-start gap-2">
          <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">日付:</span>
          {isEditing ? (
            <input
              type="date"
              value={editValues.date ?? currentValues.date}
              onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
              className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-white"
            />
          ) : (
            <span className="flex-1 text-zinc-900 dark:text-white">{currentValues.date}</span>
          )}
        </div>

        {/* Scheduled Start */}
        {(currentValues.scheduledStart || isEditing) && (
          <div className="flex items-start gap-2">
            <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">開始時刻:</span>
            {isEditing ? (
              <input
                type="time"
                value={editValues.scheduledStart ?? currentValues.scheduledStart ?? ''}
                onChange={(e) => setEditValues({ ...editValues, scheduledStart: e.target.value })}
                className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-white"
              />
            ) : (
              <span className="flex-1 text-zinc-900 dark:text-white">{currentValues.scheduledStart}</span>
            )}
          </div>
        )}

        {/* Estimated Minutes */}
        <div className="flex items-start gap-2">
          <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">見積もり:</span>
          {isEditing ? (
            <input
              type="number"
              min="1"
              value={editValues.estimatedMinutes ?? currentValues.estimatedMinutes}
              onChange={(e) => setEditValues({ ...editValues, estimatedMinutes: parseInt(e.target.value) })}
              className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-white"
            />
          ) : (
            <span className="flex-1 text-zinc-900 dark:text-white">{currentValues.estimatedMinutes}分</span>
          )}
        </div>

        {/* Memo */}
        {(currentValues.memo || isEditing) && (
          <div className="flex items-start gap-2">
            <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">メモ:</span>
            {isEditing ? (
              <textarea
                value={editValues.memo ?? currentValues.memo ?? ''}
                onChange={(e) => setEditValues({ ...editValues, memo: e.target.value })}
                className="flex-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 text-zinc-900 dark:text-white"
                rows={2}
              />
            ) : (
              <span className="flex-1 text-zinc-900 dark:text-white">{currentValues.memo}</span>
            )}
          </div>
        )}

        {/* Goal Selector - Phase 2 */}
        {availableGoals && availableGoals.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">目標:</span>
            {isEditing ? (
              <GoalSelector
                value={editValues.parentGoalId ?? currentValues.parentGoalId}
                onChange={(goalId) => {
                  setEditValues({ ...editValues, parentGoalId: goalId });
                }}
                goals={availableGoals}
                className="flex-1"
              />
            ) : (
              <span className="flex-1 text-zinc-900 dark:text-white">
                {currentValues.parentGoalId
                  ? availableGoals.find(g => g.id === currentValues.parentGoalId)?.title ?? '(不明な目標)'
                  : '紐づけなし'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        {isEditing ? (
          <>
            <button
              onClick={handleSaveEdit}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
            >
              <Check size={14} />
              保存
            </button>
            <button
              onClick={handleCancelEdit}
              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded text-sm transition-colors"
            >
              <X size={14} />
              キャンセル
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleConfirm}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm transition-colors"
            >
              <Check size={14} />
              作成
            </button>
            <button
              onClick={handleEdit}
              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded text-sm transition-colors"
            >
              <Edit2 size={14} />
              編集
            </button>
            <button
              onClick={() => onDismiss(candidate.tempId)}
              className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded text-sm transition-colors"
            >
              <X size={14} />
              キャンセル
            </button>
          </>
        )}
      </div>
    </div>
  );
};
