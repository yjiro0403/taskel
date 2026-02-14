/**
 * AIツール定義
 */

import { tool } from 'ai';
import { z } from 'zod';
import { resolveDate } from './dateResolver';
import { getSectionForTime } from '@/lib/sectionUtils';
import { getDb } from '@/lib/firebaseAdmin';
import type { Section } from '@/types';
import type { TodayTasksSummary } from './types';

interface ToolContext {
  userId: string;
  currentDate: string;
  sections: Section[];
}

const suggestTaskSchema = z.object({
  title: z.string().optional().describe('タスクのタイトル'),
  taskName: z.string().default('（無題）').describe(
    'タスク名（必須）。ユーザーが「片付けを追加」と言った場合は「片付け」を指定'
  ),
  dateHint: z.string().default('today').describe(
    '日付のヒント（"today", "明日", "2025-01-15" 等）'
  ),
  estimatedMinutes: z.number().default(30).describe('見積もり時間（分）'),
  scheduledStart: z.string().default('').describe('開始時刻（HH:mm形式）'),
  sectionId: z.string().default('unplanned').describe('セクションID'),
  memo: z.string().default('').describe('メモ'),
  parentGoalId: z.string().optional().describe('紐づける目標のID'),
  projectId: z.string().optional().describe('紐づけるプロジェクトのID'),
  aiTags: z.array(z.string()).optional().describe('AIが推定するタグ'),
});

export function createAITools(context: ToolContext) {
  // @ts-ignore - AI SDK tool type definitions are complex
  return {
    suggestTask: tool({
      description: 'ユーザーの依頼に基づいてタスクの作成を提案します。' +
        'タスクの内容をプレビューカードとして表示し、ユーザーの確認を待ちます。' +
        '直接作成はせず、提案のみを行います。',
      parameters: suggestTaskSchema,
      // @ts-ignore
      execute: async (args: any) => {
        // TaskCandidate JSONを組み立てて返す（DB書き込みなし）
        const title = (args.title || args.taskName || '').trim() || '（無題）';
        const date = resolveDate(args.dateHint, context.currentDate);
        const estimatedMinutes = args.estimatedMinutes || 30;
        const scheduledStart = args.scheduledStart || undefined;
        const memo = args.memo || '';

        // セクション自動割り当て
        let sectionId = args.sectionId || 'unplanned';
        if (scheduledStart && context.sections.length > 0) {
          const matched = getSectionForTime(context.sections, scheduledStart);
          if (matched) sectionId = matched;
        }

        return {
          type: 'task_suggestion' as const,
          candidate: {
            tempId: crypto.randomUUID(),
            title,
            date,
            estimatedMinutes,
            scheduledStart: scheduledStart || undefined,
            sectionId,
            memo,
            parentGoalId: args.parentGoalId || undefined,
            projectId: args.projectId || undefined,
            aiTags: args.aiTags || [],
            status: 'pending' as const,
          },
          message: `タスク「${title}」を提案します。内容を確認して、問題なければ作成ボタンを押してください。`,
        };
      },
    }),

    getTodayTasks: tool({
      description: '今日のタスク一覧を取得して、現在の状況を把握します',
      parameters: z.object({
        _dummy: z.string().describe('内部用パラメータ（常に"ignore"を指定）'),
      }),
      // @ts-ignore
      execute: async (): Promise<TodayTasksSummary> => {
        // BUG-002修正: エラーハンドリング追加
        try {
          const db = getDb();
          const snapshot = await db
            .collection('tasks')
            .where('userId', '==', context.userId)
            .where('date', '==', context.currentDate)
            .get();

          const tasks = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              title: data.title,
              status: data.status,
              estimatedMinutes: data.estimatedMinutes || 0,
              actualMinutes: data.actualMinutes || 0,
              scheduledStart: data.scheduledStart || undefined,
              sectionId: data.sectionId || 'unplanned',
              parentGoalId: data.parentGoalId || undefined,
            };
          });

          const completedTasks = tasks.filter((t) => t.status === 'done').length;
          const openTasks = tasks.filter((t) => t.status === 'open').length;
          const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
          const totalEstimatedMinutes = tasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
          const totalActualMinutes = tasks.reduce((sum, t) => sum + t.actualMinutes, 0);

          return {
            date: context.currentDate,
            totalTasks: tasks.length,
            completedTasks,
            openTasks,
            inProgressTasks,
            totalEstimatedMinutes,
            totalActualMinutes,
            tasks: tasks.filter((t) => t.status !== 'skipped'),
          };
        } catch (error) {
          console.error('getTodayTasks error:', error);
          // エラー時は空のサマリを返す
          return {
            date: context.currentDate,
            totalTasks: 0,
            completedTasks: 0,
            openTasks: 0,
            inProgressTasks: 0,
            totalEstimatedMinutes: 0,
            totalActualMinutes: 0,
            tasks: [],
          };
        }
      },
    }),
  };
}
