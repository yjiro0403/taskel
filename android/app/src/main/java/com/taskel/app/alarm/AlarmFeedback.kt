package com.taskel.app.alarm

import android.content.Context
import android.content.Intent

/**
 * すでに鳴っているアラームを止める。
 * ACTION_STOP のブロードキャストを AlarmRingService（音・フォアグラウンド通知）と
 * AlarmActivity（全画面 UI）が受けて、それぞれ自分を止める。
 * 予備経路（通知チャンネルの音）の場合は、通知のキャンセルで止まる。
 */
object AlarmFeedback {
    const val ACTION_STOP = "com.taskel.app.action.STOP_RINGING"

    /** 発火予定がこれより先なら、今は鳴らさない（スヌーズ後の取り違え防止）。 */
    const val RING_GRACE_MS = 15_000L

    fun isCurrentlyDue(fireAt: Long, now: Long = System.currentTimeMillis()): Boolean =
        fireAt <= now + RING_GRACE_MS

    fun stopRinging(context: Context, alarmId: String) {
        AlarmNotifications.cancel(context, alarmId)
        val intent = Intent(ACTION_STOP).setPackage(context.packageName).apply {
            putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarmId)
        }
        context.sendBroadcast(intent)
    }
}
