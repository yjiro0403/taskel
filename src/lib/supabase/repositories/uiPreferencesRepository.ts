import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../types/supabase';

type Client = SupabaseClient<Database>;

export interface UiPreferences {
    timelineEnabled: boolean;
    hideEmptyIntervals: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
    timelineEnabled: false,
    hideEmptyIntervals: true,
};

function requireNoError(error: { message: string } | null) {
    if (error) {
        throw new Error(error.message);
    }
}

export async function fetchUiPreferences(client: Client): Promise<UiPreferences> {
    const { data, error } = await client
        .from('user_ui_preferences')
        .select('timeline_enabled, hide_empty_intervals')
        .maybeSingle();

    requireNoError(error);
    if (!data) {
        return { ...DEFAULT_UI_PREFERENCES };
    }
    return {
        timelineEnabled: data.timeline_enabled === true,
        hideEmptyIntervals: data.hide_empty_intervals !== false,
    };
}

export async function upsertUiPreferences(
    client: Client,
    userId: string,
    patch: Partial<UiPreferences>
): Promise<UiPreferences> {
    const current = await fetchUiPreferences(client);
    const next: UiPreferences = {
        timelineEnabled: patch.timelineEnabled ?? current.timelineEnabled,
        hideEmptyIntervals: patch.hideEmptyIntervals ?? current.hideEmptyIntervals,
    };

    const { data, error } = await client
        .from('user_ui_preferences')
        .upsert(
            {
                user_id: userId,
                timeline_enabled: next.timelineEnabled,
                hide_empty_intervals: next.hideEmptyIntervals,
            },
            { onConflict: 'user_id' }
        )
        .select('timeline_enabled, hide_empty_intervals')
        .single();

    requireNoError(error);
    return {
        timelineEnabled: data?.timeline_enabled === true,
        hideEmptyIntervals: data?.hide_empty_intervals !== false,
    };
}
