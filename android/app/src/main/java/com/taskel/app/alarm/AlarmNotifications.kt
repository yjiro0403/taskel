package com.taskel.app.alarm

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.taskel.app.R

/**
 * アラーム通知の組み立て。
 *
 * 通常は AlarmRingService が音を出し、通知は無音（全画面インテント + 停止/スヌーズのボタンだけ）。
 * サービスを起動できなかったときの予備として、通知チャンネルの音で鳴らす版も作れる。
 * 通知チャンネルの音は「おやすみモード」や通知の設定次第で黙らされるため、主経路にはしない。
 */
object AlarmNotifications {
    private const val TAG = "TaskelAlarmNotif"

    /** 無音設定で作られてしまった旧チャンネル。起動時に削除する。 */
    private const val LEGACY_CHANNEL_ID = "taskel_alarm"
    const val CHANNEL_ID = "taskel_alarm_v2"

    fun notificationId(alarmId: String): Int = alarmId.hashCode()

    fun canPostNotifications(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun ensureChannel(context: Context) {
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
            // 未許可なら無視される。音は AlarmRingService が USAGE_ALARM で直接出すので、
            // おやすみモード中でも標準の「アラームを許可」設定で鳴る。
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

    /**
     * 鳴動中の通知。
     * @param loud true なら通知チャンネルの音でループ再生する（サービスが使えないときの予備）。
     *   false なら無音にして、音は AlarmRingService に任せる。
     */
    fun build(context: Context, alarm: StoredAlarm, loud: Boolean): Notification {
        val fullScreenPending = PendingIntent.getActivity(
            context,
            alarm.id.hashCode(),
            fullScreenIntent(context, alarm),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(alarm.label.ifBlank { context.getString(R.string.alarm_default_label) })
            .setContentText(
                java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT)
                    .format(java.util.Date(alarm.fireAt))
            )
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setFullScreenIntent(fullScreenPending, true)
            .setContentIntent(fullScreenPending)
            // 全画面が出せない場面（端末操作中・おやすみモード中）でも通知から止められるようにする
            .addAction(0, context.getString(R.string.alarm_snooze), actionPending(context, alarm.id, AlarmReceiver.ACTION_NOTIFICATION_SNOOZE, 1))
            .addAction(0, context.getString(R.string.alarm_stop), actionPending(context, alarm.id, AlarmReceiver.ACTION_NOTIFICATION_STOP, 2))

        if (!loud) {
            builder.setSilent(true)
        }

        val notification = builder.build()
        if (loud) {
            // 停止/スヌーズで通知をキャンセルするまで鳴り続けさせる
            notification.flags = notification.flags or Notification.FLAG_INSISTENT
        }
        return notification
    }

    /** 予備経路: サービスを起動できなかったとき、通知チャンネルの音で鳴らす。 */
    fun postLoud(context: Context, alarm: StoredAlarm) {
        ensureChannel(context)
        if (canPostNotifications(context)) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationId(alarm.id), build(context, alarm, loud = true))
            Log.i(TAG, "Alarm ${alarm.id}: loud notification posted (label=${alarm.label})")
        } else {
            // 通知権限が無い場合の最終手段。バックグラウンド起動制限で失敗し得るが試みる。
            Log.w(TAG, "POST_NOTIFICATIONS not granted; trying direct activity start")
            runCatching { context.startActivity(fullScreenIntent(context, alarm)) }
        }
    }

    fun cancel(context: Context, alarmId: String) {
        runCatching {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(notificationId(alarmId))
        }
    }

    private fun fullScreenIntent(context: Context, alarm: StoredAlarm): Intent =
        AlarmActivity.createIntent(context, alarm).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    private fun actionPending(context: Context, alarmId: String, action: String, slot: Int): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            this.action = action
            data = android.net.Uri.parse("taskel://alarm/$alarmId/$slot")
            putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarmId)
        }
        return PendingIntent.getBroadcast(
            context,
            alarmId.hashCode() * 31 + slot,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
