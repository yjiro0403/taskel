import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { mapDeviceToken } from '@/lib/supabase/mappers';
import { deviceTokenUpsertSchema } from '@/lib/validations/alarm';

// POST: FCM トークンの upsert（後続フェーズで Capacitor アプリが端末登録に使う。UI なし）。
// fcm_token は unique のため、同一端末の再登録は device_name / updated_at の更新になる。
// 注意: 同じトークンが別ユーザーの行として存在する場合、RLS により更新できず失敗する
// （トークンはユーザー間で移動しない前提。端末側は新トークンを再発行して登録し直すこと）。
export async function POST(req: Request) {
    try {
        const user = await requireAuth();
        const { fcmToken, deviceName } = await parseJsonBody(req, deviceTokenUpsertSchema);
        const supabase = await createClient();

        const { data: upsertedToken, error: upsertError } = await supabase
            .from('device_tokens')
            .upsert(
                {
                    user_id: user.id,
                    fcm_token: fcmToken,
                    device_name: deviceName ?? null,
                },
                { onConflict: 'fcm_token' }
            )
            .select('*')
            .single();

        if (upsertError) {
            throw upsertError;
        }

        return NextResponse.json({ deviceToken: mapDeviceToken(upsertedToken) });
    } catch (error) {
        return handleApiError('API Error in POST /api/device-tokens', error);
    }
}
