'use client';

import React from 'react';
import { Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalibrationData } from '@/lib/ai/types';

interface CalibrationFeedbackProps {
  data: CalibrationData;
}

function getAccuracyColor(ratio: number): string {
  const percent = ratio * 100;
  if (percent >= 80 && percent <= 120) return 'text-green-600';
  if (percent >= 60 && percent <= 150) return 'text-yellow-600';
  return 'text-red-600';
}

function getBarColor(ratio: number): string {
  const percent = ratio * 100;
  if (percent >= 80 && percent <= 120) return 'bg-green-500';
  if (percent >= 60 && percent <= 150) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getTrendIcon(ratio: number) {
  if (ratio > 1.1) return <TrendingUp size={14} />;
  if (ratio < 0.9) return <TrendingDown size={14} />;
  return <Minus size={14} />;
}

export const CalibrationFeedback: React.FC<CalibrationFeedbackProps> = ({ data }) => {
  const { overall, period, worstEstimates, byTag, message } = data;
  const accuracyPercent = Math.round(overall.accuracyRatio * 100);
  // バー幅: 200%を最大として正規化
  const barWidth = Math.min(accuracyPercent, 200);

  if (overall.totalTasks === 0) {
    return (
      <div className="border border-zinc-200 rounded-lg p-4 mt-2">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Clock size={16} />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-zinc-200 bg-zinc-50 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 font-medium text-sm">
        <Clock size={16} className="text-zinc-600" />
        <span>時間校正レポート（過去{period.days}日間）</span>
      </div>

      {/* 精度メイン表示 */}
      <div className="space-y-2">
        <div className={cn("text-2xl font-bold", getAccuracyColor(overall.accuracyRatio))}>
          <span className="flex items-center gap-2">
            {accuracyPercent}%
            {getTrendIcon(overall.accuracyRatio)}
          </span>
        </div>

        {/* プログレスバー */}
        <div className="relative h-3 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", getBarColor(overall.accuracyRatio))}
            style={{ width: `${barWidth / 2}%` }}
          />
          {/* 100%マーカー */}
          <div className="absolute top-0 left-1/2 w-0.5 h-full bg-zinc-400" />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
        {/* BUG-004修正: 200%超の警告表示 */}
        {accuracyPercent > 200 && (
          <div className="text-xs text-red-600 mt-1">
            注意: 見積もりが実績の{Math.round(accuracyPercent / 100)}倍を超えています
          </div>
        )}
      </div>

      {/* 統計サマリ */}
      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600">
        <div>分析対象: {overall.totalTasks}タスク</div>
        <div>平均乖離: {overall.averageDeviationPercent > 0 ? '+' : ''}{overall.averageDeviationPercent}%</div>
        <div>見積もり合計: {overall.totalEstimatedMinutes}分</div>
        <div>実績合計: {overall.totalActualMinutes}分</div>
      </div>

      {/* 最大乖離タスク */}
      {worstEstimates.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700">
            最も乖離が大きかったタスク:
          </p>
          {worstEstimates.map((t, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="truncate max-w-[60%]">{idx + 1}. {t.title}</span>
              <span>
                {t.estimated}分 → {t.actual}分
                <span className={cn(
                  "ml-1",
                  t.deviationPercent > 0 ? "text-red-500" : "text-green-500"
                )}>
                  ({t.deviationPercent > 0 ? '+' : ''}{t.deviationPercent}%)
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* タグ別統計 */}
      {byTag && byTag.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700">
            カテゴリ別精度:
          </p>
          {byTag.slice(0, 5).map((t, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>#{t.tag} ({t.taskCount}件)</span>
              <span className={getAccuracyColor(t.accuracyRatio)}>
                {Math.round(t.accuracyRatio * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AIフィードバック */}
      <div className="text-xs text-zinc-700 bg-zinc-100 rounded p-2">
        {message}
      </div>
    </div>
  );
};
