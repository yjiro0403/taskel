import { describe, expect, it } from 'vitest';

import {
    FINANCE_SUMMARY_CACHE_MAX_ENTRIES,
    financeRangeKey,
    getCachedFinanceSummary,
    invalidateFinanceSummaryCache,
    putCachedFinanceSummary,
} from './cache';
import type { FinanceSummary } from './types';

const summary = (start: string, end: string, expenseTotal = 100): FinanceSummary => ({
    start,
    end,
    expenseTotal,
    incomeTotal: 50,
    expenseCount: 1,
    incomeCount: 1,
});

describe('finance summary cache', () => {
    it('keys summaries by half-open range and returns the stored value', () => {
        expect(financeRangeKey('2026-01-01', '2026-01-02')).toBe('2026-01-01/2026-01-02');

        const day = summary('2026-01-01', '2026-01-02');
        const week = summary('2025-12-29', '2026-01-05', 200);
        const cache = putCachedFinanceSummary(putCachedFinanceSummary({}, day), week);

        expect(getCachedFinanceSummary(cache, '2026-01-01', '2026-01-02')).toEqual(day);
        expect(getCachedFinanceSummary(cache, '2025-12-29', '2026-01-05')).toEqual(week);
        expect(getCachedFinanceSummary(cache, '2026-01-01', '2026-02-01')).toBeUndefined();
    });

    it('invalidates all cached ranges after writes or toggle changes', () => {
        const cache = putCachedFinanceSummary({}, summary('2026-01-01', '2026-01-02'));
        expect(invalidateFinanceSummaryCache()).toEqual({});
        expect(getCachedFinanceSummary(invalidateFinanceSummaryCache(), '2026-01-01', '2026-01-02')).toBeUndefined();
        expect(Object.keys(cache)).toHaveLength(1);
    });

    it('bounds the in-memory cache while keeping the newest ranges', () => {
        let cache: Record<string, FinanceSummary> = {};
        for (let index = 0; index < FINANCE_SUMMARY_CACHE_MAX_ENTRIES + 2; index += 1) {
            cache = putCachedFinanceSummary(
                cache,
                summary(`2026-01-${String(index + 1).padStart(2, '0')}`, `2027-01-${String(index + 1).padStart(2, '0')}`, index)
            );
        }

        expect(Object.keys(cache)).toHaveLength(FINANCE_SUMMARY_CACHE_MAX_ENTRIES);
        expect(cache['2026-01-01/2027-01-01']).toBeUndefined();
        expect(cache['2026-01-02/2027-01-02']).toBeUndefined();
        expect(cache['2026-01-50/2027-01-50']).toBeDefined();
    });
});
