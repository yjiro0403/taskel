import type { Database } from '../../types/supabase';
import {
    type FinanceCategory,
    type FinanceCategoryGroup,
    type FinanceDraftRow,
    type FinanceEntry,
    type FinanceEntryType,
    type FinanceSummary,
    type FinanceTypeGroup,
} from './types';

type Tables = Database['public']['Tables'];

export function coerceYen(value: number | string | null | undefined): number {
    if (value === null || value === undefined || value === '') {
        return 0;
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error('Finance amount exceeds the safe integer range');
    }
    return parsed;
}

export function coerceCount(value: number | string | null | undefined): number {
    const count = coerceYen(value);
    if (!Number.isInteger(count)) {
        throw new Error('Finance count must be an integer');
    }
    return count;
}

function addSafeYen(left: number, right: number): number {
    const total = left + right;
    if (!Number.isSafeInteger(total)) {
        throw new Error('Finance total exceeds the safe integer range');
    }
    return total;
}

export function mapFinanceCategory(row: Tables['finance_categories']['Row']): FinanceCategory {
    return {
        id: row.id,
        userId: row.user_id,
        label: row.label,
        normalizedLabel: row.normalized_label,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function mapFinanceEntry(row: Tables['finance_entries']['Row']): FinanceEntry {
    return {
        id: row.id,
        userId: row.user_id,
        taskId: row.task_id,
        taskTitleSnapshot: row.task_title_snapshot,
        occurredOn: row.occurred_on,
        entryType: row.entry_type,
        amountYen: coerceYen(row.amount_yen),
        categoryId: row.category_id,
        categoryLabelSnapshot: row.category_label_snapshot,
        memo: row.memo,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function mapFinanceSummary(
    start: string,
    end: string,
    row: {
        expense_total?: number | string | null;
        income_total?: number | string | null;
        expense_count?: number | string | null;
        income_count?: number | string | null;
    } | null | undefined
): FinanceSummary {
    return {
        start,
        end,
        expenseTotal: coerceYen(row?.expense_total),
        incomeTotal: coerceYen(row?.income_total),
        expenseCount: coerceCount(row?.expense_count),
        incomeCount: coerceCount(row?.income_count),
    };
}

export function createEmptyFinanceDraft(entryType: FinanceEntryType = 'expense'): FinanceDraftRow {
    return {
        clientId: crypto.randomUUID(),
        entryType,
        categoryLabel: '',
        amountInput: '',
        memo: '',
    };
}

export function financeEntryToDraft(entry: FinanceEntry): FinanceDraftRow {
    return {
        clientId: entry.id,
        entryType: entry.entryType,
        categoryLabel: entry.categoryLabelSnapshot,
        amountInput: String(entry.amountYen),
        memo: entry.memo ?? '',
    };
}

function groupByCategory(entries: FinanceEntry[]): FinanceCategoryGroup[] {
    const groups = new Map<string, FinanceCategoryGroup>();
    for (const entry of entries) {
        const label = entry.categoryLabelSnapshot;
        const existing = groups.get(label);
        if (existing) {
            existing.total = addSafeYen(existing.total, entry.amountYen);
            existing.count += 1;
            existing.entries.push(entry);
        } else {
            groups.set(label, {
                label,
                total: entry.amountYen,
                count: 1,
                entries: [entry],
            });
        }
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function groupFinanceEntries(entries: FinanceEntry[]): FinanceTypeGroup[] {
    const expenses = entries.filter((entry) => entry.entryType === 'expense');
    const incomes = entries.filter((entry) => entry.entryType === 'income');

    const types: FinanceTypeGroup[] = [];
    if (expenses.length > 0) {
        types.push({
            entryType: 'expense',
            total: expenses.reduce((sum, entry) => addSafeYen(sum, entry.amountYen), 0),
            count: expenses.length,
            categories: groupByCategory(expenses),
        });
    }
    if (incomes.length > 0) {
        types.push({
            entryType: 'income',
            total: incomes.reduce((sum, entry) => addSafeYen(sum, entry.amountYen), 0),
            count: incomes.length,
            categories: groupByCategory(incomes),
        });
    }
    return types;
}
