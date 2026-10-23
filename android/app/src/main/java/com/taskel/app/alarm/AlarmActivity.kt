package com.taskel.app.alarm

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.taskel.app.R
import java.text.DateFormat
import java.util.Date

/**
 * アラーム発火時の全画面 UI（ネイティブ）。
 * ロック画面上に表示し、アラーム音（USAGE_ALARM）ループ + バイブで通知する。
 * - 停止: イベント記録して終了（Supabase 書き戻しは Phase C）
 * - スヌーズ: snoozeMinutes 後に同じ ID で再登録
 */
class AlarmActivity : Activity() {
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var alarmId: String = ""
    private var receiverRegistered = false
    private var closing = false

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AlarmFeedback.ACTION_STOP) return
            val id = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID) ?: return
            if (id != alarmId) return
            closing = true
            finishAlarmUi()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        alarmId = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID) ?: ""
        registerStopReceiver()
        val alarm = AlarmStore.findAlarm(this, alarmId)
        if (closing || alarm == null || !AlarmFeedback.isCurrentlyDue(alarm.fireAt)) {
            // 別の場所で止めた直後や、スヌーズで未来時刻に差し替わったあとは鳴らさない。
            cancelFiringNotification()
            finish()
            return
        }

        showOverLockScreen()
        setContentView(R.layout.activity_alarm)

        findViewById<android.widget.TextView>(R.id.alarm_time).text =
            DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(alarm.fireAt))
        findViewById<android.widget.TextView>(R.id.alarm_label).text =
            alarm.label.ifBlank { getString(R.string.alarm_default_label) }

        findViewById<android.widget.Button>(R.id.alarm_stop).setOnClickListener { stopAlarm(alarm) }
        findViewById<android.widget.Button>(R.id.alarm_snooze).setOnClickListener { snoozeAlarm(alarm) }

        // 通知チャンネル側の INSISTENT 音を止めてから自前のループ再生へ引き継ぐ。
        // （全画面が出せない場合は通知が鳴り続けるので、音source は常にどちらか一方）
        cancelFiringNotification()
        startSound()
        startVibration()
        if (closing) {
            stopFeedback()
            return
        }
        Log.i(TAG, "AlarmActivity shown for $alarmId; took over sound from notification")
    }

    private fun registerStopReceiver() {
        val filter = IntentFilter(AlarmFeedback.ACTION_STOP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(stopReceiver, filter)
        }
        receiverRegistered = true
    }

    /** 発火通知を消す（= FLAG_INSISTENT のループ音を停止する）。 */
    private fun cancelFiringNotification() {
        runCatching {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(alarmId.hashCode())
        }
    }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguard.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun startSound() {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: return
        mediaPlayer = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(this@AlarmActivity, uri)
                isLooping = true
                prepare()
                start()
            }
        }.getOrNull()
    }

    private fun startVibration() {
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 600)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(
                VibrationEffect.createWaveform(pattern, 0),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
            )
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(pattern, 0)
        }
    }

    private fun stopAlarm(alarm: StoredAlarm) {
        AlarmStore.recordEvent(this, alarm.id, "dismissed")
        AlarmStore.removeAlarm(this, alarm.id)
        AlarmReporter.reportAsync(this, alarm.id, "dismiss")
        finishAlarmUi()
    }

    private fun snoozeAlarm(alarm: StoredAlarm) {
        val minutes = if (alarm.snoozeMinutes > 0) alarm.snoozeMinutes else DEFAULT_SNOOZE_MINUTES
        val next = alarm.copy(fireAt = System.currentTimeMillis() + minutes * 60_000L)
        AlarmStore.upsertAlarm(this, next)
        AlarmScheduler.schedule(this, next)
        // 新しい fireAt を含めて記録し、Web が PATCH で Supabase の fire_at を更新できるようにする
        AlarmStore.recordEvent(this, alarm.id, "snoozed", next.fireAt)
        AlarmReporter.reportAsync(this, alarm.id, "snooze", next.fireAt)
        finishAlarmUi()
    }

    private fun finishAlarmUi() {
        stopFeedback()
        cancelFiringNotification()
        finish()
    }

    private fun stopFeedback() {
        mediaPlayer?.runCatching {
            stop()
            release()
        }
        mediaPlayer = null
        vibrator?.cancel()
        vibrator = null
    }

    override fun onDestroy() {
        if (receiverRegistered) {
            runCatching { unregisterReceiver(stopReceiver) }
            receiverRegistered = false
        }
        stopFeedback()
        super.onDestroy()
    }

    // 戻るボタンは無効化する。以前は音を止めて閉じられたため、アラームを
    // 「停止」も「スヌーズ」もせずに黙らせることができてしまっていた。
    // 目覚まし用途では明示的な操作を必須にする。
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        Log.i(TAG, "Back pressed on AlarmActivity; ignored (use stop/snooze)")
    }

    companion object {
        private const val TAG = "TaskelAlarmActivity"
        private const val DEFAULT_SNOOZE_MINUTES = 5

        fun createIntent(context: Context, alarm: StoredAlarm): Intent =
            Intent(context, AlarmActivity::class.java).apply {
                putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarm.id)
            }
    }
}
