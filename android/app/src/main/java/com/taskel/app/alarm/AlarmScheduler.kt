package com.taskel.app.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * AlarmManager への登録/解除。
 *
 * `setAlarmClock()` を採用した理由:
 * - Doze / App Standby の影響を受けず正確な時刻に発火する（目覚まし用途の正規API）
 * - ステータスバーに時計アイコンが出て、ユーザーが次のアラームを確認できる
 * - Android 12+ では exact alarm 権限（SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM）が
 *   必要。権限が無い場合は SecurityException になるため事前チェックしてスキップする。
 */
object AlarmScheduler {
    private const val TAG = "TaskelAlarmScheduler"

    fun canScheduleExactAlarms(context: Context): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // API 31 未満は権限不要。33+ は USE_EXACT_ALARM 宣言により常に true が返る。
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
    }

    /** 過去時刻・権限なしの場合は登録せず false を返す。 */
    fun schedule(context: Context, alarm: StoredAlarm): Boolean {
        if (alarm.fireAt <= System.currentTimeMillis()) {
            Log.i(TAG, "Skip past alarm ${alarm.id} (fireAt=${alarm.fireAt})")
            return false
        }
        if (!canScheduleExactAlarms(context)) {
            Log.w(TAG, "Exact alarm permission not granted; skip ${alarm.id}")
            return false
        }

        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // 時計アイコンタップ時に開く画面（アプリ本体）
        val showIntent = PendingIntent.getActivity(
            context,
            alarm.id.hashCode(),
            context.packageManager.getLaunchIntentForPackage(context.packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(alarm.fireAt, showIntent),
            fireOperation(context, alarm),
        )
        return true
    }

    fun cancel(context: Context, alarmId: String) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(fireOperation(context, StoredAlarm(alarmId, 0L, "", 0)))
    }

    /**
     * Web からの全件リコンサイル。既存登録を全キャンセルしてから保存・再登録する。
     * 重複IDは後勝ちで1件に正規化。過去時刻は保存はする（イベント履歴用）が登録しない。
     */
    fun reconcile(context: Context, incoming: List<StoredAlarm>): Int {
        AlarmStore.loadAlarms(context).forEach { cancel(context, it.id) }

        val deduped = LinkedHashMap<String, StoredAlarm>()
        incoming.forEach { deduped[it.id] = it }
        val alarms = deduped.values.toList()

        AlarmStore.saveAlarms(context, alarms)
        return alarms.count { schedule(context, it) }
    }

    /** 再起動後などに保存済みアラームを一括再登録する。 */
    fun rescheduleAll(context: Context): Int =
        AlarmStore.loadAlarms(context).count { schedule(context, it) }

    // AlarmReceiver へ飛ばす発火用 PendingIntent。requestCode と data URI に alarm.id を
    // 織り込み、ID ごとに一意な PendingIntent としてキャンセル可能にする。
    private fun fireOperation(context: Context, alarm: StoredAlarm): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_FIRE_ALARM
            data = android.net.Uri.parse("taskel://alarm/${alarm.id}")
            putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarm.id)
        }
        return PendingIntent.getBroadcast(
            context,
            alarm.id.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
