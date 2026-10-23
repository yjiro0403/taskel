import { NextRequest, NextResponse, after } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { mapAlarm } from '@/lib/supabase/mappers';
import { isMissingRingingColumn, planAlarmPatch } from '@/lib/alarms/deviceReport';
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

        // 鳴動マークだけは、解除済みのアラームへ付けない。
        let currentStatus = 'scheduled';
        if (updates.ringing === true) {
            const { data: current, error: currentError } = await supabase
                .from('alarms')
                .select('status')
                .eq('id', id)
                .eq('user_id', user.id)
                .maybeSingle();
            if (currentError) {
                throw currentError;
            }
            if (!current) {
                return jsonError('Alarm not found', 404);
            }
            currentStatus = current.status;
        }
        const plan = planAlarmPatch(updates, currentStatus);

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
        if (plan.setRingingAt === 'clear') {
            payload.ringing_at = null;
        } else if (plan.setRingingAt === 'now') {
            payload.ringing_at = new Date().toISOString();
        }

        if (Object.keys(payload).length === 0) {
            const { data: existing, error: existingError } = await supabase
                .from('alarms')
                .select('*')
                .eq('id', id)
                .eq('user_id', user.id)
                .maybeSingle();
            if (existingError) {
                throw existingError;
            }
            if (!existing) {
                return jsonError('Alarm not found', 404);
            }
            return NextResponse.json({ alarm: mapAlarm(existing) });
        }

        // RLS でも本人のみに制限されるが、多重防御として user_id も明示的に絞る。
        const updateAlarmRow = (body: Database['public']['Tables']['alarms']['Update']) =>
            supabase.from('alarms').update(body).eq('id', id).eq('user_id', user.id).select('*').maybeSingle();

        let { data: updatedAlarm, error: updateError } = await updateAlarmRow(payload);
        // ringing_at 追加前のデータベースでも、停止や時刻変更そのものは通す。
        if (updateError && isMissingRingingColumn(updateError) && 'ringing_at' in payload) {
            const withoutRinging = { ...payload };
            delete withoutRinging.ringing_at;
            ({ data: updatedAlarm, error: updateError } = await updateAlarmRow(withoutRinging));
        }

        if (updateError) {
            throw updateError;
        }

        if (!updatedAlarm) {
            return jsonError('Alarm not found', 404);
        }

        const alarm = mapAlarm(updatedAlarm);

        // 鳴動マークだけは端末の予約を消さない。解除・時刻変更は全端末へ届ける。
        // status が scheduled 以外、または未来時刻への変更は、鳴っている音も止める。
        if (plan.push) {
            after(() => sendAlarmPushToUser(supabase, user.id, alarmUpsertPush(alarm)));
        }

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
