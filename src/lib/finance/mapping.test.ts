import { describe, expect, it } from 'vitest';

import type { Database } from '../../types/supabase';
import {
    coerceYen,
    financeEntryToDraft,
    groupFinanceEntries,
    mapFinanceCategory,
    mapFinanceEntry,
    mapFinanceSummary,
} from './mapping';
import type { FinanceEntry } from './types';

type Tables = Database['public']['Tables'];

const entryRow = (
    overrides: Partial<Tables['finance_entries']['Row']> = {}
): Tables['finance_entries']['Row'] => ({
    id: 'entry-1',
    user_id: 'user-1',
    task_id: 'task-1',
    task_title_snapshot: 'Buy groceries',
    occurred_on: '2026-09-15',
    entry_type: 'expense',
    amount_yen: 20000,
    category_id: 'cat-1',
    category_label_snapshot: '食費',
    memo: 'seikyo',
    created_at: '2026-09-15T01:00:00.000Z',
    updated_at: '2026-09-15T01:00:00.000Z',
    ...overrides,
});

describe('finance mapping', () => {
    it('maps category and entry rows, including bigint-as-string amounts', () => {
        expect(
            mapFinanceCategory({
                id: 'cat-1',
                user_id: 'user-1',
                label: '食費',
                normalized_label: '食費',
                created_at: '2026-09-15T00:00:00.000Z',
                updated_at: '2026-09-15T00:00:00.000Z',
            })
        ).toMatchObject({
            id: 'cat-1',
            userId: 'user-1',
            label: '食費',
            normalizedLabel: '食費',
        });

        expect(mapFinanceEntry(entryRow({ amount_yen: '1500' as unknown as number }))).toMatchObject({
            amountYen: 1500,
            entryType: 'expense',
            taskTitleSnapshot: 'Buy groceries',
            memo: 'seikyo',
        });
        expect(coerceYen('10000')).toBe(10000);
        expect(coerceYen(null)).toBe(0);
        expect(() => coerceYen('9007199254740992')).toThrow('safe integer');
    });

    it('maps RPC summary rows and converts a stored entry back to a draft', () => {
        expect(
            mapFinanceSummary('2026-01-01', '2026-01-02', {
                expense_total: '20000',
                income_total: '10000',
                expense_count: '2',
                income_count: '1',
            })
        ).toEqual({
            start: '2026-01-01',
            end: '2026-01-02',
            expenseTotal: 20000,
            incomeTotal: 10000,
            expenseCount: 2,
            incomeCount: 1,
        });

        expect(financeEntryToDraft(mapFinanceEntry(entryRow()))).toMatchObject({
            clientId: 'entry-1',
            entryType: 'expense',
            categoryLabel: '食費',
            amountInput: '20000',
            memo: 'seikyo',
        });
    });

    it('groups entries by type then category with totals and counts', () => {
        const entries: FinanceEntry[] = [
            mapFinanceEntry(entryRow()),
            mapFinanceEntry(
                entryRow({
                    id: 'entry-2',
                    amount_yen: 3000,
                    category_label_snapshot: '交通',
                })
            ),
            mapFinanceEntry(
                entryRow({
                    id: 'entry-3',
                    entry_type: 'income',
                    amount_yen: 10000,
                    category_label_snapshot: '給与',
                    memo: null,
                })
            ),
            mapFinanceEntry(
                entryRow({
                    id: 'entry-4',
                    amount_yen: 5000,
                    category_label_snapshot: '食費',
                })
            ),
        ];

        const grouped = groupFinanceEntries(entries);
        expect(grouped).toHaveLength(2);
        expect(grouped[0]).toMatchObject({
            entryType: 'expense',
            total: 28000,
            count: 3,
        });
        expect(grouped[0].categories.map((category) => category.label)).toEqual(['食費', '交通']);
        expect(grouped[0].categories[0]).toMatchObject({ total: 25000, count: 2 });
        expect(grouped[1]).toMatchObject({
            entryType: 'income',
            total: 10000,
            count: 1,
        });
    });
});
