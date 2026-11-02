package com.taskel.app.alarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.taskel.app.R
import java.text.DateFormat
import java.util.Date

/**
 * アラーム発火時の全画面 UI（ネイティブ）。ロック画面上に表示する。
 * 音とバイブは AlarmRingService が出しており、この画面は停止 / スヌーズの操作だけを担当する。
 * - 停止: 端末に記録してサーバーへ報告、音を止めて終了
 * - スヌーズ: snoozeMinutes 後に同じ ID で再登録
 * 別の場所（Web や他の端末）で止められたときは ACTION_STOP を受けて閉じる。
 */
class AlarmActivity : Activity() {
    private var alarmId: String = ""
    private var receiverRegistered = false

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AlarmFeedback.ACTION_STOP) return
            val id = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID) ?: return
            if (id != alarmId) return
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        alarmId = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID) ?: ""
        val alarm = AlarmStore.findAlarm(this, alarmId)
        if (alarm == null || !AlarmFeedback.isCurrentlyDue(alarm.fireAt)) {
            // 別の場所で止めた直後や、スヌーズで未来時刻に差し替わったあとは出さない。
            AlarmNotifications.cancel(this, alarmId)
            finish()
            return
        }
        registerStopReceiver()

        showOverLockScreen()
        setContentView(R.layout.activity_alarm)

        findViewById<android.widget.TextView>(R.id.alarm_time).text =
            DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(alarm.fireAt))
        findViewById<android.widget.TextView>(R.id.alarm_label).text =
            alarm.label.ifBlank { getString(R.string.alarm_default_label) }

        findViewById<android.widget.Button>(R.id.alarm_stop).setOnClickListener {
            AlarmActions.stop(this, alarm)
            finish()
        }
        findViewById<android.widget.Button>(R.id.alarm_snooze).setOnClickListener {
            AlarmActions.snooze(this, alarm)
            finish()
        }
        Log.i(TAG, "AlarmActivity shown for $alarmId")
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

    override fun onDestroy() {
        if (receiverRegistered) {
            runCatching { unregisterReceiver(stopReceiver) }
            receiverRegistered = false
        }
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

        fun createIntent(context: Context, alarm: StoredAlarm): Intent =
            Intent(context, AlarmActivity::class.java).apply {
                putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarm.id)
            }
    }
}
