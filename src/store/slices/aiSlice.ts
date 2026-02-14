// AIパネル開閉状態管理スライス

import { StateCreator } from 'zustand';
import { StoreState } from '../types';
import { TaskCandidate } from '@/lib/ai/types';
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
});
