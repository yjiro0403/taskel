import { NextResponse, after } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError, jsonError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { mapAlarm } from '@/lib/supabase/mappers';
import { alarmUpsertPush, sendAlarmPushToUser } from '@/lib/server/fcm';
import { alarmCreateSchema } from '@/lib/validations/alarm';

// GET: 自分の「今後のアラーム」一覧。
// scheduled のもの（過去の未処理分も端末側で扱えるよう含める）と、
// 状態を問わず fire_at が現在以降のものを返す。
export async function GET() {
    try {
        const user = await requireAuth();
        const supabase = await createClient();

        const nowIso = new Date().toISOString();
        const { data, error } = await supabase
            .from('alarms')
            .select('*')
            .eq('user_id', user.id)
            .or(`status.eq.scheduled,fire_at.gte.${nowIso}`)
            .order('fire_at', { ascending: true });

        if (error) {
            throw error;
        }

        return NextResponse.json({ alarms: data.map(mapAlarm) });
    } catch (error) {
        return handleApiError('API Error in GET /api/alarms', error);
    }
}

export async function POST(req: Request) {
    try {
        const user = await requireAuth();
        const { taskId, label, fireAt, snoozeMinutes } = await parseJsonBody(req, alarmCreateSchema);
        const supabase = await createClient();

        // taskId 指定時は、自分から見えるタスクかを RLS 越しに確認する
        // （他人のタスク id への紐付けを 404 で拒否する。comments ルートと同じ流儀）。
        if (taskId) {
            const { data: task, error: taskError } = await supabase
                .from('tasks')
                .select('id')
                .eq('id', taskId)
                .maybeSingle();

            if (taskError) {
                throw taskError;
            }

            if (!task) {
                return jsonError('Task not found', 404);
            }
        }

        const { data: insertedAlarm, error: insertError } = await supabase
            .from('alarms')
            .insert({
                user_id: user.id,
                task_id: taskId ?? null,
                label: label ?? null,
                fire_at: new Date(fireAt).toISOString(),
                ...(snoozeMinutes !== undefined ? { snooze_minutes: snoozeMinutes } : {}),
            })
            .select('*')
            .single();

        if (insertError) {
            throw insertError;
        }

        const alarm = mapAlarm(insertedAlarm);

        // FCM 即時同期（fire-and-forget）。レスポンス返却後に送信し、失敗してもログのみ。
        after(() => sendAlarmPushToUser(supabase, user.id, alarmUpsertPush(alarm)));

        return NextResponse.json({ alarm });
    } catch (error) {
        return handleApiError('API Error in POST /api/alarms', error);
    }
}
