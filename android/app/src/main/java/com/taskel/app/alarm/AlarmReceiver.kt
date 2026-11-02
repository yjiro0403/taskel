package com.taskel.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * AlarmManager からの発火を受けて鳴動を開始し、通知の停止/スヌーズボタンも受ける。
 *
 * 音の責務について（重要）:
 * 音は AlarmRingService（フォアグラウンドサービス）が USAGE_ALARM で直接出す。
 * 通知チャンネルの音に頼ると、おやすみモードや通知設定で黙らされてしまい
 * 「Web には鳴動中と出ているのに端末は無音」になる。サービスが起動できなかった
 * ときだけ、通知チャンネルの音（FLAG_INSISTENT）で鳴らす予備経路へ落ちる。
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra(EXTRA_ALARM_ID) ?: return
        when (intent.action) {
            ACTION_FIRE_ALARM -> fire(context, alarmId)
            ACTION_NOTIFICATION_STOP -> {
                val alarm = AlarmStore.findAlarm(context, alarmId)
                if (alarm != null) AlarmActions.stop(context, alarm) else AlarmFeedback.stopRinging(context, alarmId)
                Log.i(TAG, "Stopped $alarmId from notification action")
            }
            ACTION_NOTIFICATION_SNOOZE -> {
                val alarm = AlarmStore.findAlarm(context, alarmId)
                if (alarm != null) AlarmActions.snooze(context, alarm) else AlarmFeedback.stopRinging(context, alarmId)
                Log.i(TAG, "Snoozed $alarmId from notification action")
            }
        }
    }

    private fun fire(context: Context, alarmId: String) {
        // 発火時点の最新情報は SharedPreferences から引く（スヌーズで更新される可能性がある）
        val alarm = AlarmStore.findAlarm(context, alarmId) ?: run {
            Log.w(TAG, "Fired unknown alarm $alarmId (already removed?)")
            return
        }
        if (!AlarmFeedback.isCurrentlyDue(alarm.fireAt)) {
            Log.i(TAG, "Ignore fire for $alarmId; stored fireAt is still in the future")
            return
        }

        AlarmNotifications.ensureChannel(context)
        if (AlarmRingService.start(context, alarmId)) {
            Log.i(TAG, "Alarm $alarmId fired: ring service started (label=${alarm.label})")
        } else {
            AlarmNotifications.postLoud(context, alarm)
        }
        // 鳴らし始めてから報告する。プロセスはサービスが生かす。
        AlarmReporter.reportAsync(context, alarm.id, "ring")
    }

    companion object {
        private const val TAG = "TaskelAlarmReceiver"
        const val ACTION_FIRE_ALARM = "com.taskel.app.action.FIRE_ALARM"
        const val ACTION_NOTIFICATION_STOP = "com.taskel.app.action.NOTIFICATION_STOP"
        const val ACTION_NOTIFICATION_SNOOZE = "com.taskel.app.action.NOTIFICATION_SNOOZE"
        const val EXTRA_ALARM_ID = "alarmId"

        /** 互換のため残す。チャンネルの実体は AlarmNotifications 側。 */
        const val CHANNEL_ID = AlarmNotifications.CHANNEL_ID
    }
}
