import { StateCreator } from 'zustand';

import { createClient } from '../../lib/supabase/client';
import {
    financeRangeKey,
    invalidateFinanceSummaryCache,
    isFinanceSummaryFresh,
    putCachedFinanceSummary,
    putFinanceSummaryEpoch,
} from '../../lib/finance/cache';
import { mergeFinanceCategories } from '../../lib/finance/mapping';
import type { FinanceCategory, FinanceEntry, FinanceReplacePayloadEntry, FinanceSummary } from '../../lib/finance/types';
import {
    fetchFinanceCategories,
    fetchFinancePreference,
    fetchTaskFinanceEntries,
    listFinanceEntriesInRange,
    replaceTaskFinanceEntries as replaceTaskFinanceEntriesRecord,
    summarizeFinanceRange,
    upsertFinancePreference,
} from '../../lib/supabase/repositories/financeRepository';
import { StoreState } from '../types';

export interface FinanceSlice {
    financeEnabled: boolean;
    financePreferenceLoaded: boolean;
    financePreferenceSaving: boolean;
    financeCategories: FinanceCategory[];
    financeCategoriesLoaded: boolean;
    financeSummaryCache: Record<string, FinanceSummary>;
    /** Revision at which each cached range was fetched. Older entries stay visible but are not reused. */
    financeSummaryCacheEpoch: Record<string, number>;
    /** Bumped after a successful write so visible day/week/month/year totals refetch. */
    financeSummaryRevision: number;
    financeSummaryLoading: Record<string, boolean>;
    financeSummaryError: Record<string, string | null>;
    loadFinancePreference: () => Promise<void>;
    setFinanceEnabled: (enabled: boolean) => Promise<boolean>;
    loadFinanceCategories: () => Promise<void>;
    ensureFinanceSummary: (start: string, end: string) => Promise<FinanceSummary | null>;
    loadFinanceEntriesForTask: (taskId: string) => Promise<FinanceEntry[]>;
    loadFinanceBreakdown: (start: string, end: string) => Promise<FinanceEntry[]>;
    replaceTaskFinanceEntries: (
        taskId: string,
        entries: FinanceReplacePayloadEntry[],
        sourceTaskId?: string
    ) => Promise<boolean>;
    resetFinanceSlice: () => void;
}

const initialFinanceState = {
    financeEnabled: false,
    financePreferenceLoaded: false,
    financePreferenceSaving: false,
    financeCategories: [] as FinanceCategory[],
    financeCategoriesLoaded: false,
    financeSummaryCache: {} as Record<string, FinanceSummary>,
    financeSummaryCacheEpoch: {} as Record<string, number>,
    financeSummaryRevision: 0,
    financeSummaryLoading: {} as Record<string, boolean>,
    financeSummaryError: {} as Record<string, string | null>,
};

const inflightSummaries = new Map<string, Promise<FinanceSummary | null>>();
let inflightCategories: { key: string; promise: Promise<void> } | null = null;
let financeGeneration = 0;

function isCurrentFinanceRequest(
    get: () => StoreState,
    userId: string,
    generation: number
): boolean {
    return (
        financeGeneration === generation &&
        get().user?.uid === userId
    );
}

function invalidateFinanceRequests() {
    financeGeneration += 1;
    inflightSummaries.clear();
    inflightCategories = null;
}

function clearFinanceData() {
    return {
        financeCategories: [] as FinanceCategory[],
        financeCategoriesLoaded: false,
        financeSummaryCache: invalidateFinanceSummaryCache(),
        financeSummaryCacheEpoch: {} as Record<string, number>,
        financeSummaryLoading: {} as Record<string, boolean>,
        financeSummaryError: {} as Record<string, string | null>,
    };
}

