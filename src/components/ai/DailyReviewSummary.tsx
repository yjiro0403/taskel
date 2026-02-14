'use client';

import React from 'react';
import { CalendarCheck, CheckCircle2, Circle, SkipForward, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DailyReviewData } from '@/lib/ai/types';

interface DailyReviewSummaryProps {
  data: DailyReviewData;
}

function getCompletionColor(rate: number): string {
  if (rate >= 80) return 'text-green-600';
  if (rate >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

function getCompletionBarColor(rate: number): string {
  if (rate >= 80) return 'bg-green-500';
  if (rate >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getDeviationColor(estimated: number, actual: number): string {
  if (estimated === 0) return 'text-zinc-500';
  const ratio = actual / estimated;
  if (ratio >= 0.8 && ratio <= 1.2) return 'text-green-600';
  if (ratio >= 0.6 && ratio <= 1.5) return 'text-yellow-600';
  return 'text-red-600';
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

export const DailyReviewSummary: React.FC<DailyReviewSummaryProps> = ({ data }) => {
  const { date, completedTasks, incompleteTasks, skippedTasks, stats, goalProgress, message } = data;

  if (stats.totalTasks === 0) {
    return (
      <div className="border border-zinc-200 rounded-lg p-4 mt-2">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <CalendarCheck size={16} />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-zinc-200 bg-zinc-50 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 font-medium text-sm">
        <CalendarCheck size={16} className="text-zinc-600" />
        <span>Daily Review - {date}</span>
      </div>

      {/* Completion Rate */}
      <div className="space-y-2">
        <div className={cn("text-2xl font-bold", getCompletionColor(stats.completionRate))}>
          {stats.completionRate}%
        </div>
        <div className="relative h-3 bg-zinc-200 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", getCompletionBarColor(stats.completionRate))}
            style={{ width: `${stats.completionRate}%` }}
          />
        </div>
        <div className="text-xs text-zinc-500">
          {stats.completedCount} / {stats.totalTasks} タスク完了
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600">
        <div className="flex items-center gap-1">
          <CheckCircle2 size={12} className="text-green-500" />
          完了: {stats.completedCount}件
        </div>
        <div className="flex items-center gap-1">
          <Circle size={12} className="text-zinc-400" />
          未完了: {stats.incompleteCount}件
        </div>
        <div>
          見積もり合計: {formatMinutes(stats.totalEstimatedMinutes)}
        </div>
        <div>
          実績合計: {formatMinutes(stats.totalActualMinutes)}
        </div>
        {stats.totalEstimatedMinutes > 0 && stats.totalActualMinutes > 0 && (
          <div className="col-span-2">
            見積もり精度: <span className={getDeviationColor(stats.totalEstimatedMinutes, stats.totalActualMinutes)}>
              {Math.round(stats.accuracyRatio * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700">
            完了タスク ({completedTasks.length}件)
          </p>
          {completedTasks.map((t, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="truncate max-w-[55%] flex items-center gap-1">
                <CheckCircle2 size={10} className="text-green-500 flex-shrink-0" />
                {t.title}
              </span>
              <span>
                {t.estimatedMinutes}分
                {t.actualMinutes > 0 && (
                  <>
                    <span className="mx-0.5">&rarr;</span>
                    <span className={getDeviationColor(t.estimatedMinutes, t.actualMinutes)}>
                      {t.actualMinutes}分
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Incomplete Tasks */}
      {incompleteTasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700">
            未完了タスク ({incompleteTasks.length}件)
          </p>
          {incompleteTasks.map((t, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="truncate max-w-[65%] flex items-center gap-1">
                <Circle size={10} className="text-zinc-400 flex-shrink-0" />
                {t.title}
              </span>
              <span className="text-zinc-400">
                {t.status === 'in_progress' ? '進行中' : '未着手'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Skipped Tasks */}
      {skippedTasks.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700">
            スキップ ({skippedTasks.length}件)
          </p>
          {skippedTasks.map((t, idx) => (
            <div key={idx} className="text-[11px] text-zinc-400 flex items-center gap-1">
              <SkipForward size={10} className="flex-shrink-0" />
              {t.title}
            </div>
          ))}
        </div>
      )}

      {/* Goal Progress */}
      {goalProgress.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700 flex items-center gap-1">
            <Target size={12} />
            目標別進捗
          </p>
          {goalProgress.map((g, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-500">
              <span className="truncate max-w-[65%]">{g.goalTitle}</span>
              <span>
                {g.tasksCompleted}/{g.tasksTotal}件完了
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AI Message */}
      <div className="text-xs text-zinc-700 bg-zinc-100 rounded p-2">
        {message}
      </div>
    </div>
  );
};
