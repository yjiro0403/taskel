# Implementation Plan: Phase 2 - AI Feature Integration (Goal Breakdown & Calibration)

## 概要

Phase 2では、Phase 1で構築したAIサイドバー基盤（suggestTask、TaskCreationCard、getTodayTasks）の上に、Taskelのコアバリューである **「目標と実行の接続」** と **「時間感覚の校正（Calibration）」** を実装する。

### Phase 2の2つの柱

1. **ステップ 2.1: タスク作成と時間見積もり校正** - TaskCreationCardとuseStoreの接続強化、時間校正フィードバック
2. **ステップ 2.2: Goal Breakdown & Alignment** - AIによる目標分解提案、タスクとGoalの紐づけ

### 要件定義書との対応

| 要件定義書セクション | Phase 2対応 |
|---|---|
| 3.2 自然言語によるタスク作成・編集 | TaskCreationCardへのGoal紐づけUI追加 |
| 3.3 計画と整理 (Goal Breakdown) | getGoals + breakdownGoal ツール |
| 3.5 時間感覚の校正 (Calibration) | getCalibrationData ツール + CalibrationFeedback UI |
| 2.2 ターゲットユーザーの課題解決 | Time Blindness対策（Calibration）、目標形骸化防止（Goal Alignment） |

---

## ファイル構成

### 新規作成ファイル

| ファイル | 責務 |
|---|---|
| `src/components/ai/GoalBreakdownPreview.tsx` | 目標分解結果の一覧プレビューUI（複数TaskCandidate表示） |
| `src/components/ai/CalibrationFeedback.tsx` | 時間校正フィードバック表示UI |
| `src/components/ai/GoalSelector.tsx` | Goal選択ドロップダウン（TaskCreationCard内で使用） |

### 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lib/ai/tools.ts` | `getGoals`, `breakdownGoal`, `getCalibrationData` ツール追加 |
| `src/lib/ai/types.ts` | `GoalBreakdownContext`, `CalibrationData`, `GoalSummary` 型追加 |
| `src/lib/ai/prompts.ts` | Goals/Calibrationコンテキストの追加、PromptContext拡張 |
| `src/components/ai/TaskCreationCard.tsx` | GoalSelector統合、Goal紐づけフィールド追加 |
| `src/components/ai/ChatMessage.tsx` | GoalBreakdownPreview/CalibrationFeedback のレンダリング対応 |
| `src/store/slices/aiSlice.ts` | Goals情報キャッシュ、一括確認フロー状態管理 |
| `src/store/types.ts` | AISlice型の更新（変更は自動反映） |
| `src/app/api/ai/chat/route.ts` | Goals/Calibrationデータをプロンプトコンテキストに渡す、maxSteps変更 |
| `src/components/AIChatPanel.tsx` | GoalBreakdown/Calibration検出ロジック追加、一括確認ハンドラ |

---

## 型定義設計（`src/lib/ai/types.ts` 拡張）

### 新規型

```typescript
/**
 * AIコンテキストで使用するGoalの要約情報。
 * 完全なGoal型ではなく、AIが必要とする最小限の情報。
 */
export interface GoalSummary {
  id: string;
  title: string;
  type: 'yearly' | 'monthly' | 'weekly';
  status: 'pending' | 'in_progress' | 'achieved' | 'missed' | 'cancelled';
  progress: number;
  assignedYear: string;
  assignedMonth?: string;
  assignedWeek?: string;
  parentGoalId?: string;
  /** 既に紐づいているタスク数 */
  linkedTaskCount: number;
  /** AI分析情報（存在する場合） */
  aiSuggestedBreakdown?: string[];
  keyResults?: string[];
}

/**
 * breakdownGoalツールの戻り値。
 * Goal情報と既存タスク情報をコンテキストとして返す。
 * 実際のタスク分解はAIモデルが後続のsuggestTask呼び出しで行う。
 */
export interface GoalBreakdownContext {
  type: 'goal_breakdown_context';
  /** 分解元のGoal詳細情報 */
  sourceGoal: {
    id: string;
    title: string;
    type: string;
    description?: string;
    progress?: number;
    aiAnalysis?: {
      suggestedBreakdown?: string[];
      keyResults?: string[];
      feedback?: string;
    };
  };
  /** 既にこのGoalに紐づいているタスクのタイトル（重複回避用） */
  existingTaskTitles: string[];
  /** タスクを配置する日付範囲 */
  dateRange: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
  };
  /** AIが提案すべきタスク数 */
  numberOfTasks: number;
  /** ユーザーからの追加コンテキスト */
  additionalContext?: string;
  /** ツール結果のメッセージ */
  message: string;
}

/**
 * 時間校正データ。
 * 見積もりと実績のギャップを分析するための情報。
 */
export interface CalibrationData {
  type: 'calibration_feedback';
  /** 分析期間 */
  period: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
    days: number;
  };
  /** 全体統計 */
  overall: {
    totalTasks: number;
    completedTasks: number;
    /** 見積もり合計（分） */
    totalEstimatedMinutes: number;
    /** 実績合計（分） */
    totalActualMinutes: number;
    /** 見積もり精度（actual / estimated の比率。1.0が完全一致） */
    accuracyRatio: number;
    /** 平均乖離率（%）。正=超過、負=余裕 */
    averageDeviationPercent: number;
  };
  /** カテゴリ別の見積もり精度（タグ別） */
  byTag?: Array<{
    tag: string;
    taskCount: number;
    avgEstimated: number;
    avgActual: number;
    accuracyRatio: number;
  }>;
  /** 最も見積もりが乖離したタスク（上位5件） */
  worstEstimates: Array<{
    title: string;
    estimated: number;
    actual: number;
    deviationPercent: number;
    date: string;
  }>;
  /** AIからのフィードバックメッセージ */
  message: string;
}

/**
 * getGoalsツールの戻り値
 */
export interface GoalsSummaryResult {
  type: 'goals_summary';
  goals: GoalSummary[];
  /** 期間フィルタの説明 */
  periodDescription: string;
  message: string;
}

/**
 * プロンプトコンテキストに埋め込む見積もり精度ヒント。
 * CalibrationDataから抽出した軽量情報。
 */
export interface CalibrationHint {
  accuracyRatio: number;
  averageDeviationPercent: number;
  sampleSize: number;
}
```

### TaskCandidate型の変更

TaskCandidate型自体にPhase 1で既に `parentGoalId` フィールドが定義されている。GoalBreakdownから生成された場合の識別のため、以下のフィールドを追加する:

```typescript
export interface TaskCandidate {
  // ... 既存フィールドはすべて維持 ...

  /** Phase 2追加: この候補がGoal Breakdownから生成されたかどうか */
  fromGoalBreakdown?: boolean;
  /** Phase 2追加: 同一Breakdown内での順序（一括表示用） */
  breakdownOrder?: number;
}
```

