export type AnalyticsPeriodType = 'week' | 'month' | 'year';
export type AnalyticsTimeRange = AnalyticsPeriodType | 'all';

export interface AnalyticsPeriodPlan {
    id: string;
    userId: string;
    periodType: AnalyticsPeriodType;
    periodKey: string;
    expectedMinutes: number | null;
    overallBudgetYen: number | null;
    reflection: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface FinanceCategoryBudget {
    id: string;
    userId: string;
    periodType: AnalyticsPeriodType;
    periodKey: string;
    categoryId: string;
    amountYen: number;
    createdAt: string;
    updatedAt: string;
}

export interface TimeBucket {
    id: string;
    label: string;
    minutes: number;
    taskCount: number;
    completedCount: number;
}

export interface VarianceStatus {
    expected: number;
    actual: number;
    remaining: number;
    over: boolean;
    ratio: number;
}

export const UNCATEGORIZED_ID = '__uncategorized__';
export const UNCATEGORIZED_TAG = '__untagged__';
