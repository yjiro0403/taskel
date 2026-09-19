import { StateCreator } from 'zustand';

import type { AnalyticsPeriodPlan, AnalyticsPeriodType, FinanceCategoryBudget } from '../../lib/analytics/types';
import { createClient } from '../../lib/supabase/client';
import {
    deleteCategoryBudget,
    fetchCategoryBudgets,
    fetchPeriodPlan,
    upsertCategoryBudget,
    upsertPeriodPlan,
} from '../../lib/supabase/repositories/analyticsRepository';
import { StoreState } from '../types';

export interface AnalyticsSlice {
    periodPlan: AnalyticsPeriodPlan | null;
    periodPlanKey: string | null;
    periodPlanLoading: boolean;
    categoryBudgets: FinanceCategoryBudget[];
    categoryBudgetsLoading: boolean;
    loadPeriodAnalytics: (periodType: AnalyticsPeriodType, periodKey: string) => Promise<void>;
    savePeriodPlan: (
        periodType: AnalyticsPeriodType,
        periodKey: string,
        patch: {
            expectedMinutes?: number | null;
            overallBudgetYen?: number | null;
            reflection?: string | null;
        }
    ) => Promise<boolean>;
    saveCategoryBudget: (
        periodType: AnalyticsPeriodType,
        periodKey: string,
        categoryId: string,
        amountYen: number
    ) => Promise<boolean>;
    removeCategoryBudget: (
        periodType: AnalyticsPeriodType,
        periodKey: string,
        categoryId: string
    ) => Promise<boolean>;
    resetAnalyticsSlice: () => void;
}

const initialState = {
    periodPlan: null as AnalyticsPeriodPlan | null,
    periodPlanKey: null as string | null,
    periodPlanLoading: false,
    categoryBudgets: [] as FinanceCategoryBudget[],
    categoryBudgetsLoading: false,
};

let analyticsGeneration = 0;

function cacheKey(periodType: AnalyticsPeriodType, periodKey: string) {
    return `${periodType}:${periodKey}`;
}

export const createAnalyticsSlice: StateCreator<StoreState, [], [], AnalyticsSlice> = (set, get) => ({
    ...initialState,

    loadPeriodAnalytics: async (periodType, periodKey) => {
        const { user } = get();
        if (!user) {
            set({ ...initialState });
            return;
        }

        const generation = ++analyticsGeneration;
        const key = cacheKey(periodType, periodKey);
        set({ periodPlanLoading: true, categoryBudgetsLoading: true, periodPlanKey: key });

        try {
            const [plan, budgets] = await Promise.all([
                fetchPeriodPlan(createClient(), periodType, periodKey),
                fetchCategoryBudgets(createClient(), periodType, periodKey),
            ]);
            if (generation !== analyticsGeneration || get().user?.uid !== user.uid) {
                return;
            }
            set({
                periodPlan: plan,
                categoryBudgets: budgets,
                periodPlanLoading: false,
                categoryBudgetsLoading: false,
                periodPlanKey: key,
            });
        } catch (error) {
            console.error('Failed to load period analytics:', error);
            if (generation !== analyticsGeneration || get().user?.uid !== user.uid) {
                return;
            }
            set({
                periodPlan: null,
                categoryBudgets: [],
                periodPlanLoading: false,
                categoryBudgetsLoading: false,
            });
        }
    },

    savePeriodPlan: async (periodType, periodKey, patch) => {
        const { user } = get();
        if (!user) return false;
        try {
            const plan = await upsertPeriodPlan(createClient(), user.uid, periodType, periodKey, patch);
            if (get().user?.uid !== user.uid) return false;
            if (get().periodPlanKey === cacheKey(periodType, periodKey)) {
                set({ periodPlan: plan });
            }
            return true;
        } catch (error) {
            console.error('Failed to save period plan:', error);
            return false;
        }
    },

    saveCategoryBudget: async (periodType, periodKey, categoryId, amountYen) => {
        const { user } = get();
        if (!user) return false;
        try {
            const budget = await upsertCategoryBudget(
                createClient(),
                user.uid,
                periodType,
                periodKey,
                categoryId,
                amountYen
            );
            if (get().user?.uid !== user.uid) return false;
            if (get().periodPlanKey === cacheKey(periodType, periodKey)) {
                set((state) => ({
                    categoryBudgets: [
                        ...state.categoryBudgets.filter((item) => item.categoryId !== categoryId),
                        budget,
                    ],
                }));
            }
            return true;
        } catch (error) {
            console.error('Failed to save category budget:', error);
            return false;
        }
    },

    removeCategoryBudget: async (periodType, periodKey, categoryId) => {
        const { user } = get();
        if (!user) return false;
        try {
            await deleteCategoryBudget(createClient(), periodType, periodKey, categoryId);
            if (get().user?.uid !== user.uid) return false;
            if (get().periodPlanKey === cacheKey(periodType, periodKey)) {
                set((state) => ({
                    categoryBudgets: state.categoryBudgets.filter((item) => item.categoryId !== categoryId),
                }));
            }
            return true;
        } catch (error) {
            console.error('Failed to delete category budget:', error);
            return false;
        }
    },

    resetAnalyticsSlice: () => {
        analyticsGeneration += 1;
        set({ ...initialState });
    },
});
