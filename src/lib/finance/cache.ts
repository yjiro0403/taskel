import type { FinanceSummary } from './types';

export const FINANCE_SUMMARY_CACHE_MAX_ENTRIES = 48;

export function financeRangeKey(start: string, end: string): string {
    return `${start}/${end}`;
}

export function getCachedFinanceSummary(
    cache: Record<string, FinanceSummary>,
    start: string,
    end: string
): FinanceSummary | undefined {
    return cache[financeRangeKey(start, end)];
}

export function putCachedFinanceSummary(
    cache: Record<string, FinanceSummary>,
    summary: FinanceSummary
): Record<string, FinanceSummary> {
    const next = {
        ...cache,
        [financeRangeKey(summary.start, summary.end)]: summary,
    };

    const keys = Object.keys(next);
    if (keys.length <= FINANCE_SUMMARY_CACHE_MAX_ENTRIES) {
        return next;
    }

    return Object.fromEntries(
        keys
            .slice(keys.length - FINANCE_SUMMARY_CACHE_MAX_ENTRIES)
            .map((key) => [key, next[key]])
    );
}

export function invalidateFinanceSummaryCache(): Record<string, FinanceSummary> {
    return {};
}

/** A cached total is fresh only when it was stored for the current write generation. */
export function isFinanceSummaryFresh(
    epochs: Record<string, number>,
    start: string,
    end: string,
    revision: number
): boolean {
    return epochs[financeRangeKey(start, end)] === revision;
}

/**
 * Record that `cache` was stored at `revision`, and drop epochs whose ranges
 * were evicted from the cache.
 */
export function putFinanceSummaryEpoch(
    epochs: Record<string, number>,
    cache: Record<string, FinanceSummary>,
    start: string,
    end: string,
    revision: number
): Record<string, number> {
    const key = financeRangeKey(start, end);
    const next: Record<string, number> = { [key]: revision };
    for (const cacheKey of Object.keys(cache)) {
        if (cacheKey !== key && epochs[cacheKey] !== undefined) {
            next[cacheKey] = epochs[cacheKey];
        }
    }
    return next;
}
