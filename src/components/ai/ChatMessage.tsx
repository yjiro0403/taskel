'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskCandidate, GoalSummary } from '@/lib/ai/types';
import { TaskCreationCard } from './TaskCreationCard';
import { GoalBreakdownPreview } from './GoalBreakdownPreview';
import { CalibrationFeedback } from './CalibrationFeedback';

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  parts?: Array<{
    type?: string;
    text?: string;
    toolCallId?: string;
    state?: string;
    output?: any;
    toolName?: string;
  }>;
  toolInvocations?: Array<{
    state?: string;
    result?: any;
    toolName?: string;
    toolCallId?: string;
  }>;
}

interface ChatMessageProps {
  message: UIMessage;
  onTaskConfirm: (candidate: TaskCandidate) => void;
  onTaskDismiss: (tempId: string) => void;
  onTaskEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
  // Phase 2追加
  availableGoals?: GoalSummary[];
  onConfirmMultiple?: (tempIds: string[]) => void;
  onDismissMultiple?: (tempIds: string[]) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onTaskConfirm,
  onTaskDismiss,
  onTaskEdit,
  availableGoals,
  onConfirmMultiple,
  onDismissMultiple,
}) => {
  const parts = message.parts ?? [];
  const textParts = parts.filter((p) => p.type === 'text');
  const textContent = textParts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  const toolParts = parts.filter((p) =>
    p.type === 'tool-suggestTask' ||
    p.type === 'tool-getTodayTasks' ||
    p.type === 'tool-getGoals' ||
    p.type === 'tool-breakdownGoal' ||
    p.type === 'tool-getCalibrationData' ||
    p.type === 'dynamic-tool'
  );

  return (
    <div
      className={cn(
        "flex w-full mb-4",
        message.role === 'user' ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm",
          message.role === 'user'
            ? "bg-indigo-600 text-white rounded-br-none"
            : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-none"
        )}
      >
        {/* テキストコンテンツ */}
        {textContent && (
          <div className="prose dark:prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ node, ...props }) => <p className="mb-0" {...props} />
              }}
            >
              {textContent}
            </ReactMarkdown>
          </div>
        )}

        {/* Tool parts (AI SDK v6): tool-suggestTask, tool-getTodayTasks, tool-getGoals, tool-breakdownGoal, tool-getCalibrationData, dynamic-tool */}
        {toolParts.map((part, idx) => {
          const toolName = part.toolName ?? (part.type === 'tool-suggestTask' ? 'suggestTask' : part.type === 'tool-getTodayTasks' ? 'getTodayTasks' : part.type === 'tool-getGoals' ? 'getGoals' : part.type === 'tool-breakdownGoal' ? 'breakdownGoal' : part.type === 'tool-getCalibrationData' ? 'getCalibrationData' : '');
          const isSuggestTask = toolName === 'suggestTask' || part.type === 'tool-suggestTask';
          const isGetTodayTasks = toolName === 'getTodayTasks' || part.type === 'tool-getTodayTasks';
          const isGetGoals = toolName === 'getGoals' || part.type === 'tool-getGoals';
          const isBreakdownGoal = toolName === 'breakdownGoal' || part.type === 'tool-breakdownGoal';
          const isGetCalibrationData = toolName === 'getCalibrationData' || part.type === 'tool-getCalibrationData';

          if (part.state === 'output-available' && part.output) {
            // task_suggestion タイプの検出
            if (isSuggestTask && part.output?.type === 'task_suggestion' && part.output?.candidate) {
              return (
                <TaskCreationCard
                  key={part.toolCallId ?? idx}
                  candidate={part.output.candidate as TaskCandidate}
                  onConfirm={onTaskConfirm}
                  onDismiss={onTaskDismiss}
                  onEdit={onTaskEdit}
                  availableGoals={availableGoals}
                />
              );
            }

            // getTodayTasks の結果表示
            if (isGetTodayTasks && part.output) {
              const summary = part.output as any;
              return (
                <div key={part.toolCallId ?? idx} className={cn(
                  "mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600"
                )}>
                  <div className="text-sm space-y-1">
                    <p className="font-medium">今日のタスク状況</p>
                    <p>合計: {summary.totalTasks}件 | 完了: {summary.completedTasks}件 | 未完了: {summary.openTasks}件</p>
                    <p>見積もり合計: {summary.totalEstimatedMinutes}分 | 実績: {summary.totalActualMinutes}分</p>
                  </div>
                </div>
              );
            }

            // getCalibrationData の結果表示
            if (isGetCalibrationData && part.output?.type === 'calibration_feedback') {
              return (
                <CalibrationFeedback
                  key={part.toolCallId ?? idx}
                  data={part.output}
                />
              );
            }

            // getGoals の結果表示（簡易版）
            if (isGetGoals && part.output?.type === 'goals_summary') {
              const summary = part.output as any;
              return (
                <div key={part.toolCallId ?? idx} className={cn(
                  "mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600"
                )}>
                  <div className="text-sm space-y-1">
                    <p className="font-medium">目標一覧</p>
                    <p>{summary.periodDescription}: {summary.goals?.length || 0}件</p>
                  </div>
                </div>
              );
            }

            // その他のツール結果
            const displayMsg = part.output?.message ?? '完了しました';
            return (
              <div key={part.toolCallId ?? idx} className={cn(
                "flex items-center gap-2",
                textContent ? "mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600" : "py-0.5"
              )}>
                <span className="text-base">{isSuggestTask ? '✨' : isBreakdownGoal ? '🎯' : '📊'}</span>
                <span className={cn(
                  "text-zinc-700 dark:text-zinc-200",
                  !textContent && "font-medium"
                )}>
                  {displayMsg}
                </span>
              </div>
            );
          }

          if (part.state === 'output-error') {
            return (
              <div key={part.toolCallId ?? idx} className="flex items-center gap-2 mt-2 text-red-500 text-sm">
                ⚠️ エラーが発生しました
              </div>
            );
          }

          return (
            <div key={part.toolCallId ?? idx} className="flex items-center gap-2 mt-2 text-zinc-500">
              <Loader2 size={14} className="animate-spin" />
              <span>処理中...</span>
            </div>
          );
        })}

        {/* フォールバック: toolInvocations (旧形式) */}
        {toolParts.length === 0 && message.toolInvocations?.map((ti, idx) => {
          if (ti.state === 'result' && ti.result) {
            const msg = ti.result?.message ?? (ti.toolName === 'suggestTask' ? 'タスクを提案しました' : '完了しました');
            return (
              <div key={ti.toolCallId ?? idx} className="flex items-center gap-2 py-0.5">
                <span className="text-base">✨</span>
                <span className="text-zinc-700 dark:text-zinc-200 font-medium">{msg}</span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};