export const createFinanceSlice: StateCreator<StoreState, [], [], FinanceSlice> = (set, get) => ({
    ...initialFinanceState,

    loadFinancePreference: async () => {
        const { user } = get();
        if (!user) {
            set({
                ...initialFinanceState,
                financePreferenceLoaded: true,
            });
            return;
        }

        const userId = user.uid;
        const generation = financeGeneration;

        try {
            const enabled = await fetchFinancePreference(createClient());
            if (!isCurrentFinanceRequest(get, userId, generation)) {
                return;
            }
            if (!enabled) {
                invalidateFinanceRequests();
                set({
                    financeEnabled: false,
                    financePreferenceLoaded: true,
                    ...clearFinanceData(),
                });
                return;
            }

            set({
                financeEnabled: true,
                financePreferenceLoaded: true,
            });
        } catch (error) {
            console.error('Failed to load finance preference:', error);
            if (!isCurrentFinanceRequest(get, userId, generation)) {
                return;
            }
            invalidateFinanceRequests();
            set({
                financeEnabled: false,
                financePreferenceLoaded: true,
                ...clearFinanceData(),
            });
        }
    },

    setFinanceEnabled: async (enabled) => {
        const { user } = get();
        if (!user) {
            return false;
        }

        const previous = get().financeEnabled;
        invalidateFinanceRequests();
        const generation = financeGeneration;
        set({
            financeEnabled: enabled,
            financePreferenceSaving: true,
        });

        try {
            await upsertFinancePreference(createClient(), user.uid, enabled);
            if (!isCurrentFinanceRequest(get, user.uid, generation)) {
                return false;
            }
            if (enabled) {
                set({
                    financeEnabled: true,
                    financePreferenceSaving: false,
                    financeSummaryCache: invalidateFinanceSummaryCache(),
                    financeSummaryCacheEpoch: {},
                    financeSummaryLoading: {},
                    financeSummaryError: {},
                });
            } else {
                set({
                    financeEnabled: false,
                    financePreferenceSaving: false,
                    ...clearFinanceData(),
                });
            }
            return true;
        } catch (error) {
            console.error('Failed to update finance preference:', error);
            if (!isCurrentFinanceRequest(get, user.uid, generation)) {
                return false;
            }
            set({
                financeEnabled: previous,
                financePreferenceSaving: false,
                financeSummaryLoading: {},
            });
            return false;
        }
    },

    loadFinanceCategories: async () => {
        const { financeEnabled, financeCategoriesLoaded, user } = get();
        if (!financeEnabled || financeCategoriesLoaded || !user) {
            return;
        }

        const generation = financeGeneration;
        const requestKey = `${user.uid}:${generation}`;
        if (inflightCategories?.key === requestKey) {
            return inflightCategories.promise;
        }

        const request = (async () => {
            try {
                const categories = await fetchFinanceCategories(createClient());
                if (
                    !isCurrentFinanceRequest(get, user.uid, generation) ||
                    !get().financeEnabled
                ) {
                    return;
                }
                set({
                    financeCategories: categories,
                    financeCategoriesLoaded: true,
                });
            } catch (error) {
                console.error('Failed to load finance categories:', error);
            } finally {
                if (inflightCategories?.key === requestKey) {
                    inflightCategories = null;
                }
            }
        })();

        inflightCategories = { key: requestKey, promise: request };
        return request;
    },

    ensureFinanceSummary: async (start, end) => {
        const { financeEnabled, user } = get();
        if (!financeEnabled || !user) {
            return null;
        }

        const revision = get().financeSummaryRevision;
        const key = financeRangeKey(start, end);
        const cached = get().financeSummaryCache[key];
        if (cached && isFinanceSummaryFresh(get().financeSummaryCacheEpoch, start, end, revision)) {
            return cached;
        }

        const generation = financeGeneration;
        const requestKey = `${user.uid}:${generation}:${revision}:${key}`;
        const inflight = inflightSummaries.get(requestKey);
        if (inflight) {
            return inflight;
        }

        const request = (async () => {
            set((state) => ({
                financeSummaryLoading: { ...state.financeSummaryLoading, [key]: true },
                financeSummaryError: { ...state.financeSummaryError, [key]: null },
            }));
            try {
                const summary = await summarizeFinanceRange(createClient(), start, end);
                if (
                    !isCurrentFinanceRequest(get, user.uid, generation) ||
                    !get().financeEnabled ||
                    get().financeSummaryRevision !== revision
                ) {
                    return null;
                }
                set((state) => {
                    const financeSummaryCache = putCachedFinanceSummary(state.financeSummaryCache, summary);
                    return {
                        financeSummaryCache,
                        financeSummaryCacheEpoch: putFinanceSummaryEpoch(
                            state.financeSummaryCacheEpoch,
                            financeSummaryCache,
                            start,
                            end,
                            revision
                        ),
                        financeSummaryLoading: { ...state.financeSummaryLoading, [key]: false },
                        financeSummaryError: { ...state.financeSummaryError, [key]: null },
                    };
                });
                return summary;
            } catch (error) {
                console.error('Failed to load finance summary:', error);
                if (
                    isCurrentFinanceRequest(get, user.uid, generation) &&
                    get().financeEnabled
                ) {
                    set((state) => ({
                        financeSummaryLoading: { ...state.financeSummaryLoading, [key]: false },
                        financeSummaryError: {
                            ...state.financeSummaryError,
                            [key]: error instanceof Error ? error.message : 'Failed to load finance summary',
                        },
                    }));
                }
                return null;
            } finally {
                inflightSummaries.delete(requestKey);
            }
        })();

        inflightSummaries.set(requestKey, request);
        return request;
    },

    loadFinanceEntriesForTask: async (taskId) => {
        const { financeEnabled, user } = get();
        if (!financeEnabled || !user) {
            return [];
        }
        const generation = financeGeneration;
        const entries = await fetchTaskFinanceEntries(createClient(), taskId);
        if (
            !isCurrentFinanceRequest(get, user.uid, generation) ||
            !get().financeEnabled
        ) {
            throw new Error('Stale finance request');
        }
        return entries;
    },

    loadFinanceBreakdown: async (start, end) => {
        const { financeEnabled, user } = get();
        if (!financeEnabled || !user) {
            return [];
        }
        const generation = financeGeneration;
        const entries = await listFinanceEntriesInRange(createClient(), start, end);
        if (
            !isCurrentFinanceRequest(get, user.uid, generation) ||
            !get().financeEnabled
        ) {
            throw new Error('Stale finance request');
        }
        return entries;
    },

    replaceTaskFinanceEntries: async (taskId, entries, sourceTaskId) => {
        const { financeEnabled, user } = get();
        if (!financeEnabled || !user) {
            return false;
        }

        const generation = financeGeneration;
        const userId = user.uid;
        try {
            const saved = await replaceTaskFinanceEntriesRecord(createClient(), taskId, entries, sourceTaskId);
            if (
                !isCurrentFinanceRequest(get, userId, generation) ||
                !get().financeEnabled
            ) {
                return false;
            }
            // Drop in-flight totals so a request that started before this write cannot
            // be stored as fresh. Keep the previous numbers on screen until the refetch lands.
            invalidateFinanceRequests();
            set((state) => {
                const financeCategories = mergeFinanceCategories(state.financeCategories, saved, userId);
                return {
                    financeSummaryRevision: state.financeSummaryRevision + 1,
                    financeSummaryLoading: {},
                    financeSummaryError: {},
                    ...(financeCategories !== state.financeCategories ? { financeCategories } : {}),
                };
            });
            return true;
        } catch (error) {
            console.error('Failed to save finance entries:', error);
            return false;
        }
    },

    resetFinanceSlice: () => {
        invalidateFinanceRequests();
        set({ ...initialFinanceState });
    },
});
