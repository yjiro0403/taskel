package com.taskel.app.alarm

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * AlarmManager からの発火を受け、full-screen intent 付き通知を出す。
 * 画面ロック中は AlarmActivity が全画面で起動し、使用中はヘッドアップ通知になる。
 * 音とバイブは AlarmActivity 側で再生する（通知音は無効化してある）。
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_FIRE_ALARM) return
        val alarmId = intent.getStringExtra(EXTRA_ALARM_ID) ?: return
        // 発火時点の最新情報は SharedPreferences から引く（スヌーズで更新される可能性がある）
        val alarm = AlarmStore.findAlarm(context, alarmId) ?: run {
            Log.w(TAG, "Fired unknown alarm $alarmId (already removed?)")
            return
        }

        ensureChannel(context)

        val fullScreenIntent = AlarmActivity.createIntent(context, alarm).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val fullScreenPending = PendingIntent.getActivity(
            context,
            alarmId.hashCode(),
            fullScreenIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(alarm.label.ifBlank { "Taskel" })
            .setContentText(
                java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT)
                    .format(java.util.Date(alarm.fireAt))
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setAutoCancel(false)
            // 音・バイブは AlarmActivity がループ再生するため通知側では鳴らさない
            .setSilent(true)
            .setFullScreenIntent(fullScreenPending, true)
            .setContentIntent(fullScreenPending)
            .build()

        val canNotify = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (canNotify) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(alarmId.hashCode(), notification)
        } else {
            // 通知権限が無い場合の最終手段。バックグラウンド起動制限で失敗し得るが試みる。
            Log.w(TAG, "POST_NOTIFICATIONS not granted; trying direct activity start")
            runCatching { context.startActivity(fullScreenIntent) }
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Alarms",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Taskel task alarms"
            setBypassDnd(true)
            enableVibration(false)
            setSound(
                null,
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
            )
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "TaskelAlarmReceiver"
        const val ACTION_FIRE_ALARM = "com.taskel.app.action.FIRE_ALARM"
        const val EXTRA_ALARM_ID = "alarmId"
        const val CHANNEL_ID = "taskel_alarm"
    }
}
