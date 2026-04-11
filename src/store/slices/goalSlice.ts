import { StateCreator } from 'zustand';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types/supabase';
import { GoalType } from '@/types';
import { StoreState } from '../types';

export interface GoalSlice {
    goals: import('@/types').Goal[];
    addGoal: (goal: import('@/types').Goal) => Promise<void>;
    updateGoal: (id: string, updates: Partial<import('@/types').Goal>) => Promise<void>;
    deleteGoal: (id: string) => Promise<void>;
    getGoalsByPeriod: (type: GoalType, periodId: string) => import('@/types').Goal[];
    resetGoalSlice: () => void;
}

export const createGoalSlice: StateCreator<StoreState, [], [], GoalSlice> = (set, get) => ({
    goals: [],

    addGoal: async (goal) => {
        const { user } = get();
        if (!user) {
            set((state) => ({ goals: [...state.goals, goal] }));
            return;
        }

        set((state) => ({ goals: [...state.goals, goal] }));

        const payload: Database['public']['Tables']['goals']['Insert'] = {
            id: goal.id,
            user_id: user.uid,
            type: goal.type,
            title: goal.title,
            description: goal.description ?? null,
            assigned_year: goal.assignedYear,
            assigned_month: goal.assignedMonth ?? null,
            assigned_week: goal.assignedWeek ?? null,
            status: goal.status,
            progress: goal.progress,
            parent_goal_id: goal.parentGoalId ?? null,
            project_id: goal.projectId ?? null,
            priority: goal.priority,
            tags: goal.tags ?? [],
            reflection: goal.reflection ?? null,
            ai_analysis: goal.aiAnalysis ?? null,
        };

        const { error } = await createClient().from('goals').insert(payload);
        if (error) {
            console.error('Error adding goal:', error);
            set((state) => ({ goals: state.goals.filter((entry) => entry.id !== goal.id) }));
            alert('Failed to add goal.');
        }
    },

    updateGoal: async (id, updates) => {
        const oldGoals = get().goals;
        set((state) => ({
            goals: state.goals.map((goal) => (goal.id === id ? { ...goal, ...updates } : goal)),
        }));

        const payload: Database['public']['Tables']['goals']['Update'] = {
            type: updates.type,
            title: updates.title,
            description: updates.description === undefined ? undefined : updates.description ?? null,
            assigned_year: updates.assignedYear,
            assigned_month: updates.assignedMonth === undefined ? undefined : updates.assignedMonth ?? null,
            assigned_week: updates.assignedWeek === undefined ? undefined : updates.assignedWeek ?? null,
            status: updates.status,
            progress: updates.progress,
            parent_goal_id: updates.parentGoalId === undefined ? undefined : updates.parentGoalId ?? null,
            project_id: updates.projectId === undefined ? undefined : updates.projectId ?? null,
            priority: updates.priority,
            tags: updates.tags,
            reflection: updates.reflection === undefined ? undefined : updates.reflection ?? null,
            ai_analysis: updates.aiAnalysis === undefined ? undefined : updates.aiAnalysis ?? null,
        };

        const { error } = await createClient().from('goals').update(payload).eq('id', id);
        if (error) {
            console.error('Error updating goal:', error);
            set({ goals: oldGoals });
            alert('Failed to update goal.');
        }
    },

    deleteGoal: async (id) => {
        const oldGoals = get().goals;
        set((state) => ({ goals: state.goals.filter((goal) => goal.id !== id) }));

        const { error } = await createClient().from('goals').delete().eq('id', id);
        if (error) {
            console.error('Error deleting goal:', error);
            set({ goals: oldGoals });
            alert('Failed to delete goal.');
        }
    },

    getGoalsByPeriod: (type, periodId) => {
        const { goals } = get();
        if (type === 'yearly') return goals.filter((goal) => goal.type === 'yearly' && goal.assignedYear === periodId);
        if (type === 'monthly') return goals.filter((goal) => goal.type === 'monthly' && goal.assignedMonth === periodId);
        if (type === 'weekly') return goals.filter((goal) => goal.type === 'weekly' && goal.assignedWeek === periodId);
        return [];
    },

    resetGoalSlice: () => set({ goals: [] }),
});
