import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../types/supabase';
import { fetchUiPreferences, upsertUiPreferences } from './uiPreferencesRepository';

type Client = SupabaseClient<Database>;

describe('uiPreferencesRepository', () => {
    it('treats a missing row as timeline off and empty intervals hidden', async () => {
        const client = {
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
            }),
        } as unknown as Client;

        await expect(fetchUiPreferences(client)).resolves.toEqual({
            timelineEnabled: false,
            hideEmptyIntervals: true,
        });
    });

    it('upserts the merged preference row', async () => {
        const maybeSingle = vi.fn().mockResolvedValue({
            data: { timeline_enabled: false, hide_empty_intervals: true },
            error: null,
        });
        const single = vi.fn().mockResolvedValue({
            data: { timeline_enabled: true, hide_empty_intervals: true },
            error: null,
        });
        const selectAfter = vi.fn().mockReturnValue({ single });
        const upsert = vi.fn().mockReturnValue({ select: selectAfter });
        const selectBefore = vi.fn().mockReturnValue({ maybeSingle });

        const client = {
            from: vi.fn()
                .mockReturnValueOnce({ select: selectBefore })
                .mockReturnValueOnce({ upsert }),
        } as unknown as Client;

        await expect(upsertUiPreferences(client, 'user-1', { timelineEnabled: true })).resolves.toEqual({
            timelineEnabled: true,
            hideEmptyIntervals: true,
        });
        expect(upsert).toHaveBeenCalledWith(
            {
                user_id: 'user-1',
                timeline_enabled: true,
                hide_empty_intervals: true,
            },
            { onConflict: 'user_id' }
        );
    });
});
