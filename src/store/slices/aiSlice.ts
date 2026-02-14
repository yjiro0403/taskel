// AIパネル開閉状態管理スライス

import { StateCreator } from 'zustand';
import { StoreState } from '../types';
import { TaskCandidate, GoalSummary, CalibrationHint } from '@/lib/ai/types';
import { Task } from '@/types';

export interface AISlice {
  // --- 既存 ---
  isAIPanelOpen: boolean;
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;

  // --- Phase 1 新規 ---
  /** AIが提案したタスク候補のリスト */
  taskCandidates: TaskCandidate[];
  /** 候補を追加（AIツール結果からの呼び出し） */
  addTaskCandidate: (candidate: TaskCandidate) => void;
  /** 候補を編集 */
  updateTaskCandidate: (tempId: string, updates: Partial<TaskCandidate>) => void;
  /** 候補を確定してTaskとして追加（addTaskを内部で呼ぶ） */
  confirmTaskCandidate: (tempId: string) => Promise<void>;
  /** 候補を破棄 */
  dismissTaskCandidate: (tempId: string) => void;
  /** 全候補をクリア */
  clearTaskCandidates: () => void;

  // --- Phase 2 新規 ---
  /** クライアントキャッシュ: アクティブなGoals要約 */
  cachedGoalSummaries: GoalSummary[];
  /** クライアントキャッシュ: 見積もり精度ヒント */
  cachedCalibrationHint: CalibrationHint | null;
  /** Goalsキャッシュを更新 */
  setCachedGoalSummaries: (goals: GoalSummary[]) => void;
  /** Calibrationヒントキャッシュを更新 */
  setCachedCalibrationHint: (hint: CalibrationHint | null) => void;
  /** Goal Breakdown一括確認: 選択された候補を一括で確定 */
  confirmMultipleCandidates: (tempIds: string[]) => Promise<void>;
  /** Goal Breakdown一括破棄: 選択された候補を一括で破棄 */
  dismissMultipleCandidates: (tempIds: string[]) => void;
}

export const createAISlice: StateCreator<StoreState, [], [], AISlice> = (set, get) => ({
  // --- 既存 ---
  isAIPanelOpen: false,
  toggleAIPanel: () => set((state) => ({ isAIPanelOpen: !state.isAIPanelOpen })),
  setAIPanelOpen: (open) => set({ isAIPanelOpen: open }),

  // --- Phase 1 新規 ---
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

    // TaskCandidate → Task 変換
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

    // 候補のステータスを更新
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        c.tempId === tempId ? { ...c, status: 'confirmed' as const } : c
      ),
    }));

    // 既存のaddTask（BFFパターン）でFirestoreに保存
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
  cachedCalibrationHint: null,

  setCachedGoalSummaries: (goals) => set({ cachedGoalSummaries: goals }),

  setCachedCalibrationHint: (hint) => set({ cachedCalibrationHint: hint }),

  confirmMultipleCandidates: async (tempIds) => {
    const { taskCandidates, addTask, user } = get();
    if (!user) return;

    const candidatesToConfirm = taskCandidates.filter(
      (c) => tempIds.includes(c.tempId) && c.status === 'pending'
    );

    // ステータスを一括更新（UI即座反映）
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        tempIds.includes(c.tempId) ? { ...c, status: 'confirmed' as const } : c
      ),
    }));

    // Firestore保存（順次実行）
    for (const candidate of candidatesToConfirm) {
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
      await addTask(newTask);
    }
  },

  dismissMultipleCandidates: (tempIds) =>
    set((state) => ({
      taskCandidates: state.taskCandidates.map((c) =>
        tempIds.includes(c.tempId) ? { ...c, status: 'dismissed' as const } : c
      ),
    })),
});
