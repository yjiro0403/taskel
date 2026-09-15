import { NextRequest, NextResponse, after } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { mapAlarm } from '@/lib/supabase/mappers';
import { alarmDeletePush, alarmUpsertPush, sendAlarmPushToUser } from '@/lib/server/fcm';
import { alarmUpdateSchema } from '@/lib/validations/alarm';
import type { Database } from '@/types/supabase';

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await requireAuth();
        const { id } = await params;
        const updates = await parseJsonBody(req, alarmUpdateSchema);
        const supabase = await createClient();

        // 指定されたキーのみを更新する（undefined は「変更しない」）。
        const payload: Database['public']['Tables']['alarms']['Update'] = {};
        if (updates.fireAt !== undefined) {
            payload.fire_at = new Date(updates.fireAt).toISOString();
        }
        if (updates.label !== undefined) {
            payload.label = updates.label;
        }
        if (updates.offsetMinutes !== undefined) {
            // null を明示的に送ると絶対時刻指定へ戻す
            payload.offset_minutes = updates.offsetMinutes;
        }
        if (updates.snoozeMinutes !== undefined) {
            payload.snooze_minutes = updates.snoozeMinutes;
        }
        if (updates.status !== undefined) {
            payload.status = updates.status;
        }

        // RLS でも本人のみに制限されるが、多重防御として user_id も明示的に絞る。
        const { data: updatedAlarm, error: updateError } = await supabase
            .from('alarms')
            .update(payload)
            .eq('id', id)
            .eq('user_id', user.id)
            .select('*')
            .maybeSingle();

        if (updateError) {
            throw updateError;
        }

        if (!updatedAlarm) {
            return jsonError('Alarm not found', 404);
        }

        const alarm = mapAlarm(updatedAlarm);

        // FCM 即時同期（fire-and-forget）。status が scheduled 以外の upsert は
        // ネイティブ側でキャンセル扱いになる。
        after(() => sendAlarmPushToUser(supabase, user.id, alarmUpsertPush(alarm)));

        return NextResponse.json({ alarm });
    } catch (error) {
        return handleApiError('API Error in PATCH /api/alarms/[id]', error);
    }
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await requireAuth();
        const { id } = await params;
        const supabase = await createClient();

        const { data: deletedRows, error: deleteError } = await supabase
            .from('alarms')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)
            .select('id');

        if (deleteError) {
            throw deleteError;
        }

        if (!deletedRows || deletedRows.length === 0) {
            return jsonError('Alarm not found', 404);
        }

        // FCM 即時同期（fire-and-forget）。端末側の AlarmManager 登録を解除させる。
        after(() => sendAlarmPushToUser(supabase, user.id, alarmDeletePush(id)));

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleApiError('API Error in DELETE /api/alarms/[id]', error);
    }
}
