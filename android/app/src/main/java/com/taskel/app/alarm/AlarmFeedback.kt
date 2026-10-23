package com.taskel.app.alarm

import android.app.NotificationManager
import android.content.Context
import android.content.Intent

/**
 * すでに鳴っているアラームを止める。
 * 通知の FLAG_INSISTENT は通知のキャンセルで止まり、全画面の音は AlarmActivity が受け取る。
 */
object AlarmFeedback {
    const val ACTION_STOP = "com.taskel.app.action.STOP_RINGING"

    /** 発火予定がこれより先なら、今は鳴らさない（スヌーズ後の取り違え防止）。 */
    const val RING_GRACE_MS = 15_000L

    fun isCurrentlyDue(fireAt: Long, now: Long = System.currentTimeMillis()): Boolean =
        fireAt <= now + RING_GRACE_MS

    fun stopRinging(context: Context, alarmId: String) {
        runCatching {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(alarmId.hashCode())
        }
        val intent = Intent(ACTION_STOP).setPackage(context.packageName).apply {
            putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarmId)
        }
        context.sendBroadcast(intent)
    }
}
