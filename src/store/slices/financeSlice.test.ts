import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoreState } from '../types';
import { createFinanceSlice } from './financeSlice';

vi.mock('../../lib/supabase/client', () => ({
    createClient: () => ({}),
}));

vi.mock('../../lib/supabase/repositories/financeRepository', () => ({
    fetchFinancePreference: vi.fn(),
    upsertFinancePreference: vi.fn(),
    fetchFinanceCategories: vi.fn(),
    fetchTaskFinanceEntries: vi.fn(),
    listFinanceEntriesInRange: vi.fn(),
    summarizeFinanceRange: vi.fn(),
    replaceTaskFinanceEntries: vi.fn(),
}));

import {
    fetchFinanceCategories,
    fetchFinancePreference,
    fetchTaskFinanceEntries,
    listFinanceEntriesInRange,
    replaceTaskFinanceEntries,
    summarizeFinanceRange,
    upsertFinancePreference,
} from '../../lib/supabase/repositories/financeRepository';

const mockedFetchPreference = vi.mocked(fetchFinancePreference);
const mockedUpsertPreference = vi.mocked(upsertFinancePreference);
const mockedFetchCategories = vi.mocked(fetchFinanceCategories);
const mockedSummarize = vi.mocked(summarizeFinanceRange);
const mockedReplace = vi.mocked(replaceTaskFinanceEntries);
const mockedFetchTaskEntries = vi.mocked(fetchTaskFinanceEntries);
const mockedListRange = vi.mocked(listFinanceEntriesInRange);

