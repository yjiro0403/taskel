package com.taskel.app.alarm

import android.content.Context

/**
 * 停止 / スヌーズの実処理。全画面 UI（AlarmActivity）と通知のボタン（AlarmReceiver）の両方から呼ぶ。
 * 端末内の記録 → 再予約 → サーバーへ報告 → 鳴っている音と通知を止める、の順。
 */
object AlarmActions {
    private const val DEFAULT_SNOOZE_MINUTES = 5

    fun stop(context: Context, alarm: StoredAlarm) {
        AlarmStore.recordEvent(context, alarm.id, "dismissed")
        AlarmStore.removeAlarm(context, alarm.id)
        AlarmScheduler.cancel(context, alarm.id)
        AlarmReporter.reportAsync(context, alarm.id, "dismiss")
        AlarmFeedback.stopRinging(context, alarm.id)
    }

    fun snooze(context: Context, alarm: StoredAlarm): StoredAlarm {
        val minutes = if (alarm.snoozeMinutes > 0) alarm.snoozeMinutes else DEFAULT_SNOOZE_MINUTES
        val next = alarm.copy(fireAt = System.currentTimeMillis() + minutes * 60_000L)
        AlarmStore.upsertAlarm(context, next)
        AlarmScheduler.schedule(context, next)
        // 新しい fireAt を含めて記録し、Web が PATCH で Supabase の fire_at を更新できるようにする
        AlarmStore.recordEvent(context, alarm.id, "snoozed", next.fireAt)
        AlarmReporter.reportAsync(context, alarm.id, "snooze", next.fireAt)
        AlarmFeedback.stopRinging(context, alarm.id)
        return next
    }
}
