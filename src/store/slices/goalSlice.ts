
import { StateCreator } from 'zustand';
import { StoreState } from '../types';
import { Goal, GoalType } from '@/types';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sanitizeData } from '../helpers/sanitize';

export interface GoalSlice {
    goals: Goal[];
    addGoal: (goal: Goal) => Promise<void>;
    updateGoal: (id: string, updates: Partial<Goal>) => Promise<void>;
    deleteGoal: (id: string) => Promise<void>;
    getGoalsByPeriod: (type: GoalType, periodId: string) => Goal[];
}

export const createGoalSlice: StateCreator<StoreState, [], [], GoalSlice> = (set, get) => ({
    goals: [],

    addGoal: async (goal) => {
        const { user } = get();
        if (user) {
            // Optimistic update
            set((state) => ({ goals: [...state.goals, goal] }));
            try {
                const ref = doc(db, 'goals', goal.id);
                await setDoc(ref, sanitizeData({
                    ...goal,
                    userId: user.uid,
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error adding goal:", error);
                // Start rollback logic
                set((state) => ({ goals: state.goals.filter(g => g.id !== goal.id) }));
                alert("Failed to add goal.");
            }
        } else {
            set((state) => ({ goals: [...state.goals, goal] }));
        }
    },

    updateGoal: async (id, updates) => {
        const { user, goals } = get();
        if (user) {
            const oldGoals = goals;
            // Optimistic update
            set((state) => ({
                goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
            }));

            try {
                const ref = doc(db, 'goals', id);
                await updateDoc(ref, sanitizeData({
                    ...updates,
                    updatedAt: Date.now()
                }));
            } catch (error) {
                console.error("Error updating goal:", error);
                set({ goals: oldGoals });
                alert("Failed to update goal.");
            }
        } else {
            set((state) => ({
                goals: state.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
            }));
        }
    },

    deleteGoal: async (id) => {
        const { user, goals } = get();
        if (user) {
            const oldGoals = goals;
            set((state) => ({
                goals: state.goals.filter((g) => g.id !== id),
            }));

            try {
                const ref = doc(db, 'goals', id);
                await deleteDoc(ref);
            } catch (error) {
                console.error("Error deleting goal:", error);
                set({ goals: oldGoals });
                alert("Failed to delete goal.");
            }
        } else {
            set((state) => ({
                goals: state.goals.filter((g) => g.id !== id),
            }));
        }
    },

    getGoalsByPeriod: (type, periodId) => {
        const { goals } = get();
        if (type === 'yearly') {
            return goals.filter(g => g.type === 'yearly' && g.assignedYear === periodId);
        } else if (type === 'monthly') {
            return goals.filter(g => g.type === 'monthly' && g.assignedMonth === periodId);
        } else if (type === 'weekly') {
            return goals.filter(g => g.type === 'weekly' && g.assignedWeek === periodId);
        }
        return [];
    }
});
