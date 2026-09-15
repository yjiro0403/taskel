package com.taskel.app.alarm

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * サーバー（Next.js BFF）からの FCM data メッセージで、アラームの差分を端末へ即時適用する。
 *
 * - data-only メッセージ（priority HIGH）のため、アプリがバックグラウンドでも
 *   onMessageReceived が呼ばれる（notification フィールドは使わない設計）。
 * - payload: { type: 'alarm_upsert'|'alarm_delete', id, fireAt(ms文字列), label,
 *   snoozeMinutes, status }（delete は id のみ必須）
 * - status が scheduled 以外の upsert はキャンセル扱い（dismissed / fired への遷移）。
 * - WebView 復帰時には Web 側の全件リコンサイル同期が走り、最終的な整合はそちらで取れる。
 *
 * 注意: google-services.json 未配置のビルドでは FirebaseApp が初期化されず、
 * このサービスは一切起動しない（クラスがコンパイルされるだけで無害）。
 */
class TaskelFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val type = data["type"] ?: return
        val id = data["id"]
        if (id.isNullOrBlank()) {
            Log.w(TAG, "FCM message without alarm id (type=$type)")
            return
        }

        when (type) {
            "alarm_upsert" -> {
                val status = data["status"] ?: "scheduled"
                val fireAt = data["fireAt"]?.toLongOrNull()
                if (status != "scheduled" || fireAt == null) {
                    // scheduled 以外（dismissed / fired）や不正 payload はキャンセル扱い
                    cancelAlarm(id)
                    return
                }
                val alarm = StoredAlarm(
                    id = id,
                    fireAt = fireAt,
                    label = data["label"] ?: "",
                    snoozeMinutes = data["snoozeMinutes"]?.toIntOrNull() ?: 5,
                )
                AlarmStore.upsertAlarm(this, alarm)
                val scheduled = AlarmScheduler.schedule(this, alarm)
                Log.i(TAG, "FCM upsert alarm $id (scheduled=$scheduled)")
            }

            "alarm_delete" -> cancelAlarm(id)

            else -> Log.w(TAG, "Unknown FCM message type: $type")
        }
    }

    private fun cancelAlarm(id: String) {
        AlarmScheduler.cancel(this, id)
        AlarmStore.removeAlarm(this, id)
        Log.i(TAG, "FCM cancel alarm $id")
    }

    /**
     * トークンのローテーション時に呼ばれる。ネイティブは Supabase に触れない方針のため
     * SharedPreferences に保存だけしておき、次回 WebView 起動時に Web 側が
     * getFcmToken() → /api/device-tokens POST で登録し直す。
     */
    override fun onNewToken(token: String) {
        AlarmStore.saveFcmToken(this, token)
        Log.i(TAG, "FCM token rotated (stored for next web sync)")
    }

    companion object {
        private const val TAG = "TaskelFcmService"
    }
}
