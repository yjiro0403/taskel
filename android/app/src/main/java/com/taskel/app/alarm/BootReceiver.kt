package com.taskel.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 端末再起動後、SharedPreferences に保存された全アラームを AlarmManager へ再登録する。
 * （AlarmManager の登録は再起動で消えるため）
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }
        val count = AlarmScheduler.rescheduleAll(context)
        Log.i("TaskelBootReceiver", "Rescheduled $count alarms after boot")

        // ホーム画面ウィジェットの再描画予約（AlarmManager）も再起動で消えるため描き直す
        runCatching { com.taskel.app.widget.NowNextWidgetProvider.refreshAll(context) }
            .onFailure { Log.w("TaskelBootReceiver", "Widget refresh after boot failed: ${it.message}") }
        runCatching { com.taskel.app.widget.ScheduleWidgetProvider.refreshAll(context) }
            .onFailure { Log.w("TaskelBootReceiver", "Schedule widget refresh after boot failed: ${it.message}") }
    }
}
