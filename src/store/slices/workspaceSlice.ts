import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import { mapTaskComment } from '@/lib/supabase/mappers';
import { TaskComment } from '@/types';
import { StoreState } from '../types';

export interface WorkspaceSlice {
  taskComments: Record<string, TaskComment[]>;
  commentsLoading: Record<string, boolean>;
  aiProcessing: Record<string, boolean>;
  activeDetailTaskId: string | null;
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
    set((state) => ({
      commentsLoading: { ...state.commentsLoading, [taskId]: true },
    }));

    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      if (!res.ok) throw new Error('Failed to fetch comments');

      const { comments } = await res.json();
      set((state) => ({
        taskComments: { ...state.taskComments, [taskId]: comments },
        commentsLoading: { ...state.commentsLoading, [taskId]: false },
      }));
    } catch (error) {
      console.error('fetchComments error:', error);
      set((state) => ({
        commentsLoading: { ...state.commentsLoading, [taskId]: false },
      }));
    }
  },

  addUserComment: async (taskId: string, content: string) => {
    try {
      const user = get().user;
      if (!user) return;

      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content,
          authorName: user.displayName || undefined,
        }),
      });

      if (!res.ok) throw new Error('Failed to add comment');

      const { comment } = await res.json();
      set((state) => ({
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
    set((state) => ({
      aiProcessing: { ...state.aiProcessing, [taskId]: true },
    }));

    try {
      const res = await fetch('/api/ai/workspace/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI processing failed');
      }

      await get().fetchComments(taskId);
    } catch (error) {
      console.error('triggerAIProcess error:', error);
    } finally {
      set((state) => ({
        aiProcessing: { ...state.aiProcessing, [taskId]: false },
      }));
    }
  },

  triggerAIReply: async (taskId: string) => {
    set((state) => ({
      aiProcessing: { ...state.aiProcessing, [taskId]: true },
    }));

    try {
      const res = await fetch('/api/ai/workspace/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'AI reply failed');
      }

      await get().fetchComments(taskId);
    } catch (error) {
      console.error('triggerAIReply error:', error);
    } finally {
      set((state) => ({
        aiProcessing: { ...state.aiProcessing, [taskId]: false },
      }));
    }
  },

  subscribeToComments: (taskId: string) => {
    const supabase = createClient();
    const channel = supabase.channel(`task-comments:${taskId}`);

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
      async () => {
        const { data, error } = await supabase
          .from('task_comments')
          .select('*')
          .eq('task_id', taskId)
          .order('created_at', { ascending: true });

        if (error) {
          console.error('subscribeToComments error:', error);
          return;
        }

        set((state) => ({
          taskComments: {
            ...state.taskComments,
            [taskId]: data.map(mapTaskComment),
          },
        }));
      }
    );

    channel.subscribe(async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('subscribeToComments init error:', error);
        return;
      }

      set((state) => ({
        taskComments: {
          ...state.taskComments,
          [taskId]: data.map(mapTaskComment),
        },
      }));
    });

    return () => {
      supabase.removeChannel(channel);
    };
  },

  openTaskDetail: (taskId: string) => {
    set({ activeDetailTaskId: taskId });
  },

  closeTaskDetail: () => {
    set({ activeDetailTaskId: null });
  },
});
