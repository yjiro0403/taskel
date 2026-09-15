import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../types/supabase';
import {
    fetchFinancePreference,
    getOrFetchFinanceSummary,
    listFinanceEntriesInRange,
    replaceTaskFinanceEntries,
    summarizeFinanceRange,
} from './financeRepository';

type Client = SupabaseClient<Database>;

describe('financeRepository', () => {
    it('treats a missing preference row as disabled (default off)', async () => {
        const client = {
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
            }),
        } as unknown as Client;

        await expect(fetchFinancePreference(client)).resolves.toBe(false);
        expect(client.from).toHaveBeenCalledWith('finance_preferences');
    });

    it('reads enabled=true from the preference row', async () => {
        const client = {
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: true }, error: null }),
                }),
            }),
        } as unknown as Client;

        await expect(fetchFinancePreference(client)).resolves.toBe(true);
    });

    it('calls the range aggregation RPC with an explicit half-open range', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: [
                {
                    expense_total: 20000,
                    income_total: 10000,
                    expense_count: 1,
                    income_count: 1,
                },
            ],
            error: null,
        });
        const client = { rpc } as unknown as Client;

        await expect(summarizeFinanceRange(client, '2025-12-29', '2026-01-05')).resolves.toEqual({
            start: '2025-12-29',
            end: '2026-01-05',
            expenseTotal: 20000,
            incomeTotal: 10000,
            expenseCount: 1,
            incomeCount: 1,
        });
        expect(rpc).toHaveBeenCalledWith('summarize_finance_range', {
            p_start: '2025-12-29',
            p_end: '2026-01-05',
        });
    });

    it('returns a cached summary without calling the RPC', async () => {
        const rpc = vi.fn();
        const client = { rpc } as unknown as Client;
        const cached = {
            start: '2026-01-01',
            end: '2026-01-02',
            expenseTotal: 1,
            incomeTotal: 0,
            expenseCount: 1,
            incomeCount: 0,
        };

        const result = await getOrFetchFinanceSummary(
            client,
            { '2026-01-01/2026-01-02': cached },
            '2026-01-01',
            '2026-01-02'
        );

        expect(result.fromCache).toBe(true);
        expect(result.summary).toEqual(cached);
        expect(rpc).not.toHaveBeenCalled();
    });

    it('sends the replace payload as JSON to the atomic RPC', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        const client = { rpc } as unknown as Client;
        const entries = [
            {
                entry_type: 'expense' as const,
                category_label: '食費',
                amount_yen: 20000,
                memo: null,
            },
        ];

        await replaceTaskFinanceEntries(client, 'task-1', entries);
        expect(rpc).toHaveBeenCalledWith('replace_task_finance_entries', {
            p_task_id: 'task-1',
            p_entries: entries,
        });
    });

    it('passes the old task id when finance follows a detached routine occurrence', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        const client = { rpc } as unknown as Client;

        await replaceTaskFinanceEntries(client, 'new-task', [], 'old-task');

        expect(rpc).toHaveBeenCalledWith('replace_task_finance_entries', {
            p_task_id: 'new-task',
            p_source_task_id: 'old-task',
            p_entries: [],
        });
    });

    it('paginates range details past the API 1,000-row cap', async () => {
        const makeRow = (index: number) => ({
            id: `entry-${index}`,
            user_id: 'user-1',
            task_id: 'task-1',
            task_title_snapshot: 'Task',
            occurred_on: '2026-01-01',
            entry_type: 'expense' as const,
            amount_yen: 1,
            category_id: 'category-1',
            category_label_snapshot: 'Food',
            memo: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
        });
        const rpc = vi
            .fn()
            .mockResolvedValueOnce({
                data: Array.from({ length: 1000 }, (_, index) => makeRow(index)),
                error: null,
            })
            .mockResolvedValueOnce({ data: [makeRow(1000)], error: null });
        const client = { rpc } as unknown as Client;

        await expect(
            listFinanceEntriesInRange(client, '2026-01-01', '2027-01-01')
        ).resolves.toHaveLength(1001);
        expect(rpc).toHaveBeenNthCalledWith(1, 'list_finance_entries_in_range', {
            p_start: '2026-01-01',
            p_end: '2027-01-01',
            p_offset: 0,
            p_limit: 1000,
        });
        expect(rpc).toHaveBeenNthCalledWith(2, 'list_finance_entries_in_range', {
            p_start: '2026-01-01',
            p_end: '2027-01-01',
            p_offset: 1000,
            p_limit: 1000,
        });
    });
});
