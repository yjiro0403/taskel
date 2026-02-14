'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { GoalSummary } from '@/lib/ai/types';

interface GoalSelectorProps {
  /** 選択中のgoalId */
  value?: string;
  /** 選択変更時のコールバック */
  onChange: (goalId: string | undefined) => void;
  /** 選択肢として表示するGoals */
  goals: GoalSummary[];
  /** 追加のクラス名 */
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  yearly: '年間',
  monthly: '月間',
  weekly: '週間',
};

export const GoalSelector: React.FC<GoalSelectorProps> = ({
  value,
  onChange,
  goals,
  className,
}) => {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={cn(
        'bg-white border border-zinc-300',
        'rounded px-2 py-1 text-sm text-zinc-900',
        'focus:outline-none focus:ring-1 focus:ring-indigo-500',
        className
      )}
    >
      <option value="">紐づけなし</option>
      {goals.map(g => (
        <option key={g.id} value={g.id}>
          [{TYPE_LABELS[g.type] || g.type}] {g.title} ({g.progress}%)
        </option>
      ))}
    </select>
  );
};
