// FCM HTTP v1 でアラーム差分を端末へプッシュする（Phase C）。
//
// 方針:
// - firebase-admin は使わず、google-auth-library で OAuth トークンを取得して
//   fetch で v1 API を直接叩く（依存最小化）。
// - FIREBASE_SERVICE_ACCOUNT（サービスアカウント JSON の文字列）が未設定なら
//   静かにスキップする（Phase A/B の「アプリ起動時同期のみ」でも動く状態を維持）。
// - 呼び出し元（/api/alarms 系ルート）からは fire-and-forget。送信失敗しても
//   API レスポンスは成功のままにし、ここではログを残すだけにする。
// - notification フィールドは使わず data-only メッセージ（priority HIGH）。
//   表示・鳴動はネイティブ側（AlarmManager + AlarmActivity）の責務。

import { JWT } from 'google-auth-library';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Alarm } from '@/types';
import type { Database } from '@/types/supabase';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** data-only メッセージの payload。FCM の data は string map のため全て文字列。 */
export type AlarmPushData =
    | {
          type: 'alarm_upsert';
          id: string;
          fireAt: string; // epoch ms の文字列
          label: string;
          snoozeMinutes: string;
          status: string;
      }
    | {
          type: 'alarm_delete';
          id: string;
      };

export function alarmUpsertPush(alarm: Alarm): AlarmPushData {
    return {
        type: 'alarm_upsert',
        id: alarm.id,
        fireAt: String(alarm.fireAt),
        label: alarm.label ?? '',
        snoozeMinutes: String(alarm.snoozeMinutes),
        status: alarm.status,
    };
}

export function alarmDeletePush(alarmId: string): AlarmPushData {
    return { type: 'alarm_delete', id: alarmId };
}

interface FcmClient {
    jwt: JWT;
    projectId: string;
}

// モジュールスコープでキャッシュ（undefined = 未初期化、null = 設定なし/不正）。
let cachedClient: FcmClient | null | undefined;

function getFcmClient(): FcmClient | null {
    if (cachedClient !== undefined) return cachedClient;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
        cachedClient = null;
        return cachedClient;
    }

    try {
        const parsed = JSON.parse(raw) as {
            project_id?: string;
            client_email?: string;
            private_key?: string;
        };
        if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
            console.error('FIREBASE_SERVICE_ACCOUNT is missing project_id / client_email / private_key');
            cachedClient = null;
            return cachedClient;
        }
        cachedClient = {
            jwt: new JWT({
                email: parsed.client_email,
                // 環境変数経由で \n がリテラルのまま入るケースに備える
                key: parsed.private_key.replace(/\\n/g, '\n'),
                scopes: [FCM_SCOPE],
            }),
            projectId: parsed.project_id,
        };
    } catch (error) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', error);
        cachedClient = null;
    }
    return cachedClient;
}

/** FCM v1 のエラーから「このトークンは無効なので削除すべき」かを判定する。 */
function isInvalidTokenError(status: number, body: unknown): boolean {
    // 404 NOT_FOUND = UNREGISTERED（アンインストール等）、400 INVALID_ARGUMENT = 壊れたトークン
    if (status === 404) return true;
    if (status !== 400) return false;
    const errorStatus =
        typeof body === 'object' && body !== null
            ? (body as { error?: { status?: string } }).error?.status
            : undefined;
    return errorStatus === 'INVALID_ARGUMENT';
}

/**
 * 対象ユーザーの全端末へアラーム差分を data メッセージで送る。
 *
 * - RLS 的に自分の device_tokens しか読めないユーザースコープの Supabase クライアントを
 *   そのまま受け取る（ルートのリクエストコンテキストから呼ばれる前提）。
 * - UNREGISTERED / INVALID_ARGUMENT のトークンは device_tokens から削除する。
 * - すべての失敗は console.error のみ（呼び出し元へは投げない）。
 */
export async function sendAlarmPushToUser(
    supabase: SupabaseClient<Database>,
    userId: string,
    data: AlarmPushData
): Promise<void> {
    try {
        const client = getFcmClient();
        if (!client) return; // Firebase 未設定なら何もしない（Phase A/B 挙動を維持）

        const { data: tokens, error } = await supabase
            .from('device_tokens')
            .select('id, fcm_token')
            .eq('user_id', userId);

        if (error) {
            console.error('FCM: failed to load device tokens:', error);
            return;
        }
        if (!tokens || tokens.length === 0) return;

        const accessToken = (await client.jwt.getAccessToken()).token;
        if (!accessToken) {
            console.error('FCM: failed to obtain access token');
            return;
        }

        const endpoint = `https://fcm.googleapis.com/v1/projects/${client.projectId}/messages:send`;
        const staleTokenIds: string[] = [];

        await Promise.all(
            tokens.map(async (row) => {
                try {
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            message: {
                                token: row.fcm_token,
                                data,
                                android: { priority: 'HIGH' },
                            },
                        }),
                    });

                    if (res.ok) return;

                    const body = await res.json().catch(() => null);
                    if (isInvalidTokenError(res.status, body)) {
                        staleTokenIds.push(row.id);
                    } else {
                        console.error(`FCM: send failed (status=${res.status}):`, body);
                    }
                } catch (sendError) {
                    console.error('FCM: send request failed:', sendError);
                }
            })
        );

        if (staleTokenIds.length > 0) {
            const { error: deleteError } = await supabase
                .from('device_tokens')
                .delete()
                .in('id', staleTokenIds);
            if (deleteError) {
                console.error('FCM: failed to delete stale tokens:', deleteError);
            }
        }
    } catch (error) {
        // fire-and-forget: どんな失敗もここで握りつぶす
        console.error('FCM: sendAlarmPushToUser failed:', error);
    }
}
