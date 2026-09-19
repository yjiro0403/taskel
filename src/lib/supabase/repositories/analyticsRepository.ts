import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnalyticsPeriodPlan, AnalyticsPeriodType, FinanceCategoryBudget } from '../../analytics/types';
import { isValidPeriodKey } from '../../analytics/period';
import type { Database } from '../../../types/supabase';

type Client = SupabaseClient<Database>;
type PeriodPlanRow = Database['public']['Tables']['analytics_period_plans']['Row'];
type CategoryBudgetRow = Database['public']['Tables']['finance_category_budgets']['Row'];

function requireNoError(error: { message: string } | null) {
    if (error) {
        throw new Error(error.message);
    }
}

function assertPeriod(periodType: AnalyticsPeriodType, periodKey: string) {
    if (!isValidPeriodKey(periodType, periodKey)) {
        throw new Error(`Invalid period key: ${periodType} ${periodKey}`);
    }
}

export function mapPeriodPlan(row: PeriodPlanRow): AnalyticsPeriodPlan {
    return {
        id: row.id,
        userId: row.user_id,
        periodType: row.period_type,
        periodKey: row.period_key,
        expectedMinutes: row.expected_minutes,
        overallBudgetYen: row.overall_budget_yen,
        reflection: row.reflection,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function mapCategoryBudget(row: CategoryBudgetRow): FinanceCategoryBudget {
    return {
        id: row.id,
        userId: row.user_id,
        periodType: row.period_type,
        periodKey: row.period_key,
        categoryId: row.category_id,
        amountYen: Number(row.amount_yen),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function fetchPeriodPlan(
    client: Client,
    periodType: AnalyticsPeriodType,
    periodKey: string
): Promise<AnalyticsPeriodPlan | null> {
    assertPeriod(periodType, periodKey);
    const { data, error } = await client
        .from('analytics_period_plans')
        .select('*')
        .eq('period_type', periodType)
        .eq('period_key', periodKey)
        .maybeSingle();
    requireNoError(error);
    return data ? mapPeriodPlan(data) : null;
}

export async function upsertPeriodPlan(
    client: Client,
    userId: string,
    periodType: AnalyticsPeriodType,
    periodKey: string,
    patch: {
        expectedMinutes?: number | null;
        overallBudgetYen?: number | null;
        reflection?: string | null;
    }
): Promise<AnalyticsPeriodPlan> {
    assertPeriod(periodType, periodKey);
    const current = await fetchPeriodPlan(client, periodType, periodKey);
    const payload: Database['public']['Tables']['analytics_period_plans']['Insert'] = {
        id: current?.id,
        user_id: userId,
        period_type: periodType,
        period_key: periodKey,
        expected_minutes: patch.expectedMinutes !== undefined ? patch.expectedMinutes : current?.expectedMinutes ?? null,
        overall_budget_yen: patch.overallBudgetYen !== undefined ? patch.overallBudgetYen : current?.overallBudgetYen ?? null,
        reflection: patch.reflection !== undefined ? patch.reflection : current?.reflection ?? null,
    };

    const { data, error } = await client
        .from('analytics_period_plans')
        .upsert(payload, { onConflict: 'user_id,period_type,period_key' })
        .select('*')
        .single();
    requireNoError(error);
    if (!data) {
        throw new Error('Failed to save period plan');
    }
    return mapPeriodPlan(data);
}

export async function fetchCategoryBudgets(
    client: Client,
    periodType: AnalyticsPeriodType,
    periodKey: string
): Promise<FinanceCategoryBudget[]> {
    assertPeriod(periodType, periodKey);
    const { data, error } = await client
        .from('finance_category_budgets')
        .select('*')
        .eq('period_type', periodType)
        .eq('period_key', periodKey)
        .order('created_at', { ascending: true });
    requireNoError(error);
    return (data ?? []).map(mapCategoryBudget);
}

export async function upsertCategoryBudget(
    client: Client,
    userId: string,
    periodType: AnalyticsPeriodType,
    periodKey: string,
    categoryId: string,
    amountYen: number
): Promise<FinanceCategoryBudget> {
    assertPeriod(periodType, periodKey);
    const { data, error } = await client
        .from('finance_category_budgets')
        .upsert(
            {
                user_id: userId,
                period_type: periodType,
                period_key: periodKey,
                category_id: categoryId,
                amount_yen: amountYen,
            },
            { onConflict: 'user_id,period_type,period_key,category_id' }
        )
        .select('*')
        .single();
    requireNoError(error);
    if (!data) {
        throw new Error('Failed to save category budget');
    }
    return mapCategoryBudget(data);
}

export async function deleteCategoryBudget(
    client: Client,
    periodType: AnalyticsPeriodType,
    periodKey: string,
    categoryId: string
): Promise<void> {
    assertPeriod(periodType, periodKey);
    const { error } = await client
        .from('finance_category_budgets')
        .delete()
        .eq('period_type', periodType)
        .eq('period_key', periodKey)
        .eq('category_id', categoryId);
    requireNoError(error);
}
