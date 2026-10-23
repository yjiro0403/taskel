import { NextResponse, after } from 'next/server';

import { decideDeviceReport, DEVICE_SECRET_HEADER, hashDeviceSecret } from '@/lib/alarms/deviceReport';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { alarmUpsertPush, sendAlarmPushToUser } from '@/lib/server/fcm';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapAlarm } from '@/lib/supabase/mappers';
import { deviceAlarmReportSchema } from '@/lib/validations/alarm';

function readDeviceSecret(req: Request): string | null {
    const secret = req.headers.get(DEVICE_SECRET_HEADER)?.trim();
    if (!secret || secret.length < 32 || secret.length > 200) {
        return null;
    }
    return secret;
}

/**
 * アプリの WebView が止まっていても、端末が鳴動・停止・スヌーズを報告する。
 * 認可はログインセッションではなく、登録済み端末秘密の SHA-256 で行う。
 */
export async function POST(req: Request) {
    try {
        const secret = readDeviceSecret(req);
        if (!secret) {
            return jsonError('Unauthorized', 401);
        }

        const body = await parseJsonBody(req, deviceAlarmReportSchema);
        const admin = createAdminClient();
        const { data: device, error: deviceError } = await admin
            .from('device_tokens')
            .select('user_id')
            .eq('device_secret_hash', hashDeviceSecret(secret))
            .maybeSingle();

        if (deviceError) {
            throw deviceError;
        }
        if (!device) {
            return jsonError('Unauthorized', 401);
        }

        const { data: row, error: alarmError } = await admin
            .from('alarms')
            .select('*')
            .eq('id', body.alarmId)
            .eq('user_id', device.user_id)
            .maybeSingle();

        if (alarmError) {
            throw alarmError;
        }
        if (!row) {
            return NextResponse.json({ outcome: 'stop' });
        }

        const decision = decideDeviceReport(
            { status: row.status, ringingAt: row.ringing_at },
            body.action,
            new Date(),
            body.fireAt
        );

        if (decision.kind === 'reject') {
            return jsonError('Invalid snooze time', 400);
        }

        if (decision.kind === 'ringing') {
            if (decision.changed) {
                const { data: updated, error: updateError } = await admin
                    .from('alarms')
                    .update({ ringing_at: new Date().toISOString() })
                    .eq('id', row.id)
                    .eq('user_id', device.user_id)
                    .eq('status', 'scheduled')
                    .is('ringing_at', null)
                    .select('id')
                    .maybeSingle();
                if (updateError) {
                    throw updateError;
                }
                if (!updated) {
                    const { data: again, error: againError } = await admin
                        .from('alarms')
                        .select('status, ringing_at')
                        .eq('id', row.id)
                        .eq('user_id', device.user_id)
                        .maybeSingle();
                    if (againError) {
                        throw againError;
                    }
                    if (!(again?.status === 'scheduled' && again.ringing_at)) {
                        return NextResponse.json({ outcome: 'stop' });
                    }
                }
            }
            return NextResponse.json({ outcome: 'ringing' });
        }

        if (decision.kind === 'snooze') {
            const { data: updated, error: updateError } = await admin
                .from('alarms')
                .update({ fire_at: decision.fireAt, ringing_at: null })
                .eq('id', row.id)
                .eq('user_id', device.user_id)
                .eq('status', 'scheduled')
                .select('*')
                .maybeSingle();
            if (updateError) {
                throw updateError;
            }
            if (!updated) {
                return NextResponse.json({ outcome: 'stop' });
            }
            const alarm = mapAlarm(updated);
            after(() => sendAlarmPushToUser(admin, device.user_id, alarmUpsertPush(alarm)));
            return NextResponse.json({ outcome: 'snoozed' });
        }

        if (decision.changed) {
            const { data: updated, error: updateError } = await admin
                .from('alarms')
                .update({ status: 'dismissed', ringing_at: null })
                .eq('id', row.id)
                .eq('user_id', device.user_id)
                .select('*')
                .maybeSingle();
            if (updateError) {
                throw updateError;
            }
            if (updated) {
                const alarm = mapAlarm(updated);
                after(() => sendAlarmPushToUser(admin, device.user_id, alarmUpsertPush(alarm)));
            }
        } else if (row.status !== 'scheduled') {
            // 先に別の場所で止まっていても、鳴り続けている端末へもう一度届ける。
            after(() => sendAlarmPushToUser(admin, device.user_id, alarmUpsertPush(mapAlarm(row))));
        }

        return NextResponse.json({ outcome: 'stop' });
    } catch (error) {
        return handleApiError('API Error in POST /api/device-alarms/report', error);
    }
}
