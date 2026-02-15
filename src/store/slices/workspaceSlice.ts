// Taskel AI Workspace スライス
// コメント管理、タスク詳細モーダル、AI処理トリガーを担当

import { StateCreator } from 'zustand';
import { StoreState } from '../types';
import { TaskComment } from '@/types';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface WorkspaceSlice {
  // コメント管理
  taskComments: Record<string, TaskComment[]>;
  commentsLoading: Record<string, boolean>;
  aiProcessing: Record<string, boolean>;

  // タスク詳細モーダル
  activeDetailTaskId: string | null;

  // Actions
  fetchComments: (taskId: string) => Promise<void>;
  addUserComment: (taskId: string, content: string) => Promise<void>;
  triggerAIProcess: (taskId: string) => Promise<void>;
  triggerAIReply: (taskId: string) => Promise<void>;
  subscribeToComments: (taskId: string) => () => void;
  openTaskDetail: (taskId: string) => void;
  closeTaskDetail: () => void;
}

export const createWorkspaceSlice: StateCreator<StoreState, [], [], WorkspaceSlice> = (set, get) => ({
  taskComments: {},
  commentsLoading: {},
  aiProcessing: {},
  activeDetailTaskId: null,

  fetchComments: async (taskId: string) => {
    set(state => ({
      commentsLoading: { ...state.commentsLoading, [taskId]: true },
    }));

    try {
      const user = get().user;
      if (!user) return;

      const token = await user.getIdToken();
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to fetch comments');

      const { comments } = await res.json();
      set(state => ({
        taskComments: { ...state.taskComments, [taskId]: comments },
        commentsLoading: { ...state.commentsLoading, [taskId]: false },
      }));
    } catch (error) {
      console.error('fetchComments error:', error);
      set(state => ({
        commentsLoading: { ...state.commentsLoading, [taskId]: false },
      }));
    }
  },

  addUserComment: async (taskId: string, content: string) => {
    try {
      const user = get().user;
      if (!user) return;

      const token = await user.getIdToken();
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          authorType: 'user',
          authorName: user.displayName || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to add comment');

      const { comment } = await res.json();
      set(state => ({
        taskComments: {
          ...state.taskComments,
          [taskId]: [...(state.taskComments[taskId] || []), comment],
        },
      }));
    } catch (error) {
      console.error('addUserComment error:', error);
    }
  },

  triggerAIProcess: async (taskId: string) => {
    set(state => ({
      aiProcessing: { ...state.aiProcessing, [taskId]: true },
    }));

    try {
      const user = get().user;
      if (!user) return;

      const token = await user.getIdToken();
      const res = await fetch('/api/ai/workspace/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI processing failed');
      }

      // 処理完了後、コメントを再取得
      await get().fetchComments(taskId);
    } catch (error) {
      console.error('triggerAIProcess error:', error);
    } finally {
      set(state => ({
        aiProcessing: { ...state.aiProcessing, [taskId]: false },
      }));
    }
  },

  triggerAIReply: async (taskId: string) => {
    set(state => ({
      aiProcessing: { ...state.aiProcessing, [taskId]: true },
    }));

    try {
      const user = get().user;
      if (!user) return;

      const token = await user.getIdToken();
      const res = await fetch('/api/ai/workspace/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI reply failed');
      }

      // 処理完了後、コメントを再取得
      await get().fetchComments(taskId);
    } catch (error) {
      console.error('triggerAIReply error:', error);
    } finally {
      set(state => ({
        aiProcessing: { ...state.aiProcessing, [taskId]: false },
      }));
    }
  },

  subscribeToComments: (taskId: string) => {
    const commentsRef = collection(db, 'tasks', taskId, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const comments: TaskComment[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as TaskComment[];

      set(state => ({
        taskComments: { ...state.taskComments, [taskId]: comments },
      }));
    });

    return unsubscribe;
  },

  openTaskDetail: (taskId: string) => {
    set({ activeDetailTaskId: taskId });
  },

  closeTaskDetail: () => {
    set({ activeDetailTaskId: null });
  },
});
