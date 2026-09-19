import { StateCreator } from 'zustand';

import { createClient } from '../../lib/supabase/client';
import {
    DEFAULT_UI_PREFERENCES,
    fetchUiPreferences,
    upsertUiPreferences,
    type UiPreferences,
} from '../../lib/supabase/repositories/uiPreferencesRepository';
import { StoreState } from '../types';

export interface UIPreferenceSlice extends UiPreferences {
    uiPreferencesLoaded: boolean;
    uiPreferencesSaving: boolean;
    loadUiPreferences: () => Promise<void>;
    setTimelineEnabled: (enabled: boolean) => Promise<boolean>;
    setHideEmptyIntervals: (hidden: boolean) => Promise<boolean>;
    resetUIPreferenceSlice: () => void;
}

const initialState = {
    ...DEFAULT_UI_PREFERENCES,
    uiPreferencesLoaded: false,
    uiPreferencesSaving: false,
};

let uiPreferenceGeneration = 0;

export const createUIPreferenceSlice: StateCreator<StoreState, [], [], UIPreferenceSlice> = (set, get) => ({
    ...initialState,

    loadUiPreferences: async () => {
        const { user } = get();
        if (!user) {
            set({ ...initialState, uiPreferencesLoaded: true });
            return;
        }

        const generation = ++uiPreferenceGeneration;
        try {
            const prefs = await fetchUiPreferences(createClient());
            if (generation !== uiPreferenceGeneration || get().user?.uid !== user.uid) {
                return;
            }
            set({
                ...prefs,
                uiPreferencesLoaded: true,
            });
        } catch (error) {
            console.error('Failed to load UI preferences:', error);
            if (generation !== uiPreferenceGeneration || get().user?.uid !== user.uid) {
                return;
            }
            set({ ...DEFAULT_UI_PREFERENCES, uiPreferencesLoaded: true });
        }
    },

    setTimelineEnabled: async (enabled) => {
        return savePreference(set, get, { timelineEnabled: enabled });
    },

    setHideEmptyIntervals: async (hidden) => {
        return savePreference(set, get, { hideEmptyIntervals: hidden });
    },

    resetUIPreferenceSlice: () => {
        uiPreferenceGeneration += 1;
        set({ ...initialState });
    },
});

async function savePreference(
    set: (partial: Partial<StoreState>) => void,
    get: () => StoreState,
    patch: Partial<UiPreferences>
): Promise<boolean> {
    const { user } = get();
    if (!user) return false;

    const previous: UiPreferences = {
        timelineEnabled: get().timelineEnabled,
        hideEmptyIntervals: get().hideEmptyIntervals,
    };
    set({ ...patch, uiPreferencesSaving: true });

    try {
        const saved = await upsertUiPreferences(createClient(), user.uid, patch);
        if (get().user?.uid !== user.uid) return false;
        set({
            ...saved,
            uiPreferencesSaving: false,
        });
        return true;
    } catch (error) {
        console.error('Failed to save UI preferences:', error);
        if (get().user?.uid !== user.uid) return false;
        set({
            ...previous,
            uiPreferencesSaving: false,
        });
        return false;
    }
}
