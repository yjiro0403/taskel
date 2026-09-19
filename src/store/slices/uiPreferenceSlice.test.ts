import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoreState } from '../types';
import { createUIPreferenceSlice } from './uiPreferenceSlice';

vi.mock('../../lib/supabase/client', () => ({
    createClient: () => ({}),
}));

vi.mock('../../lib/supabase/repositories/uiPreferencesRepository', () => ({
    DEFAULT_UI_PREFERENCES: { timelineEnabled: false, hideEmptyIntervals: true },
    fetchUiPreferences: vi.fn(),
    upsertUiPreferences: vi.fn(),
}));

import {
    fetchUiPreferences,
    upsertUiPreferences,
} from '../../lib/supabase/repositories/uiPreferencesRepository';

const mockedFetch = vi.mocked(fetchUiPreferences);
const mockedUpsert = vi.mocked(upsertUiPreferences);

function createHarness(user: { uid: string } | null = { uid: 'user-1' }) {
    const state = { user } as unknown as StoreState;
    const set = ((partial: unknown) => {
        const next = typeof partial === 'function' ? (partial as (current: StoreState) => object)(state) : partial;
        Object.assign(state, next);
    }) as never;
    const slice = createUIPreferenceSlice(set, () => state, {} as never);
    Object.assign(state, slice);
    return { state, slice };
}

describe('uiPreferenceSlice', () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it('defaults timeline off', () => {
        const { state } = createHarness();
        expect(state.timelineEnabled).toBe(false);
        expect(state.hideEmptyIntervals).toBe(true);
    });

    it('loads stored preferences', async () => {
        mockedFetch.mockResolvedValue({ timelineEnabled: true, hideEmptyIntervals: false });
        const { state, slice } = createHarness();
        await slice.loadUiPreferences();
        expect(state.timelineEnabled).toBe(true);
        expect(state.hideEmptyIntervals).toBe(false);
        expect(state.uiPreferencesLoaded).toBe(true);
    });

    it('rolls back a failed timeline toggle', async () => {
        mockedUpsert.mockRejectedValue(new Error('offline'));
        const { state, slice } = createHarness();
        await expect(slice.setTimelineEnabled(true)).resolves.toBe(false);
        expect(state.timelineEnabled).toBe(false);
        expect(state.uiPreferencesSaving).toBe(false);
    });
});
