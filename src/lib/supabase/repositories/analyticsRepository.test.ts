import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../types/supabase';
import { fetchPeriodPlan, upsertCategoryBudget } from './analyticsRepository';

type Client = SupabaseClient<Database>;

describe('analyticsRepository', () => {
    it('rejects an invalid period key before querying', async () => {
        const client = { from: vi.fn() } as unknown as Client;
        await expect(fetchPeriodPlan(client, 'week', '2026-38')).rejects.toThrow(/Invalid period key/);
        expect(client.from).not.toHaveBeenCalled();
    });

    it('upserts a category budget on the composite unique key', async () => {
        const single = vi.fn().mockResolvedValue({
            data: {
                id: 'b1',
                user_id: 'user-1',
                period_type: 'month',
                period_key: '2026-09',
                category_id: 'c1',
                amount_yen: 30000,
                created_at: '2026-09-01T00:00:00.000Z',
                updated_at: '2026-09-01T00:00:00.000Z',
            },
            error: null,
        });
        const upsert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single }),
        });
        const client = {
            from: vi.fn().mockReturnValue({ upsert }),
        } as unknown as Client;

        const row = await upsertCategoryBudget(client, 'user-1', 'month', '2026-09', 'c1', 30000);
        expect(row.amountYen).toBe(30000);
        expect(upsert).toHaveBeenCalledWith(
            {
                user_id: 'user-1',
                period_type: 'month',
                period_key: '2026-09',
                category_id: 'c1',
                amount_yen: 30000,
            },
            { onConflict: 'user_id,period_type,period_key,category_id' }
        );
    });
});