---

## ツール定義設計（`src/lib/ai/tools.ts` 拡張）

### インポート追加

```typescript
// 既存インポートに追加
import { format, addDays, parseISO } from 'date-fns';
import type { GoalType } from '@/types';
import type { GoalSummary, GoalBreakdownContext, CalibrationData, GoalsSummaryResult } from './types';
```

### ToolContext

ToolContext自体は変更不要。新規ツールも既存の `userId`, `currentDate`, `sections` で動作する。

```typescript
interface ToolContext {
  userId: string;
  currentDate: string;
  sections: Section[];
}
```

### getGoals ツール

```typescript
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
  execute: async (args) => {
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
          type: data.type as GoalType,
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
      } satisfies GoalsSummaryResult;
    } catch (error) {
      console.error('getGoals error:', error);
      return {
        type: 'goals_summary' as const,
        goals: [],
        periodDescription: '',
        message: '目標情報の取得に失敗しました。',
      } satisfies GoalsSummaryResult;
    }
  },
}),
```

### breakdownGoal ツール

```typescript
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
  execute: async (args) => {
    // breakdownGoalは「コンテキスト収集」のみを行う。
    // 実際のタスク分解はAIモデルが後続のsuggestTask複数呼び出しで行う。
    // これにより:
    //   - 既存のsuggestTask -> TaskCreationCardフローを再利用
    //   - 各タスクを個別に確認・編集可能（User Agency原則）
    //   - AIモデルの自然言語能力でタスク名・見積もりを生成

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
        } satisfies GoalBreakdownContext;
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
      } satisfies GoalBreakdownContext;
    } catch (error) {
      console.error('breakdownGoal error:', error);
      return {
        type: 'goal_breakdown_context' as const,
        sourceGoal: { id: args.goalId, title: args.goalTitle, type: 'unknown' },
        existingTaskTitles: [],
        dateRange: { start: context.currentDate, end: context.currentDate },
        numberOfTasks: args.numberOfTasks || 5,
        message: '目標情報の取得に失敗しました。',
      } satisfies GoalBreakdownContext;
    }
  },
}),
```

**設計判断: breakdownGoalの2段階アプローチ**

Goal Breakdownは以下の2段階で実現する:

1. **breakdownGoalツール**: Goal情報と既存タスク情報をコンテキストとして取得（DB読み取りのみ）
2. **AIモデルのテキスト応答 + 複数suggestTask呼び出し**: breakdownGoalの結果を基に、AIが具体的なタスク名・見積もり・日程を考えて、`suggestTask`ツールを複数回呼び出す

この設計により:
- 既存のsuggestTask -> TaskCreationCardフローをそのまま再利用できる
- 各タスクを個別に確認・編集・承認/却下できる（User Agency原則）
- breakdownGoalツール内で「正解の分解」をハードコードする必要がない

**route.tsの`maxSteps`を調整する必要あり**:
```typescript
// 現在: maxSteps未指定（デフォルト）
// Phase 2: getGoals(1) + breakdownGoal(1) + suggestTask(最大5回) + テキスト応答(1回) = 8ステップ
maxSteps: 8,
```

### getCalibrationData ツール

```typescript
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
  execute: async (args) => {
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
      // 注意: userId + status + date の複合インデックスが必要
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
        } satisfies CalibrationData;
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
      } satisfies CalibrationData;
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
      } satisfies CalibrationData;
    }
  },
}),
```

---

## プロンプト設計（`src/lib/ai/prompts.ts` 拡張）

### PromptContext の拡張

```typescript
import type { GoalSummary, CalibrationHint } from './types';

interface PromptContext {
  currentDate: string;
  // Phase 2追加
  /** ユーザーのアクティブなGoals概要（クライアントキャッシュから渡される） */
  activeGoals?: GoalSummary[];
  /** 直近の見積もり精度情報（CalibrationDataから抽出した軽量版） */
  calibrationHint?: CalibrationHint;
}
```

### buildSystemPromptの変更

```typescript
export function buildSystemPrompt(context: PromptContext): string {
  return [
    PERSONA_SECTION,
    RULES_SECTION,
    TOOL_GUIDE_SECTION,           // Phase 1のガイド（変更なし）
    GOAL_GUIDE_SECTION,           // Phase 2新規
    CALIBRATION_GUIDE_SECTION,    // Phase 2新規
    buildContextSection(context),
  ].join('\n\n');
}
```

### 新規プロンプトセクション

```typescript
const GOAL_GUIDE_SECTION = `## 目標管理ガイド
### getGoals
ユーザーの目標一覧を取得する際に使用します。
- タスクと目標の紐づけを提案する場合、先にgetGoalsでアクティブな目標を確認してください
- 「今月の目標は？」「目標を確認したい」などの依頼に対応
- suggestTaskで提案する際、関連する目標があれば parentGoalId を設定してください

### breakdownGoal
目標を具体的なタスクに分解する際に使用します。
- まずgetGoalsで目標一覧を取得し、対象の目標IDを特定してください
- breakdownGoalで目標のコンテキスト（既存タスク等）を取得した後、
  suggestTaskを複数回呼び出して各タスクを提案してください
- 各タスクのparentGoalIdには分解元の目標IDを必ず設定してください
- 既存タスクと重複しないタスクを提案してください
- 「今月の目標を分解して」「〇〇の目標からタスクを作って」などの依頼に対応

### 目標紐づけのベストプラクティス
- ユーザーがタスクを追加する際、関連しそうな目標があれば
  「この目標に紐づけますか？」と確認してください（強制はしない）
- 目標に紐づかないタスクも許容してください（全タスクが目標に紐づく必要はない）`;

const CALIBRATION_GUIDE_SECTION = `## 時間校正ガイド
### getCalibrationData
ユーザーの見積もり精度を分析する際に使用します。
- 「見積もりの精度を確認したい」「時間の使い方を振り返りたい」等の依頼に対応
- suggestTaskで見積もり時間を提案する際、過去の実績を考慮してください
- 校正データがある場合は、見積もり時間の提案に反映してください
  - 例: 精度比率が1.5（50%超過傾向）の場合、一般的な30分の見積もりを45分に調整

### 時間校正の方針
- 厳しく指摘するのではなく、データに基づいた「気づき」を提供してください
- 「このタスクは前回45分かかりましたが、今回も同じくらいを見込みますか？」
  のような問いかけスタイルで
- ユーザーが見積もり時間を入力しなかった場合、過去データがあれば
  「この種のタスクは平均〇分かかっているので、〇分で見積もりますか？」と提案`;
```

### buildContextSectionの拡張