function createHarness(user: { uid: string } | null = { uid: 'user-1' }) {
    const state = {
        user,
        showToast: vi.fn(),
    } as unknown as StoreState;

    const set = ((partial: unknown) => {
        const next = typeof partial === 'function' ? (partial as (current: StoreState) => object)(state) : partial;
        Object.assign(state, next);
    }) as never;

    const get = () => state;
    const slice = createFinanceSlice(set, get, {} as never);
    Object.assign(state, slice);
    return { state, slice };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('financeSlice default-off behavior', () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it('starts disabled and does not load categories, entries, or summaries', async () => {
        const { state, slice } = createHarness();

        expect(state.financeEnabled).toBe(false);
        expect(state.financePreferenceLoaded).toBe(false);
        expect(state.financeCategories).toEqual([]);
        expect(state.financeSummaryCache).toEqual({});

        await expect(slice.ensureFinanceSummary('2026-01-01', '2026-01-02')).resolves.toBeNull();
        await expect(slice.loadFinanceCategories()).resolves.toBeUndefined();
        await expect(slice.loadFinanceEntriesForTask('task-1')).resolves.toEqual([]);
        await expect(slice.loadFinanceBreakdown('2026-01-01', '2026-01-02')).resolves.toEqual([]);
        await expect(slice.replaceTaskFinanceEntries('task-1', [])).resolves.toBe(false);

        expect(mockedSummarize).not.toHaveBeenCalled();
        expect(mockedFetchCategories).not.toHaveBeenCalled();
        expect(mockedFetchTaskEntries).not.toHaveBeenCalled();
        expect(mockedListRange).not.toHaveBeenCalled();
        expect(mockedReplace).not.toHaveBeenCalled();
    });

    it('keeps the feature off when no preference row exists', async () => {
        mockedFetchPreference.mockResolvedValue(false);
        const { state, slice } = createHarness();

        await slice.loadFinancePreference();

        expect(state.financeEnabled).toBe(false);
        expect(state.financePreferenceLoaded).toBe(true);
        expect(mockedFetchCategories).not.toHaveBeenCalled();
        expect(mockedSummarize).not.toHaveBeenCalled();
    });

    it('does not delete data when turning the toggle off; it only clears client cache', async () => {
        mockedUpsertPreference.mockResolvedValue(undefined);
        mockedSummarize.mockResolvedValue({
            start: '2026-01-01',
            end: '2026-01-02',
            expenseTotal: 20000,
            incomeTotal: 0,
            expenseCount: 1,
            incomeCount: 0,
        });
        mockedFetchCategories.mockResolvedValue([]);

        const { state, slice } = createHarness();
        state.financeEnabled = true;

        await slice.ensureFinanceSummary('2026-01-01', '2026-01-02');
        expect(Object.keys(state.financeSummaryCache)).toHaveLength(1);
        await slice.ensureFinanceSummary('2026-01-01', '2026-01-02');
        expect(mockedSummarize).toHaveBeenCalledTimes(1);

        await expect(slice.setFinanceEnabled(false)).resolves.toBe(true);
        expect(mockedUpsertPreference).toHaveBeenCalledWith(expect.anything(), 'user-1', false);
        expect(state.financeEnabled).toBe(false);
        expect(state.financeSummaryCache).toEqual({});
        expect(state.financeCategories).toEqual([]);
    });

    it('marks cached summaries stale after a successful replace and refetches them', async () => {
        mockedReplace.mockResolvedValue([
            {
                id: 'entry-1',
                userId: 'user-1',
                taskId: 'task-1',
                taskTitleSnapshot: 'Lunch',
                occurredOn: '2026-01-01',
                entryType: 'expense',
                amountYen: 1200,
                categoryId: 'cat-food',
                categoryLabelSnapshot: '食費',
                memo: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        ]);
        mockedSummarize.mockResolvedValue({
            start: '2026-01-01',
            end: '2026-01-02',
            expenseTotal: 1200,
            incomeTotal: 0,
            expenseCount: 1,
            incomeCount: 0,
        });
        const { state, slice } = createHarness();
        state.financeEnabled = true;
        state.financeCategoriesLoaded = true;
        state.financeSummaryRevision = 0;
        state.financeSummaryCache = {
            '2026-01-01/2026-01-02': {
                start: '2026-01-01',
                end: '2026-01-02',
                expenseTotal: 1,
                incomeTotal: 0,
                expenseCount: 1,
                incomeCount: 0,
            },
        };
        state.financeSummaryCacheEpoch = { '2026-01-01/2026-01-02': 0 };

        await expect(slice.replaceTaskFinanceEntries('task-1', [])).resolves.toBe(true);
        expect(state.financeSummaryRevision).toBe(1);
        expect(state.financeCategoriesLoaded).toBe(true);
        expect(state.financeCategories.map((category) => category.label)).toEqual(['食費']);
        // Previous total stays visible until the header refetches.
        expect(state.financeSummaryCache['2026-01-01/2026-01-02']?.expenseTotal).toBe(1);

        const summary = await slice.ensureFinanceSummary('2026-01-01', '2026-01-02');
        expect(mockedSummarize).toHaveBeenCalledTimes(1);
        expect(summary?.expenseTotal).toBe(1200);
        expect(state.financeSummaryCacheEpoch['2026-01-01/2026-01-02']).toBe(1);

        await slice.ensureFinanceSummary('2026-01-01', '2026-01-02');
        expect(mockedSummarize).toHaveBeenCalledTimes(1);
    });

    it('does not apply a preference response after the user changes', async () => {
        const pending = deferred<boolean>();
        mockedFetchPreference.mockReturnValueOnce(pending.promise);
        const { state, slice } = createHarness({ uid: 'user-1' });

        const request = slice.loadFinancePreference();
        state.user = { uid: 'user-2' } as StoreState['user'];
        slice.resetFinanceSlice();
        pending.resolve(true);
        await request;

        expect(state.financeEnabled).toBe(false);
        expect(state.financePreferenceLoaded).toBe(false);
    });

    it('does not let an older summary repopulate cache after a successful write', async () => {
        const pending = deferred<{
            start: string;
            end: string;
            expenseTotal: number;
            incomeTotal: number;
            expenseCount: number;
            incomeCount: number;
        }>();
        mockedSummarize.mockReturnValueOnce(pending.promise);
        mockedReplace.mockResolvedValueOnce([]);
        const { state, slice } = createHarness();
        state.financeEnabled = true;

        const summaryRequest = slice.ensureFinanceSummary('2026-01-01', '2026-01-02');
        await expect(slice.replaceTaskFinanceEntries('task-1', [])).resolves.toBe(true);
        pending.resolve({
            start: '2026-01-01',
            end: '2026-01-02',
            expenseTotal: 999,
            incomeTotal: 0,
            expenseCount: 1,
            incomeCount: 0,
        });
        await summaryRequest;

        expect(state.financeSummaryCache).toEqual({});
        expect(state.financeSummaryLoading).toEqual({});
    });

    it('rejects task-entry results that complete after an account switch', async () => {
        const pending = deferred<[]>();
        mockedFetchTaskEntries.mockReturnValueOnce(pending.promise);
        const { state, slice } = createHarness({ uid: 'user-1' });
        state.financeEnabled = true;

        const request = slice.loadFinanceEntriesForTask('task-1');
        state.user = { uid: 'user-2' } as StoreState['user'];
        slice.resetFinanceSlice();
        pending.resolve([]);

        await expect(request).rejects.toThrow('Stale finance request');
    });
});
