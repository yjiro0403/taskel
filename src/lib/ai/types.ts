/**
 * AI関連の型定義
 */

/**
 * AIが提案するタスクの候補データ。
 * DBには保存されず、ユーザーの確認を経てTask型に変換される。
 */
export interface TaskCandidate {
  /** フロントエンドで一意に識別するための一時ID（crypto.randomUUID()） */
  tempId: string;
  /** タスクのタイトル */
  title: string;
  /** 対象日（YYYY-MM-DD形式） */
  date: string;
  /** 見積もり時間（分） */
  estimatedMinutes: number;
  /** 開始時刻（HH:mm形式、任意） */
  scheduledStart?: string;
  /** セクションID */
  sectionId: string;
  /** メモ */
  memo?: string;
  /** 紐づけるGoalのID（任意） */
  parentGoalId?: string;
  /** 紐づけるProjectのID（任意） */
  projectId?: string;
  /** AIが付与したタグ */
  aiTags?: string[];
  /** 候補の状態 */
  status: 'pending' | 'confirmed' | 'dismissed';
  /** この候補を生成したチャットメッセージのID */
  sourceMessageId?: string;
  /** Phase 2追加: この候補がGoal Breakdownから生成されたかどうか */
  fromGoalBreakdown?: boolean;
  /** Phase 2追加: 同一Breakdown内での順序（一括表示用） */
  breakdownOrder?: number;
  /** A1追加: タスク作成と同時にタイマーを開始するか */
  startImmediately?: boolean;
}

/**
 * getTodayTasksツールの戻り値の型
 */
export interface TodayTasksSummary {
  date: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  inProgressTasks: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  tasks: TaskSummaryItem[];
}

export interface TaskSummaryItem {
  id: string;
  title: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  scheduledStart?: string;
  sectionId: string;
  parentGoalId?: string;
}

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
 * Daily Reviewデータ。
 * 1日の終わりに完了タスク・未完了タスク・統計・目標進捗をまとめた振り返り情報。
 */
export interface DailyReviewData {
  type: 'daily_review';
  date: string;
  /** 完了タスク一覧 */
  completedTasks: Array<{
    title: string;
    estimatedMinutes: number;
    actualMinutes: number;
    parentGoalId?: string;
    goalTitle?: string;
  }>;
  /** 未完了タスク一覧 (open / in_progress) */
  incompleteTasks: Array<{
    title: string;
    status: string;
    estimatedMinutes: number;
  }>;
  /** スキップされたタスク */
  skippedTasks: Array<{ title: string }>;
  /** 全体統計 */
  stats: {
    totalTasks: number;
    completedCount: number;
    incompleteCount: number;
    skippedCount: number;
    completionRate: number;         // 0-100
    totalEstimatedMinutes: number;
    totalActualMinutes: number;
    accuracyRatio: number;          // actual / estimated
  };
  /** 目標別進捗 (今日タスクが紐づいているGoalのみ) */
  goalProgress: Array<{
    goalId: string;
    goalTitle: string;
    tasksCompleted: number;
    tasksTotal: number;
  }>;
  /** AIが生成するサマリメッセージ */
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