```typescript
function buildContextSection(context: PromptContext): string {
  const lines = [
    `## 現在のコンテキスト`,
    `- 現在の日付: ${context.currentDate}`,
  ];

  // Goals情報の追加（最大20件に制限）
  if (context.activeGoals && context.activeGoals.length > 0) {
    lines.push('');
    lines.push('### アクティブな目標');
    const goalsToShow = context.activeGoals.slice(0, 20);
    goalsToShow.forEach(g => {
      const progress = `${g.progress}%`;
      const tasks = `(${g.linkedTaskCount}タスク紐づき)`;
      lines.push(`- [${g.type}] ${g.title} (id: ${g.id}) - 進捗${progress} ${tasks}`);
    });
    if (context.activeGoals.length > 20) {
      lines.push(`- ...他${context.activeGoals.length - 20}件`);
    }
  }

  // Calibration情報の追加
  if (context.calibrationHint && context.calibrationHint.sampleSize > 0) {
    lines.push('');
    lines.push('### 見積もり精度情報');
    const ratio = context.calibrationHint.accuracyRatio;
    const deviation = context.calibrationHint.averageDeviationPercent;
    lines.push(`- 過去の見積もり精度: ${Math.round(ratio * 100)}% (${context.calibrationHint.sampleSize}タスクの平均)`);
    if (Math.abs(deviation) > 20) {
      lines.push(`- 平均乖離: ${deviation > 0 ? '+' : ''}${deviation}% (見積もり調整を推奨)`);
    }
  }

  return lines.join('\n');
}
```

---

## API設計（`src/app/api/ai/chat/route.ts` 変更）

### 変更点

1. **maxSteps の増加**: Goal Breakdown時の複数suggestTask呼び出しに対応
2. **Goals/Calibrationコンテキストの追加**: リクエストボディからGoals情報を受け取り、プロンプトに埋め込む
3. **新ツールの登録**: createAIToolsに渡すコンテキストは変更なし（ツール内部で自律的にFirestore取得）

```typescript
export async function POST(req: Request) {
  console.log('==== AI Chat API Called ====');
  try {
    const json = await req.json();
    const {
      messages,
      userId,
      currentDate,
      sections,
      model: requestedModel,
      // Phase 2追加: クライアントからのGoals/Calibrationヒント
      activeGoals,
      calibrationHint,
    } = json;

    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const modelName = ALLOWED_MODELS.includes(requestedModel)
      ? requestedModel
      : 'gemini-2.5-flash';
    const today = currentDate || format(new Date(), 'yyyy-MM-dd');

    const result = streamText({
      model: google(modelName),
      system: buildSystemPrompt({
        currentDate: today,
        activeGoals,       // Phase 2追加
        calibrationHint,   // Phase 2追加
      }),
      messages: normalizeMessages(messages),
      tools: createAITools({ userId, currentDate: today, sections: sections || [] }),
      toolChoice: 'auto',
      maxSteps: 8,  // Phase 2: getGoals(1) + breakdownGoal(1) + suggestTask(5) + text(1)
    });

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    console.error('AI Chat API Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

### AIChatPanel側のbody変更

```typescript
// AIChatPanel.tsx内
const { messages, sendMessage, status } = useChat({
  api: '/api/ai/chat',
  body: {
    userId: user?.uid,
    model: selectedModel,
    currentDate,
    sections,
    // Phase 2追加
    activeGoals: cachedGoalSummaries,
    calibrationHint: cachedCalibrationHint,
  },
  onError: (error: Error) => {
    console.error('Chat error:', error);
    alert('AIチャットでエラーが発生しました。');
  },
  maxSteps: 5,
} as any);
```

---

## コンポーネント設計

### GoalSelector（`src/components/ai/GoalSelector.tsx`）

TaskCreationCard内で使用するGoal選択ドロップダウン。

```typescript
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
        'bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600',
        'rounded px-2 py-1 text-sm text-zinc-900 dark:text-white',
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
```

#### 実装ポイント
- Zustand storeの `cachedGoalSummaries` からフィルタして使用
- アクティブ（pending/in_progress）なGoalのみ表示（キャッシュ生成時にフィルタ済み）
- 「紐づけなし」オプションで紐づけ解除可能
- Goal typeに応じた日本語ラベル表示

### TaskCreationCard の拡張

既存のTaskCreationCardに以下を追加する:

```typescript
// 変更箇所: Props
interface TaskCreationCardProps {
  candidate: TaskCandidate;
  onConfirm: (candidate: TaskCandidate) => void;
  onDismiss: (tempId: string) => void;
  onEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
  // Phase 2追加
  availableGoals?: GoalSummary[];
}
```

#### UI変更

Goalフィールドは常時表示（`isEditing` に関係なく選択可能）。既存フィールドの下に追加する:

```tsx
{/* Goal Selector - Phase 2 */}
{availableGoals && availableGoals.length > 0 && (
  <div className="flex items-start gap-2">
    <span className="text-zinc-600 dark:text-zinc-400 min-w-[80px]">目標:</span>
    <GoalSelector
      value={editValues.parentGoalId ?? currentValues.parentGoalId}
      onChange={(goalId) => {
        setEditValues({ ...editValues, parentGoalId: goalId });
        onEdit(candidate.tempId, { parentGoalId: goalId });
      }}
      goals={availableGoals}
      className="flex-1"
    />
  </div>
)}
```

Goal選択はisEditingに関係なく常時変更可能とする。これはGoal紐づけが「編集」ではなく「確認」の性質を持つため。AIがparentGoalIdをプリセットした場合、ユーザーはワンクリックで変更または解除できる。

### GoalBreakdownPreview（`src/components/ai/GoalBreakdownPreview.tsx`）

Goal Breakdown実行後、AIが複数のsuggestTaskを呼び出した結果を一覧で表示するコンポーネント。

**重要な設計判断**: GoalBreakdownPreviewは **ChatMessage内でbreakdownGoalの結果と後続のsuggestTask結果をグルーピング表示するラッパー** として機能する。個別のTaskCreationCardの代わりに、一覧形式で複数候補を表示し、一括操作を可能にする。

```typescript
'use client';

import React, { useState, useMemo } from 'react';
import { Target, Check, X, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskCandidate, GoalSummary } from '@/lib/ai/types';

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
    <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
        <Target size={16} />
        <span className="text-sm">目標分解: 「{sourceGoal.title}」</span>
      </div>

      {/* 合計見積もり */}
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
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
              "hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            )}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(c.tempId)}
              onChange={() => toggleSelection(c.tempId)}
              className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-zinc-500 text-xs min-w-[20px]">{idx + 1}.</span>
            <span className="flex-1 text-zinc-900 dark:text-white">{c.title}</span>
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
              ? "bg-amber-600 hover:bg-amber-700 text-white"
              : "bg-zinc-200 dark:bg-zinc-700 text-zinc-400 cursor-not-allowed"
          )}
        >
          <Check size={14} />
          選択を作成 ({selectedCandidates.length}件)
        </button>
        <button
          onClick={handleDismissAll}
          className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded text-sm transition-colors"
        >
          <X size={14} />
          すべてキャンセル
        </button>
      </div>
    </div>
  );
};
```

### CalibrationFeedback（`src/components/ai/CalibrationFeedback.tsx`）

```typescript
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
  if (percent >= 80 && percent <= 120) return 'text-green-600 dark:text-green-400';
  if (percent >= 60 && percent <= 150) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
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
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 mt-2">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Clock size={16} />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg p-4 mt-2 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 font-medium text-sm">
        <Clock size={16} className="text-zinc-600 dark:text-zinc-400" />
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
        <div className="relative h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", getBarColor(overall.accuracyRatio))}
            style={{ width: `${barWidth / 2}%` }}
          />
          {/* 100%マーカー */}
          <div className="absolute top-0 left-1/2 w-0.5 h-full bg-zinc-400 dark:bg-zinc-500" />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>

      {/* 統計サマリ */}
      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        <div>分析対象: {overall.totalTasks}タスク</div>
        <div>平均乖離: {overall.averageDeviationPercent > 0 ? '+' : ''}{overall.averageDeviationPercent}%</div>
        <div>見積もり合計: {overall.totalEstimatedMinutes}分</div>
        <div>実績合計: {overall.totalActualMinutes}分</div>
      </div>

      {/* 最大乖離タスク */}
      {worstEstimates.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
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
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
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
      <div className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded p-2">
        {message}
      </div>
    </div>
  );
};
```

---

## 状態管理設計（Zustand AISlice 拡張）

### AISlice の拡張

```typescript
import { TaskCandidate, GoalSummary, CalibrationHint } from '@/lib/ai/types';

export interface AISlice {
  // --- Phase 1（既存） ---
  isAIPanelOpen: boolean;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;
  taskCandidates: TaskCandidate[];
  addTaskCandidate: (candidate: TaskCandidate) => void;
  updateTaskCandidate: (tempId: string, updates: Partial<TaskCandidate>) => void;
  confirmTaskCandidate: (tempId: string) => Promise<void>;
  dismissTaskCandidate: (tempId: string) => void;
  clearTaskCandidates: () => void;

  // --- Phase 2 新規 ---

  /** AIコンテキスト用のGoals概要キャッシュ（プロンプト埋め込み用） */
  cachedGoalSummaries: GoalSummary[];
  /** Goalsキャッシュをリフレッシュ（Zustand storeのgoals/tasksから生成） */
  refreshGoalSummaries: () => void;

  /** 見積もり精度のキャッシュ（プロンプトコンテキスト用） */
  cachedCalibrationHint: CalibrationHint | null;
  /** CalibrationHintをセット（getCalibrationDataの結果から抽出） */
  setCalibrationHint: (hint: CalibrationHint | null) => void;

  /** 複数候補の一括確認（Goal Breakdown用） */
  confirmMultipleCandidates: (tempIds: string[]) => Promise<void>;
  /** 複数候補の一括破棄 */
  dismissMultipleCandidates: (tempIds: string[]) => void;
}
```

### 実装

```typescript
export const createAISlice: StateCreator<StoreState, [], [], AISlice> = (set, get) => ({
  // --- Phase 1（既存のまま維持） ---
  isAIPanelOpen: false,
  toggleAIPanel: () => set((state) => ({ isAIPanelOpen: !state.isAIPanelOpen })),
  setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),

  taskCandidates: [],

  addTaskCandidate: (candidate) =>
    set((state) => ({
      taskCandidates: [...state.taskCandidates, { ...candidate, status: 'pending' }],
    })),

  updateTaskCandidate: (tempId, updates) =>
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, ...updates } : c
      ),
    })),

  confirmTaskCandidate: async (tempId) => {
    const { taskCandidates, addTask, user } = get();
    const candidate = taskCandidates.find((c) => c.tempId === tempId);
    if (!candidate || !user) return;

    const newTask: Task = {
      id: crypto.randomUUID(),
      userId: user.uid,
      title: candidate.title,
      date: candidate.date,
      estimatedMinutes: candidate.estimatedMinutes,
      actualMinutes: 0,
      scheduledStart: candidate.scheduledStart,
      sectionId: candidate.sectionId,
      status: 'open',
      order: 0,
      memo: candidate.memo,
      parentGoalId: candidate.parentGoalId,
      projectId: candidate.projectId,
      aiTags: candidate.aiTags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, status: 'confirmed' as const } : c
      ),
    }));

    await addTask(newTask);
  },

  dismissTaskCandidate: (tempId) =>
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, status: 'dismissed' as const } : c
      ),
    })),

  clearTaskCandidates: () => set({ taskCandidates: [] }),

  // --- Phase 2 新規 ---

  cachedGoalSummaries: [],

  refreshGoalSummaries: () => {
    const { goals, tasks } = get();
    // activeなGoalのみをGoalSummaryに変換
    const activeGoals = goals.filter(
      g => g.status === 'pending' || g.status === 'in_progress'
    );

    const summaries: GoalSummary[] = activeGoals.map(g => {
      const linkedTaskCount = tasks.filter(t => t.parentGoalId === g.id).length;

      return {
        id: g.id,
        title: g.title,
        type: g.type,
        status: g.status,
        progress: g.progress,
        assignedYear: g.assignedYear,
        assignedMonth: g.assignedMonth,
        assignedWeek: g.assignedWeek,
        parentGoalId: g.parentGoalId,
        linkedTaskCount,
        aiSuggestedBreakdown: g.aiAnalysis?.suggestedBreakdown,
        keyResults: g.aiAnalysis?.keyResults,
      };
    });

    set({ cachedGoalSummaries: summaries });
  },

  cachedCalibrationHint: null,

  setCalibrationHint: (hint) => set({ cachedCalibrationHint: hint }),

  confirmMultipleCandidates: async (tempIds) => {
    // 逐次的に確認（並列実行はFirestoreの競合リスクがあるため）
    for (const tempId of tempIds) {
      await get().confirmTaskCandidate(tempId);
    }
  },

  dismissMultipleCandidates: (tempIds) => {
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        tempIds.includes(c.tempId) ? { ...c, status: 'dismissed' as const } : c
      ),
    }));
  },
});
```

### GoalSummaryキャッシュの更新タイミング

AIパネルを開いた時に `refreshGoalSummaries()` を呼び出す。これにより、チャットリクエストのたびにGoals情報がプロンプトに含まれる。

```typescript
// AIChatPanel.tsx に追加
useEffect(() => {
  if (isAIPanelOpen) {
    refreshGoalSummaries();
  }
}, [isAIPanelOpen, refreshGoalSummaries]);
```

---

## データフロー設計

### Goal Breakdown フロー（シーケンス）

```
User: 「今月の目標『サイト公開』を分解して」
  |
  v
AIChatPanel → POST /api/ai/chat
  (body: { activeGoals, calibrationHint, ... })
  |
  v
route.ts: streamText (プロンプトにactiveGoals含む, maxSteps: 8)
  |
  v
AI Model:
  Step 1: getGoals(type: "monthly") → GoalsSummaryResult
  Step 2: breakdownGoal(goalId: "xxx", numberOfTasks: 5) → GoalBreakdownContext
  Step 3-7: suggestTask x 5回（各タスクを個別提案、parentGoalId設定済み）
  Step 8: テキスト応答「5つのタスクを提案しました。確認してください。」
  |
  v
AIChatPanel: useEffect でメッセージを監視
  → 5つのtask_suggestionを検出
  → addTaskCandidate x 5
  |
  v
ChatMessage: 5つのTaskCreationCardを表示
  （同一GoalIdを持つcandidatesをGoalBreakdownPreviewでグルーピング表示可能）
  |
  v
User: 各カードを確認・編集 → 「作成」or「キャンセル」
  （またはGoalBreakdownPreviewの「選択を作成」で一括確認）
  |
  v
confirmTaskCandidate / confirmMultipleCandidates
  → addTask x N → BFF /api/tasks → Firestore
  → authSlice onSnapshot → タスクリストUI自動更新
```

### Calibration フロー

```
User: 「見積もりの精度を確認したい」
  |
  v
AIChatPanel → POST /api/ai/chat
  |
  v
route.ts: streamText
  |
  v
AI Model:
  Step 1: getCalibrationData(daysBack: 14) → CalibrationData
  Step 2: テキスト応答（分析結果に基づくフィードバック）
  |
  v
AIChatPanel: useEffect で calibration_feedback を検出
  → setCalibrationHint({
      accuracyRatio: data.overall.accuracyRatio,
      averageDeviationPercent: data.overall.averageDeviationPercent,
      sampleSize: data.overall.totalTasks,
    })
  |
  v
ChatMessage: CalibrationFeedback コンポーネントを表示
  |
  v
以降のsuggestTask: プロンプトにcalibrationHintが含まれるため、
  AIが見積もり時間を自動調整して提案
  例: 精度130%の場合、AIは「30分ではなく40分で見積もりませんか？」と提案
```

### suggestTask + Goal自動紐づけ フロー

```
User: 「明日レビュー会議を追加して」
  |
  v
AI Model:
  (プロンプトにactiveGoals含まれている)
  → 「サイト公開」目標と関連があると判断
  Step 1: suggestTask(title: "レビュー会議", parentGoalId: "xxx")
  Step 2: テキスト応答「目標『サイト公開』に紐づけて提案しました」
  |
  v
TaskCreationCard表示:
  - タイトル: レビュー会議
  - 目標: [v サイト公開 (月間)] ← GoalSelector表示、AIがプリセット
  |
  v
User: Goal選択を確認or変更or「紐づけなし」に変更 → 「作成」
```

---

## ChatMessage の拡張

### 新規ツール結果の表示対応

```typescript
// ChatMessage.tsx

// 1. インポート追加
import { CalibrationFeedback } from './CalibrationFeedback';
import type { GoalSummary, CalibrationData } from '@/lib/ai/types';

// 2. toolPartsフィルタの拡張
const toolParts = parts.filter((p) =>
  p.type === 'tool-suggestTask' ||
  p.type === 'tool-getTodayTasks' ||
  p.type === 'tool-getGoals' ||           // Phase 2追加
  p.type === 'tool-breakdownGoal' ||      // Phase 2追加
  p.type === 'tool-getCalibrationData' || // Phase 2追加
  p.type === 'dynamic-tool'
);

// 3. ツール名判定の追加（toolParts.map内）
const isGetGoals = toolName === 'getGoals' || part.type === 'tool-getGoals';
const isBreakdownGoal = toolName === 'breakdownGoal' || part.type === 'tool-breakdownGoal';
const isGetCalibrationData = toolName === 'getCalibrationData' || part.type === 'tool-getCalibrationData';

// 4. レンダリング分岐の追加（part.state === 'output-available' 内）

// getGoals の結果表示
if (isGetGoals && part.output?.type === 'goals_summary') {
  return (
    <GoalsSummaryDisplay
      key={part.toolCallId ?? idx}
      goals={part.output.goals}
      periodDescription={part.output.periodDescription}
    />
  );
}

// getCalibrationData の結果表示
if (isGetCalibrationData && part.output?.type === 'calibration_feedback') {
  return (
    <CalibrationFeedback
      key={part.toolCallId ?? idx}
      data={part.output as CalibrationData}
    />
  );
}

// breakdownGoal の結果表示（コンテキスト情報表示、タスク自体はsuggestTaskで表示）
if (isBreakdownGoal && part.output?.type === 'goal_breakdown_context') {
  return (
    <div key={part.toolCallId ?? idx} className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600">
      <div className="text-sm space-y-1">
        <p className="font-medium text-amber-700 dark:text-amber-400">
          目標分解: 「{part.output.sourceGoal.title}」
        </p>
        <p className="text-zinc-500 dark:text-zinc-400 text-xs">
          既存タスク: {part.output.existingTaskTitles.length}件 |
          提案予定: {part.output.numberOfTasks}件 |
          期間: {part.output.dateRange.start} ~ {part.output.dateRange.end}
        </p>
      </div>
    </div>
  );
}
```

### GoalsSummaryDisplay（ChatMessage内サブコンポーネント）

```typescript
const GoalsSummaryDisplay: React.FC<{
  goals: GoalSummary[];
  periodDescription: string;
}> = ({ goals, periodDescription }) => (
  <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-600">
    <p className="font-medium text-sm mb-2">目標一覧 ({periodDescription})</p>
    {goals.length === 0 ? (
      <p className="text-xs text-zinc-500">該当する目標がありません</p>
    ) : (
      <div className="space-y-1">
        {goals.map(g => (
          <div key={g.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium",
                g.type === 'yearly' && "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
                g.type === 'monthly' && "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
                g.type === 'weekly' && "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
              )}>
                {g.type === 'yearly' ? '年間' : g.type === 'monthly' ? '月間' : '週間'}
              </span>
              <span className="text-zinc-900 dark:text-white">{g.title}</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-500">
              <span>{g.progress}%</span>
              <span>{g.linkedTaskCount}タスク</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);
```

---

## AIChatPanel の拡張

### 変更箇所

```typescript
// AIChatPanel.tsx

// 1. ストアから追加の値を取得
const {
  isAIPanelOpen,
  toggleAIPanel,
  user,
  currentDate,
  sections,
  taskCandidates,
  addTaskCandidate,
  confirmTaskCandidate,
  dismissTaskCandidate,
  updateTaskCandidate,
  // Phase 2追加
  cachedGoalSummaries,
  refreshGoalSummaries,
  cachedCalibrationHint,
  setCalibrationHint,
  confirmMultipleCandidates,
  dismissMultipleCandidates,
} = useStore();

// 2. AIパネルオープン時にGoalSummaryをリフレッシュ
useEffect(() => {
  if (isAIPanelOpen) {
    refreshGoalSummaries();
  }
}, [isAIPanelOpen, refreshGoalSummaries]);

// 3. useChat bodyにPhase 2データを追加
const { messages, sendMessage, status } = useChat({
  api: '/api/ai/chat',
  body: {
    userId: user?.uid,
    model: selectedModel,
    currentDate,
    sections,
    activeGoals: cachedGoalSummaries,      // Phase 2追加
    calibrationHint: cachedCalibrationHint, // Phase 2追加
  },
  // ...
} as any);

// 4. TaskCandidate検出useEffectに calibration_feedback 検出を追加
useEffect(() => {
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant?.parts) return;

  for (const part of lastAssistant.parts) {
    const partAny = part as any;
    if (partAny.type?.startsWith('tool-') && partAny.state === 'output-available') {
      const output = partAny.output as any;

      // 既存: task_suggestion検出
      if (output?.type === 'task_suggestion' && output?.candidate) {
        const candidate = output.candidate as TaskCandidate;
        const alreadyExists = taskCandidates.some(c => c.tempId === candidate.tempId);
        if (!alreadyExists) {
          addTaskCandidate(candidate);
        }
      }

      // Phase 2追加: calibration_feedback検出 → キャッシュ更新
      if (output?.type === 'calibration_feedback' && output?.overall) {
        setCalibrationHint({
          accuracyRatio: output.overall.accuracyRatio,
          averageDeviationPercent: output.overall.averageDeviationPercent,
          sampleSize: output.overall.totalTasks,
        });
      }
    }
  }
}, [messages, taskCandidates, addTaskCandidate, setCalibrationHint]);

// 5. ChatMessageに availableGoals を渡す（TaskCreationCardで使用）
{messages.map((m) => (
  <ChatMessage
    key={m.id}
    message={m}
    onTaskConfirm={handleTaskConfirm}
    onTaskDismiss={dismissTaskCandidate}
    onTaskEdit={updateTaskCandidate}
    availableGoals={cachedGoalSummaries}  // Phase 2追加
  />
))}
```

### ChatMessageProps の拡張

```typescript
// ChatMessage.tsx
interface ChatMessageProps {
  message: UIMessage;
  onTaskConfirm: (candidate: TaskCandidate) => void;
  onTaskDismiss: (tempId: string) => void;
  onTaskEdit: (tempId: string, updates: Partial<TaskCandidate>) => void;
  // Phase 2追加
  availableGoals?: GoalSummary[];
}

// TaskCreationCardレンダリング時にavailableGoalsを渡す
<TaskCreationCard
  key={part.toolCallId ?? idx}
  candidate={part.output.candidate as TaskCandidate}
  onConfirm={onTaskConfirm}
  onDismiss={onTaskDismiss}
  onEdit={onTaskEdit}
  availableGoals={availableGoals}  // Phase 2追加
/>
```

---

## Firestoreインデックス要件

Phase 2で必要な追加Firestoreインデックス:

```json
{
  "indexes": [
    {
      "collectionGroup": "goals",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "tasks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "parentGoalId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "tasks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "date", "order": "ASCENDING" }
      ]
    }
  ]
}
```

**注意**: `getCalibrationData`で使用する `userId + status + date` の3フィールド複合クエリには複合インデックスが必要。初回実行時にFirebaseがインデックス作成URLをサーバーコンソールに表示するため、それを使って作成しても良い。

---

## GoalsのFirestoreリスナーに関する発見事項

### 現状

現在の`authSlice.ts`にGoalsのFirestoreリスナーが登録されていない。GoalSliceのCRUD操作はOptimistic UIパターンで直接Firestoreに書き込んでいるが、他のデバイスやタブでの変更がリアルタイムに反映されない。

### Phase 2での対応方針

Phase 2では、AIがGoals情報を参照するため、Goalsデータの鮮度が重要になる。ただし、リスナー追加はPhase 2のスコープ外であり、別途対応する。以下の2つのレイヤーで対応する:

1. **AIツール側（サーバー）**: `getGoals`ツールはFirestore Admin SDKで直接クエリするため、常に最新データを取得できる。ユーザーが「目標を教えて」と言えば、最新のGoals一覧が返される。
2. **プロンプトコンテキスト側（クライアント）**: `refreshGoalSummaries()`はZustand storeの`goals`配列から生成する。AIパネルを開いた時点のスナップショットであり、セッション中に別タブで変更された場合は古い情報が含まれる可能性がある。ただし、プロンプトのコンテキスト情報としては許容範囲。

**将来的な改善**: authSlice.tsにGoalsのonSnapshotリスナーを追加し、リアルタイム同期を実現する。

---

## 実装順序（Devエージェント向けステップバイステップ）

### Step 1: 型定義の拡張
**ファイル**: `src/lib/ai/types.ts`
**作業内容**:
  - `GoalSummary`, `GoalBreakdownContext`, `CalibrationData`, `GoalsSummaryResult`, `CalibrationHint` 型を追加
  - `TaskCandidate` に `fromGoalBreakdown?`, `breakdownOrder?` フィールドを追加
**検証**: TypeScriptコンパイルが通ること

### Step 2: getGoals ツールの実装
**ファイル**: `src/lib/ai/tools.ts`
**作業内容**:
  - `date-fns` と `GoalType` のインポート追加
  - 新規型のインポート追加
  - `getGoals` ツールを `createAITools` の返り値オブジェクト内に追加
  - Goals取得 + 紐づけタスク数カウント（`in`クエリ30件バッチ対応）
  - エラーハンドリング（try/catch）
**依存**: Step 1
**検証**: `npm run build` が通ること

### Step 3: getCalibrationData ツールの実装
**ファイル**: `src/lib/ai/tools.ts`
**作業内容**:
  - `getCalibrationData` ツールを追加
  - 完了タスクの見積もり/実績集計ロジック
  - 統計計算（精度比率、乖離率、タグ別統計）
  - メッセージ生成ロジック
**依存**: Step 1
**検証**: `npm run build` が通ること

### Step 4: breakdownGoal ツールの実装
**ファイル**: `src/lib/ai/tools.ts`
**作業内容**:
  - `breakdownGoal` ツールを追加
  - Goal詳細取得 + 既存タスク取得（重複回避用）
  - `GoalBreakdownContext` 型の結果を返却
**依存**: Step 1
**検証**: `npm run build` が通ること

### Step 5: プロンプトの拡張
**ファイル**: `src/lib/ai/prompts.ts`
**作業内容**:
  - `GoalSummary`, `CalibrationHint` 型をインポート
  - `PromptContext` インターフェースに `activeGoals`, `calibrationHint` を追加
  - `GOAL_GUIDE_SECTION`, `CALIBRATION_GUIDE_SECTION` 定数を追加
  - `buildSystemPrompt` に新規セクションを追加
  - `buildContextSection` にGoals/Calibration情報の動的埋め込みを追加（最大20件制限）
**依存**: Step 1
**検証**: `buildSystemPrompt({ currentDate: '2026-02-14', activeGoals: [testGoal] })` が期待通りの文字列を返すこと

### Step 6: AISlice の拡張
**ファイル**: `src/store/slices/aiSlice.ts`
**作業内容**:
  - `GoalSummary`, `CalibrationHint` 型のインポート追加
  - `cachedGoalSummaries: []`, `refreshGoalSummaries()` を追加
  - `cachedCalibrationHint: null`, `setCalibrationHint()` を追加
  - `confirmMultipleCandidates()`, `dismissMultipleCandidates()` を追加
**依存**: Step 1
**検証**: `useStore.getState().cachedGoalSummaries` が空配列で初期化されること

### Step 7: route.ts の更新
**ファイル**: `src/app/api/ai/chat/route.ts`
**作業内容**:
  - リクエストボディのdestructureに `activeGoals`, `calibrationHint` を追加
  - `buildSystemPrompt` に渡すコンテキストを拡張
  - `maxSteps` を `8` に変更
**依存**: Step 5
**検証**: `npm run build` が通ること

### Step 8: GoalSelector コンポーネントの実装
**ファイル**: `src/components/ai/GoalSelector.tsx` (新規作成)
**作業内容**:
  - ドロップダウンUI（select要素 + Tailwind CSS）
  - Goal type別の日本語ラベル表示
  - 「紐づけなし」オプション
  - ダーク/ライトモード対応
**依存**: Step 1
**検証**: Storybook確認（可能であれば）

### Step 9: TaskCreationCard の拡張
**ファイル**: `src/components/ai/TaskCreationCard.tsx`
**作業内容**:
  - `availableGoals` propsを追加
  - GoalSelectorをインポート・統合（目標フィールドの追加）
  - Goal変更を `editValues` / `onEdit` に反映
**依存**: Step 8
**検証**: TaskCreationCardにGoalドロップダウンが表示されること

### Step 10: CalibrationFeedback コンポーネントの実装
**ファイル**: `src/components/ai/CalibrationFeedback.tsx` (新規作成)
**作業内容**:
  - プログレスバー（精度比率の可視化）
  - 統計サマリ表示（グリッドレイアウト）
  - 最大乖離タスクリスト
  - タグ別統計表示
  - 色分けロジック（緑/黄/赤）
  - Tailwind CSSでダーク/ライトモード対応
**依存**: Step 1
**検証**: Storybook確認（可能であれば）

### Step 11: GoalBreakdownPreview コンポーネントの実装
**ファイル**: `src/components/ai/GoalBreakdownPreview.tsx` (新規作成)
**作業内容**:
  - チェックボックス付きタスク候補リスト
  - 選択/全選択/解除の状態管理
  - 「選択を作成」「すべてキャンセル」ボタン
  - 合計見積もり時間のリアルタイム表示
  - Tailwind CSSでダーク/ライトモード対応
**依存**: Step 1
**検証**: Storybook確認（可能であれば）

### Step 12: ChatMessage の拡張
**ファイル**: `src/components/ai/ChatMessage.tsx`
**作業内容**:
  - CalibrationFeedback, GoalSummary型のインポート追加
  - `ChatMessageProps` に `availableGoals?` を追加
  - `toolParts` フィルタに `tool-getGoals`, `tool-breakdownGoal`, `tool-getCalibrationData` を追加
  - ツール名判定の追加（isGetGoals, isBreakdownGoal, isGetCalibrationData）
  - 各ツール結果の表示コンポーネントをレンダリング
  - GoalsSummaryDisplay サブコンポーネントの定義
  - TaskCreationCardに `availableGoals` を渡す
**依存**: Step 8, Step 10, Step 11
**検証**: チャットで各ツール結果が正しく表示されること

### Step 13: AIChatPanel の拡張
**ファイル**: `src/components/AIChatPanel.tsx`
**作業内容**:
  - ストアから `refreshGoalSummaries`, `cachedGoalSummaries`, `cachedCalibrationHint`, `setCalibrationHint`, `confirmMultipleCandidates`, `dismissMultipleCandidates` を取得
  - AIパネルオープン時に `refreshGoalSummaries()` を呼び出すuseEffect追加
  - useChat の `body` に `activeGoals`, `calibrationHint` を追加
  - TaskCandidate検出useEffect内に `calibration_feedback` 検出ロジックを追加
  - ChatMessageに `availableGoals` を渡す
**依存**: Step 6, Step 9, Step 12
**検証**: AIパネルオープン時にGoals情報がプロンプトに含まれること

### Step 14: Firestoreインデックスの作成
**作業内容**:
  - Firebase Consoleまたは `firestore.indexes.json` で必要なインデックスを作成
  - `goals: userId + type`
  - `tasks: userId + parentGoalId`
  - `tasks: userId + status + date`
**検証**: 各ツールのFirestoreクエリがエラーなく実行されること

### Step 15: 統合テスト
**作業内容**:
  1. `npm run build` が通ること
  2. `npm run lint` が通ること
  3. 以下の手動テストシナリオを実施:

#### テストシナリオ一覧

| # | シナリオ | 期待結果 |
|---|---------|----------|
| 1 | 「今月の目標を教えて」 | getGoalsが実行され、Goals一覧が表示される |
| 2 | 「『サイト公開』の目標を分解して」 | breakdownGoal + 複数suggestTask実行、複数TaskCreationCard表示 |
| 3 | TaskCreationCardのGoalドロップダウンを変更 | parentGoalIdが変更され、確定時に正しいGoalに紐づく |
| 4 | Goal Breakdown後に複数タスクを一括作成 | 全選択TaskCandidateがFirestoreに保存される |
| 5 | Goal Breakdown後、一部をキャンセル | キャンセルしたものはFirestoreに保存されない |
| 6 | 「見積もりの精度を確認したい」 | getCalibrationData実行、CalibrationFeedback表示 |
| 7 | Calibration後にタスク追加 | AIが見積もり時間を過去データに基づいて調整 |
| 8 | Goalsが0件の場合に「目標を教えて」 | 「該当する目標がありません」と表示、エラーにならない |
| 9 | 完了タスクが0件でCalibration要求 | 「データなし」メッセージが表示される |
| 10 | 日付未指定でタスク追加、関連Goal自動紐づけ | AIが適切なGoalを推定してparentGoalIdを設定 |
| 11 | TaskCreationCardで「紐づけなし」を選択して作成 | parentGoalIdがundefinedでFirestoreに保存される |
| 12 | 30件超のGoalsがある場合 | getGoalsが`in`クエリバッチ分割で正常に動作 |

---

## 注意点・制約

### 既存コードとの整合性

1. **GoalSliceのリスナー不在**: authSlice.tsにGoalsのFirestoreリスナーが未登録。Phase 2ではAIツール側（サーバー）がAdmin SDKで直接取得するため主要なフローには影響なし。ただし、`refreshGoalSummaries()` はZustand storeの `goals` 配列に依存するため、ページリロードなしでは他デバイスの変更が反映されない点に注意
2. **BFFパターンの維持**: 新規ツール（getGoals, breakdownGoal, getCalibrationData）はすべて読み取り専用。書き込みは引き続き suggestTask -> TaskCreationCard -> confirmTaskCandidate -> addTask のフローを維持
3. **onSnapshotによるタスクリスナー**: authSlice.tsのタスクリスナーは `userId` でフィルタしており、confirmTaskCandidate経由でFirestoreに書き込まれたタスクは自動的にUIに反映される
4. **GoalSelector の Goals データソース**: TaskCreationCardに渡す `availableGoals` はAISliceの `cachedGoalSummaries` から取得。GoalSliceの `goals` と同期されるが、リアルタイムではない

### パフォーマンス

1. **getGoalsの紐づけタスク数カウント**: Firestoreの `in` クエリ（最大30件バッチ）で最適化する。Goalsが30件を超える場合は複数バッチに分割
2. **getCalibrationDataのクエリ**: `userId + status + date` の3条件クエリは複合インデックスが必要。daysBackが大きい場合（90日等）はドキュメント数が増えるため注意。デフォルト14日で制限
3. **breakdownGoal + 複数suggestTask**: maxSteps: 8で最大5つのタスクを提案。AIの応答時間は通常の1メッセージより長くなるため、ストリーミングUIで中間状態（Loader2アニメーション）を表示する
4. **プロンプトサイズ**: `buildContextSection` でactiveGoalsを最大20件に制限し、プロンプトの肥大化を防止

### AI SDK v6 の互換性

1. **maxStepsの変更**: サーバー側 `maxSteps: 8` は、getGoals(1) + breakdownGoal(1) + suggestTask(5) + テキスト(1) の8ステップに対応。クライアント側の `maxSteps: 5` は据え置き（サーバー側で制御されるため）
2. **複数ツール呼び出しの表示**: AI SDK v6ではmaxSteps内の複数ツール呼び出しが `parts` 配列に順番に追加される。ChatMessageで全partsをイテレートする現在の実装で対応可能
3. **ストリーミング中のTaskCandidate検出**: useEffectの `[messages]` 依存により、各suggestTask完了時にTaskCandidateが順次追加される。BUG-001修正済みのtempId重複チェックが引き続き有効

### セキュリティ

1. **userId の検証**: Phase 1と同様、`req.body.userId` をそのまま使用。Phase 3以降でFirebase Auth トークン検証を追加すべき
2. **Goal/Task読み取り権限**: サーバーサイド（Admin SDK）で実行するため、Firestore Security Rulesの影響を受けない。ただし、`userId` がリクエストで偽装される可能性がある（Phase 3で対応）

### Phase 3 への接続点

Phase 2完了後、以下の機能追加がスムーズに行えるよう設計している:

1. **タイマー制御**: `startTask` ツールで既存タスクのタイマーを開始。TaskSliceの `updateTask` で `startedAt` を設定
2. **割り込み対応**: `interruptTask` ツールで現在のタスクを一時停止し、割り込みタスクを提案
3. **日次レビュー**: `getDailyReview` ツールでCalibrationData + 当日の完了/未完了サマリを生成
4. **ルーティン提案**: タスクパターン検出ロジックを `getCalibrationData` の拡張として実装
5. **Firebase Auth トークン検証**: route.tsでFirebase IDトークンを検証し、userId偽装を防止

---

## 変更ファイル一覧（サマリ）

### 新規作成（3ファイル）
| ファイル | 行数目安 |
|---|---|
| `src/components/ai/GoalSelector.tsx` | ~60行 |
| `src/components/ai/CalibrationFeedback.tsx` | ~130行 |
| `src/components/ai/GoalBreakdownPreview.tsx` | ~120行 |

### 変更（8ファイル）
| ファイル | 変更規模 |
|---|---|
| `src/lib/ai/types.ts` | +90行（新規型5つ、TaskCandidate拡張） |
| `src/lib/ai/tools.ts` | +260行（新規ツール3つ、インポート追加） |
| `src/lib/ai/prompts.ts` | +80行（PromptContext拡張、新規セクション2つ、buildContextSection拡張） |
| `src/store/slices/aiSlice.ts` | +60行（キャッシュ、一括操作） |
| `src/components/ai/TaskCreationCard.tsx` | +20行（GoalSelector統合） |
| `src/components/ai/ChatMessage.tsx` | +90行（新ツール結果表示、GoalsSummaryDisplay） |
| `src/components/AIChatPanel.tsx` | +25行（コンテキスト拡張、calibration検出） |
| `src/app/api/ai/chat/route.ts` | +8行（body拡張、maxSteps変更） |

### 合計: 新規3ファイル + 変更8ファイル、約770行の追加・変更

---

## QA向けテストケース作成依頼事項

Phase 2の実装完了後、QAエージェントに以下のテストケース作成を依頼する:

1. **getGoals**: 各GoalType（yearly/monthly/weekly/all）のフィルタ動作、statusフィルタ（active/all）
2. **breakdownGoal**: Goal詳細取得、既存タスクとの重複回避確認、日付範囲の正確性
3. **getCalibrationData**: 期間指定の正確性、統計計算の正確性（精度比率、乖離率）、タグ別統計
4. **TaskCreationCard + GoalSelector**: Goal紐づけの作成・変更・解除、AIプリセットの確認
5. **GoalBreakdownPreview**: 選択/解除、一括作成、一括キャンセル、合計見積もり表示
6. **CalibrationFeedback**: プログレスバー表示、色分けロジック、乖離タスクリスト
7. **一括確認/破棄**: confirmMultipleCandidates/dismissMultipleCandidatesの動作
8. **エッジケース**: Goals 0件、完了タスク0件、タグなしタスクのCalibration、30件超のGoals
9. **プロンプトコンテキスト**: activeGoals/calibrationHintがプロンプトに正しく含まれること
10. **Phase 1との互換性**: 既存のsuggestTask、getTodayTasks、TaskCreationCardが引き続き正常動作すること
