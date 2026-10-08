import type { SupabaseClient } from '@supabase/supabase-js';

import { getCachedFinanceSummary, putCachedFinanceSummary } from '../../finance/cache';
import { coerceYen, mapFinanceCategory, mapFinanceEntry, mapFinanceSummary } from '../../finance/mapping';
import type {
    FinanceCategory,
    FinanceEntry,
    FinanceReplacePayloadEntry,
    FinanceSummary,
} from '../../finance/types';
import type { Database, Json } from '../../../types/supabase';

type Client = SupabaseClient<Database>;
const FINANCE_PAGE_SIZE = 1000;

export function emptyFinanceSummary(start: string, end: string): FinanceSummary {
    return {
        start,
        end,
        expenseTotal: 0,
        incomeTotal: 0,
        expenseCount: 0,
        incomeCount: 0,
    };
}

function requireNoError(error: { message: string } | null) {
    if (error) {
        throw new Error(error.message);
    }
}

export async function fetchFinancePreference(client: Client): Promise<boolean> {
    const { data, error } = await client
        .from('finance_preferences')
        .select('enabled')
        .maybeSingle();

    requireNoError(error);
    return data?.enabled === true;
}

export async function upsertFinancePreference(
    client: Client,
    userId: string,
    enabled: boolean
): Promise<void> {
    const { error } = await client.from('finance_preferences').upsert(
        {
            user_id: userId,
            enabled,
        },
        { onConflict: 'user_id' }
    );
    requireNoError(error);
}

export async function fetchFinanceCategories(client: Client): Promise<FinanceCategory[]> {
    const categories: FinanceCategory[] = [];
    for (let offset = 0; ; offset += FINANCE_PAGE_SIZE) {
        const { data, error } = await client
            .from('finance_categories')
            .select('id, user_id, label, normalized_label, created_at, updated_at')
            .order('label', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + FINANCE_PAGE_SIZE - 1);

        requireNoError(error);
        categories.push(...(data ?? []).map(mapFinanceCategory));
        if ((data?.length ?? 0) < FINANCE_PAGE_SIZE) {
            return categories;
        }
    }
}

export async function fetchTaskFinanceEntries(
    client: Client,
    taskId: string
): Promise<FinanceEntry[]> {
    const { data, error } = await client
        .from('finance_entries')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

    requireNoError(error);
    return (data ?? []).map(mapFinanceEntry);
}

async function listDetachedAmounts(
    client: Client,
    start: string,
    end: string
): Promise<Array<{ entry_type: 'expense' | 'income'; amount_yen: number | string }>> {
    // Task deletion used to leave the money row in place with task_id cleared.
    // The range RPC still counts those rows. Read them back and remove them from
    // the total until the database cascade migration is applied.
    const rows: Array<{ entry_type: 'expense' | 'income'; amount_yen: number | string }> = [];
    for (let offset = 0; ; offset += FINANCE_PAGE_SIZE) {
        const { data, error } = await client
            .from('finance_entries')
            .select('entry_type, amount_yen')
            .is('task_id', null)
            .gte('occurred_on', start)
            .lt('occurred_on', end)
            .order('id', { ascending: true })
            .range(offset, offset + FINANCE_PAGE_SIZE - 1);
        requireNoError(error);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < FINANCE_PAGE_SIZE) {
            return rows;
        }
    }
}

function withoutDetachedRows(
    summary: FinanceSummary,
    detached: Array<{ entry_type: 'expense' | 'income'; amount_yen: number | string }>
): FinanceSummary {
    let expenseTotal = summary.expenseTotal;
    let incomeTotal = summary.incomeTotal;
    let expenseCount = summary.expenseCount;
    let incomeCount = summary.incomeCount;
    for (const row of detached) {
        const amount = coerceYen(row.amount_yen);
        if (row.entry_type === 'expense') {
            expenseTotal -= amount;
            expenseCount -= 1;
        } else if (row.entry_type === 'income') {
            incomeTotal -= amount;
            incomeCount -= 1;
        }
    }
    return {
        ...summary,
        expenseTotal,
        incomeTotal,
        expenseCount,
        incomeCount,
    };
}

export async function summarizeFinanceRange(
    client: Client,
    start: string,
    end: string
): Promise<FinanceSummary> {
    const { data, error } = await client.rpc('summarize_finance_range', {
        p_start: start,
        p_end: end,
    });
    requireNoError(error);

    const row = Array.isArray(data) ? data[0] : data;
    const summary = row ? mapFinanceSummary(start, end, row) : emptyFinanceSummary(start, end);
    return withoutDetachedRows(summary, await listDetachedAmounts(client, start, end));
}

export async function listFinanceEntriesInRange(
    client: Client,
    start: string,
    end: string
): Promise<FinanceEntry[]> {
    const entries: FinanceEntry[] = [];
    for (let offset = 0; ; offset += FINANCE_PAGE_SIZE) {
        const { data, error } = await client.rpc('list_finance_entries_in_range', {
            p_start: start,
            p_end: end,
            p_offset: offset,
            p_limit: FINANCE_PAGE_SIZE,
        });
        requireNoError(error);
        entries.push(...(data ?? []).map(mapFinanceEntry).filter((entry) => entry.taskId));
        if ((data?.length ?? 0) < FINANCE_PAGE_SIZE) {
            return entries;
        }
    }
}

export async function replaceTaskFinanceEntries(
    client: Client,
    taskId: string,
    entries: FinanceReplacePayloadEntry[],
    sourceTaskId?: string
): Promise<FinanceEntry[]> {
    const args: Database['public']['Functions']['replace_task_finance_entries']['Args'] = {
        p_task_id: taskId,
        p_entries: entries as unknown as Json,
    };
    if (sourceTaskId && sourceTaskId !== taskId) {
        args.p_source_task_id = sourceTaskId;
    }
    const { data, error } = await client.rpc('replace_task_finance_entries', args);
    requireNoError(error);
    return (data ?? []).map(mapFinanceEntry);
}

/** Resolve a summary from the in-memory cache, otherwise fetch and store it. */
export async function getOrFetchFinanceSummary(
    client: Client,
    cache: Record<string, FinanceSummary>,
    start: string,
    end: string
): Promise<{ summary: FinanceSummary; cache: Record<string, FinanceSummary>; fromCache: boolean }> {
    const cached = getCachedFinanceSummary(cache, start, end);
    if (cached) {
        return { summary: cached, cache: { ...cache }, fromCache: true };
    }
    const summary = await summarizeFinanceRange(client, start, end);
    return {
        summary,
        cache: putCachedFinanceSummary(cache, summary),
        fromCache: false,
    };
}
