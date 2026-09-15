package com.taskel.app.alarm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * AlarmManager からの発火を受け、full-screen intent 付き通知を出す。
 *
 * 音の責務について（重要）:
 * 全画面インテントは「画面がロック中/消灯中」のときしか Activity を起動しない。
 * 端末を操作中はヘッドアップ通知に置き換えられるため、AlarmActivity に音を任せると
 * 「使用中はアラームが完全に無音」になる。よって音源は通知チャンネル側に持たせ、
 * FLAG_INSISTENT でループさせる。AlarmActivity が起動できた場合はそちらが
 * 通知をキャンセルして自前のループ再生へ引き継ぐ（二重再生の回避）。
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
            .setFullScreenIntent(fullScreenPending, true)
            .setContentIntent(fullScreenPending)
            .build()
            .apply {
                // 停止/スヌーズで通知をキャンセルするまで鳴り続けさせる
                flags = flags or Notification.FLAG_INSISTENT
            }

        val canNotify = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (canNotify) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(alarmId.hashCode(), notification)
            Log.i(TAG, "Alarm $alarmId fired: notification posted (label=${alarm.label})")
        } else {
            // 通知権限が無い場合の最終手段。バックグラウンド起動制限で失敗し得るが試みる。
            Log.w(TAG, "POST_NOTIFICATIONS not granted; trying direct activity start")
            runCatching { context.startActivity(fullScreenIntent) }
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // 通知チャンネルは作成後に importance / 音 を変更できない。無音だった旧チャンネルが
        // 残っていると修正が反映されないため、削除して新 ID で作り直す。
        runCatching { manager.deleteNotificationChannel(LEGACY_CHANNEL_ID) }

        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Alarms",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Taskel task alarms"
            // DND 迂回は Notification Policy Access を別途許可されている場合のみ有効。
            // 未許可なら無視されるが、既定の DND は USAGE_ALARM を許可するため実害は小さい。
            setBypassDnd(true)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 800, 600)
            setSound(
                alarmSound,
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
        Log.i(TAG, "Notification channel $CHANNEL_ID created (sound=${alarmSound != null})")
    }

    companion object {
        private const val TAG = "TaskelAlarmReceiver"
        const val ACTION_FIRE_ALARM = "com.taskel.app.action.FIRE_ALARM"
        const val EXTRA_ALARM_ID = "alarmId"

        /** 無音設定で作られてしまった旧チャンネル。起動時に削除する。 */
        private const val LEGACY_CHANNEL_ID = "taskel_alarm"
        const val CHANNEL_ID = "taskel_alarm_v2"
    }
}
