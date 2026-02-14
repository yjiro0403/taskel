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
