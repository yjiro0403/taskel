/**
 * AIツール定義
 */

import { tool } from 'ai';
import { z } from 'zod';
import { format, addDays, parseISO } from 'date-fns';
import { resolveDate } from './dateResolver';
import { getSectionForTime } from '@/lib/sectionUtils';
import { getDb } from '@/lib/firebaseAdmin';
import type { Section } from '@/types';
import type { TodayTasksSummary, GoalSummary, GoalBreakdownContext, CalibrationData, GoalsSummaryResult } from './types';

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

    getGoals: tool({
      description: 'ユーザーの目標（Goals）一覧を取得します。' +
        '年間目標、月間目標、週間目標をフィルタして取得できます。' +
        'タスクと目標の紐づけや、目標分解の前段階として使用します。',
      parameters: z.object({
        type: z.enum(['yearly', 'monthly', 'weekly', 'all'])
          .default('all')
          .describe('取得する目標のタイプ。"all"で全種別取得'),
        status: z.enum(['active', 'all'])
          .default('active')
          .describe('"active"ならpending/in_progressのみ、"all"なら全ステータス'),
        periodHint: z.string().optional()
          .describe('期間のヒント（"今月", "今週", "2026-02" 等）。指定なしで現在の期間'),
      }),
      // @ts-ignore
      execute: async (args: any): Promise<GoalsSummaryResult> => {
        try {
          const db = getDb();

          // Firestoreからgoalsを取得
          let goalsQuery = db
            .collection('goals')
            .where('userId', '==', context.userId);

          // typeフィルタ（Firestoreクエリレベル）
          if (args.type !== 'all') {
            goalsQuery = goalsQuery.where('type', '==', args.type);
          }

          const snapshot = await goalsQuery.get();
          let goals = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              title: data.title,
              type: data.type as 'yearly' | 'monthly' | 'weekly',
              status: data.status,
              progress: data.progress || 0,
              assignedYear: data.assignedYear,
              assignedMonth: data.assignedMonth,
              assignedWeek: data.assignedWeek,
              parentGoalId: data.parentGoalId,
              aiSuggestedBreakdown: data.aiAnalysis?.suggestedBreakdown,
              keyResults: data.aiAnalysis?.keyResults,
            };
          });

          // statusフィルタ（アプリケーションレベル、active = pending | in_progress）
          if (args.status === 'active') {
            goals = goals.filter(g =>
              g.status === 'pending' || g.status === 'in_progress'
            );
          }

          // 期間フィルタ（currentDateベース）
          const currentYear = context.currentDate.substring(0, 4);
          const currentMonth = context.currentDate.substring(0, 7);

          if (!args.periodHint || args.periodHint === '今月') {
            goals = goals.filter(g => {
              if (g.type === 'yearly') return g.assignedYear === currentYear;
              if (g.type === 'monthly') return g.assignedMonth === currentMonth;
              if (g.type === 'weekly') return g.assignedMonth === currentMonth;
              return true;
            });
          }

          // 紐づけタスク数の取得（Firestoreの`in`クエリ: 最大30件バッチ）
          const goalIds = goals.map(g => g.id);
          const linkedTaskCounts: Record<string, number> = {};

          if (goalIds.length > 0) {
            const batches: string[][] = [];
            for (let i = 0; i < goalIds.length; i += 30) {
              batches.push(goalIds.slice(i, i + 30));
            }

            for (const batch of batches) {
              const taskSnapshot = await db
                .collection('tasks')
                .where('userId', '==', context.userId)
                .where('parentGoalId', 'in', batch)
                .get();

              taskSnapshot.docs.forEach((doc) => {
                const goalId = doc.data().parentGoalId;
                linkedTaskCounts[goalId] = (linkedTaskCounts[goalId] || 0) + 1;
              });
            }
          }

          const goalsWithCounts: GoalSummary[] = goals.map(g => ({
            ...g,
            linkedTaskCount: linkedTaskCounts[g.id] || 0,
          }));

          return {
            type: 'goals_summary' as const,
            goals: goalsWithCounts,
            periodDescription: `${currentYear}年${args.type === 'all' ? '' : ` (${args.type})`}`,
            message: `${goalsWithCounts.length}件の目標を取得しました。`,
          };
        } catch (error) {
          console.error('getGoals error:', error);
          return {
            type: 'goals_summary' as const,
            goals: [],
            periodDescription: '',
            message: '目標情報の取得に失敗しました。',
          };
        }
      },
    }),

    breakdownGoal: tool({
      description: '指定された目標をタスク群に分解して提案します。' +
        '目標を達成するための具体的なステップをタスクとして提案し、' +
        'ユーザーの確認を経て一括作成できるようにします。' +
        '必ず先にgetGoalsで目標一覧を取得してから、具体的なgoalIdを指定してください。' +
        'このツールの結果を受けて、suggestTaskを複数回呼び出して各タスクを提案してください。',
      parameters: z.object({
        goalId: z.string().describe('分解対象の目標ID'),
        goalTitle: z.string().describe('目標のタイトル（コンテキスト用）'),
        numberOfTasks: z.number().default(5)
          .describe('提案するタスク数（デフォルト5）'),
        dateRange: z.object({
          start: z.string().describe('タスクの開始日（YYYY-MM-DD）'),
          end: z.string().describe('タスクの終了日（YYYY-MM-DD）'),
        }).optional().describe('タスクを配置する日付範囲。省略時は今日から1週間'),
        context: z.string().optional()
          .describe('追加のコンテキスト（「テストを重視」「午前中に配置」など）'),
      }),
      // @ts-ignore
      execute: async (args: any): Promise<GoalBreakdownContext> => {
        // breakdownGoalは「コンテキスト収集」のみを行う。
        // 実際のタスク分解はAIモデルが後続のsuggestTask複数呼び出しで行う。
        try {
          const db = getDb();

          // 対象Goalの詳細を取得
          const goalDoc = await db.collection('goals').doc(args.goalId).get();
          if (!goalDoc.exists) {
            return {
              type: 'goal_breakdown_context' as const,
              sourceGoal: { id: args.goalId, title: args.goalTitle, type: 'unknown' },
              existingTaskTitles: [],
              dateRange: { start: context.currentDate, end: context.currentDate },
              numberOfTasks: args.numberOfTasks || 5,
              message: '指定された目標が見つかりませんでした。',
            };
          }

          const goalData = goalDoc.data()!;

          // 既存の紐づけタスクを取得（重複提案を避けるため）
          const existingTasks = await db
            .collection('tasks')
            .where('userId', '==', context.userId)
            .where('parentGoalId', '==', args.goalId)
            .get();

          const existingTaskTitles = existingTasks.docs.map(d => d.data().title);

          // 日付範囲の設定（省略時は今日から6日後=1週間）
          const startDate = args.dateRange?.start || context.currentDate;
          const endDate = args.dateRange?.end || format(
            addDays(parseISO(context.currentDate), 6),
            'yyyy-MM-dd'
          );

          return {
            type: 'goal_breakdown_context' as const,
            sourceGoal: {
              id: goalDoc.id,
              title: goalData.title,
              type: goalData.type,
              description: goalData.description,
              progress: goalData.progress,
              aiAnalysis: goalData.aiAnalysis,
            },
            existingTaskTitles,
            dateRange: { start: startDate, end: endDate },
            numberOfTasks: args.numberOfTasks,
            additionalContext: args.context,
            message: `目標「${goalData.title}」の分解情報を取得しました。` +
              `既に${existingTaskTitles.length}件のタスクが紐づいています。` +
              `${args.numberOfTasks}件のタスクを提案します。`,
          };
        } catch (error) {
          console.error('breakdownGoal error:', error);
          return {
            type: 'goal_breakdown_context' as const,
            sourceGoal: { id: args.goalId, title: args.goalTitle, type: 'unknown' },
            existingTaskTitles: [],
            dateRange: { start: context.currentDate, end: context.currentDate },
            numberOfTasks: args.numberOfTasks || 5,
            message: '目標情報の取得に失敗しました。',
          };
        }
      },
    }),

    getCalibrationData: tool({
      description: 'ユーザーの見積もり時間と実績時間の乖離データを取得します。' +
        '時間感覚の校正（Time Calibration）に使用し、' +
        '見積もり精度の改善提案を行います。',
      parameters: z.object({
        daysBack: z.number().default(14)
          .describe('何日前まで遡ってデータを取得するか（デフォルト14日）'),
        _dummy: z.string().optional()
          .describe('内部用（省略可）'),
      }),
      // @ts-ignore
      execute: async (args: any): Promise<CalibrationData> => {
        try {
          const db = getDb();
          const daysBack = args.daysBack || 14;

          // 期間の計算
          const endDate = context.currentDate;
          const startDate = format(
            addDays(parseISO(context.currentDate), -daysBack),
            'yyyy-MM-dd'
          );

          // 完了タスクを取得（見積もりと実績の両方がある）
          const snapshot = await db
            .collection('tasks')
            .where('userId', '==', context.userId)
            .where('status', '==', 'done')
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .get();

          const tasks = snapshot.docs
            .map((doc) => {
              const data = doc.data();
              return {
                title: data.title,
                estimated: data.estimatedMinutes || 0,
                actual: data.actualMinutes || 0,
                date: data.date,
                tags: data.aiTags || data.tags || [],
              };
            })
            .filter(t => t.estimated > 0 && t.actual > 0); // 両方の値がある

          if (tasks.length === 0) {
            return {
              type: 'calibration_feedback' as const,
              period: { start: startDate, end: endDate, days: daysBack },
              overall: {
                totalTasks: 0,
                completedTasks: 0,
                totalEstimatedMinutes: 0,
                totalActualMinutes: 0,
                accuracyRatio: 1.0,
                averageDeviationPercent: 0,
              },
              worstEstimates: [],
              message: `過去${daysBack}日間で見積もりと実績の両方が記録されたタスクがありません。` +
                'タスク完了時に実績時間を記録すると、時間校正が可能になります。',
            };
          }

          // 全体統計の計算
          const totalEstimated = tasks.reduce((sum, t) => sum + t.estimated, 0);
          const totalActual = tasks.reduce((sum, t) => sum + t.actual, 0);
          const accuracyRatio = totalActual / totalEstimated;

          // 各タスクの乖離率を計算
          const tasksWithDeviation = tasks.map(t => ({
            ...t,
            deviationPercent: ((t.actual - t.estimated) / t.estimated) * 100,
          }));

          const averageDeviation = tasksWithDeviation.reduce(
            (sum, t) => sum + t.deviationPercent, 0
          ) / tasksWithDeviation.length;

          // 最も乖離が大きいタスク（上位5件、絶対値でソート）
          const worstEstimates = [...tasksWithDeviation]
            .sort((a, b) => Math.abs(b.deviationPercent) - Math.abs(a.deviationPercent))
            .slice(0, 5)
            .map(t => ({
              title: t.title,
              estimated: t.estimated,
              actual: t.actual,
              deviationPercent: Math.round(t.deviationPercent),
              date: t.date,
            }));

          // タグ別統計（タグがあるタスクのみ）
          const tagMap: Record<string, { count: number; totalEst: number; totalAct: number }> = {};
          tasksWithDeviation.forEach(t => {
            t.tags.forEach((tag: string) => {
              if (!tagMap[tag]) tagMap[tag] = { count: 0, totalEst: 0, totalAct: 0 };
              tagMap[tag].count++;
              tagMap[tag].totalEst += t.estimated;
              tagMap[tag].totalAct += t.actual;
            });
          });

          const byTag = Object.entries(tagMap)
            .map(([tag, data]) => ({
              tag,
              taskCount: data.count,
              avgEstimated: Math.round(data.totalEst / data.count),
              avgActual: Math.round(data.totalAct / data.count),
              accuracyRatio: Math.round((data.totalAct / data.totalEst) * 100) / 100,
            }))
            .sort((a, b) => Math.abs(1 - a.accuracyRatio) - Math.abs(1 - b.accuracyRatio))
            .reverse();

          // AIフィードバックメッセージ生成
          let message = '';
          if (accuracyRatio > 1.3) {
            message = `過去${daysBack}日間の見積もり精度は${Math.round(accuracyRatio * 100)}%です。` +
              '全体的に見積もりが甘い傾向があります。次回は見積もりを' +
              `${Math.round((accuracyRatio - 1) * 100)}%増やすことを検討してみてください。`;
          } else if (accuracyRatio < 0.7) {
            message = `過去${daysBack}日間の見積もり精度は${Math.round(accuracyRatio * 100)}%です。` +
              '見積もりより早く完了する傾向があります。見積もりの精度は良好ですが、' +
              '余裕を持ちすぎている可能性があります。';
          } else {
            message = `過去${daysBack}日間の見積もり精度は${Math.round(accuracyRatio * 100)}%で、` +
              '良好な見積もり精度です。';
          }

          return {
            type: 'calibration_feedback' as const,
            period: { start: startDate, end: endDate, days: daysBack },
            overall: {
              totalTasks: tasks.length,
              completedTasks: tasks.length,
              totalEstimatedMinutes: totalEstimated,
              totalActualMinutes: totalActual,
              accuracyRatio: Math.round(accuracyRatio * 100) / 100,
              averageDeviationPercent: Math.round(averageDeviation),
            },
            byTag: byTag.length > 0 ? byTag : undefined,
            worstEstimates,
            message,
          };
        } catch (error) {
          console.error('getCalibrationData error:', error);
          return {
            type: 'calibration_feedback' as const,
            period: { start: '', end: '', days: 0 },
            overall: {
              totalTasks: 0,
              completedTasks: 0,
              totalEstimatedMinutes: 0,
              totalActualMinutes: 0,
              accuracyRatio: 1.0,
              averageDeviationPercent: 0,
            },
            worstEstimates: [],
            message: '校正データの取得に失敗しました。',
          };
        }
      },
    }),
  };
}
