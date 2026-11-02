package com.taskel.app.alarm

import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * アラーム音の本体。フォアグラウンドサービスとして鳴らす。
 *
 * 以前は通知チャンネルの音（FLAG_INSISTENT）に頼っていたが、それは「通知」なので
 * おやすみモード（マナーモード連動のものを含む）や通知まわりの設定で丸ごと黙らされる。
 * 時計アプリと同じく USAGE_ALARM のストリームへ直接出せば、おやすみモードの既定
 * （アラームは許可）でも鳴り、通知の見え方とも切り離せる。
 *
 * 起動元は AlarmReceiver（setAlarmClock の発火）。正確なアラームからの起動は
 * バックグラウンド FGS 起動制限の免除対象。startForeground が拒否された場合は
 * 予備として通知チャンネルの音にフォールバックする。
 *
 * 停止は AlarmFeedback.ACTION_STOP のブロードキャストで受ける（AlarmActivity と同じ経路）。
 * 鳴り続ける上限は MAX_RING_MS。超えたら音は止めるが通知は残し、停止/スヌーズを待つ。
 */
class AlarmRingService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private val ringing = LinkedHashSet<String>()
    private var receiverRegistered = false

    private val timeout = Runnable {
        Log.i(TAG, "Ring timeout; silencing ${ringing.size} alarm(s) but keeping notifications")
        stopFeedback()
        ringing.clear()
        // 通知は残して停止/スヌーズを受けられるようにする（音だけ止める）
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
        stopSelf()
    }

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != AlarmFeedback.ACTION_STOP) return
            val id = intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID) ?: return
            stopAlarm(id)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val filter = IntentFilter(AlarmFeedback.ACTION_STOP)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(stopReceiver, filter)
        }
        receiverRegistered = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val alarmId = intent?.getStringExtra(AlarmReceiver.EXTRA_ALARM_ID)
        when (intent?.action) {
            ACTION_RING -> if (alarmId != null) startRinging(alarmId)
            ACTION_STOP -> if (alarmId != null) stopAlarm(alarmId)
        }
        if (ringing.isEmpty()) {
            // startForegroundService で起こされたのに鳴らすものが無い場合は即終了する
            // （startForeground を呼ばずに終えるのは許されている）
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startRinging(alarmId: String) {
        val alarm = AlarmStore.findAlarm(this, alarmId)
        if (alarm == null || !AlarmFeedback.isCurrentlyDue(alarm.fireAt)) {
            Log.i(TAG, "Skip ring for $alarmId (removed or rescheduled)")
            return
        }
        AlarmNotifications.ensureChannel(this)

        val wasEmpty = ringing.isEmpty()
        ringing.remove(alarmId)
        ringing.add(alarmId)
        if (!render()) {
            // startForeground を拒否された（免除外のバックグラウンド起動）。予備経路へ。
            ringing.remove(alarmId)
            AlarmNotifications.postLoud(this, alarm)
            return
        }

        acquireWakeLock()
        if (wasEmpty || mediaPlayer == null) {
            startSound()
            startVibration()
        }
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, MAX_RING_MS)
        Log.i(TAG, "Ringing $alarmId via foreground service (label=${alarm.label})")
    }

    private fun stopAlarm(alarmId: String) {
        if (!ringing.remove(alarmId)) return
        AlarmNotifications.cancel(this, alarmId)
        if (ringing.isEmpty()) {
            handler.removeCallbacks(timeout)
            stopFeedback()
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            Log.i(TAG, "Stopped $alarmId; nothing left ringing")
        } else {
            render()
            Log.i(TAG, "Stopped $alarmId; ${ringing.size} still ringing")
        }
    }

    /**
     * 最新のアラームをフォアグラウンド通知に、それ以外は通常の（無音）通知として出す。
     * startForeground の ID を変えると前の通知はシステムが消すので、入れ替わった側は
     * 通常通知として出し直す。
     */
    private fun render(): Boolean {
        val current = ringing.lastOrNull() ?: return true
        val currentAlarm = AlarmStore.findAlarm(this, current) ?: return true
        val notification = AlarmNotifications.build(this, currentAlarm, loud = false)
        val started = runCatching {
            ServiceCompat.startForeground(
                this,
                AlarmNotifications.notificationId(current),
                notification,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                } else {
                    0
                },
            )
        }.onFailure { Log.w(TAG, "startForeground failed: ${it.message}") }.isSuccess
        if (!started) return false

        if (AlarmNotifications.canPostNotifications(this)) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            for (id in ringing) {
                if (id == current) continue
                val alarm = AlarmStore.findAlarm(this, id) ?: continue
                manager.notify(AlarmNotifications.notificationId(id), AlarmNotifications.build(this, alarm, loud = false))
            }
        }
        return true
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "taskel:alarm").apply {
            setReferenceCounted(false)
            acquire(MAX_RING_MS + 10_000L)
        }
    }

    private fun startSound() {
        if (mediaPlayer != null) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ?: android.provider.Settings.System.DEFAULT_ALARM_ALERT_URI
        mediaPlayer = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(this@AlarmRingService, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "Alarm sound failed: ${it.message}") }.getOrNull()
    }

    private fun startVibration() {
        if (vibrator != null) return
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 600)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                @Suppress("DEPRECATION")
                v.vibrate(
                    VibrationEffect.createWaveform(pattern, 0),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
                )
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(pattern, 0)
            }
        }
        vibrator = v
    }

    private fun stopFeedback() {
        mediaPlayer?.runCatching {
            stop()
            release()
        }
        mediaPlayer = null
        vibrator?.cancel()
        vibrator = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        if (receiverRegistered) {
            runCatching { unregisterReceiver(stopReceiver) }
            receiverRegistered = false
        }
        stopFeedback()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "TaskelAlarmRing"
        const val ACTION_RING = "com.taskel.app.action.RING"
        const val ACTION_STOP = "com.taskel.app.action.RING_STOP"

        /** これ以上は鳴らさない（鳴らしっぱなしで電池を使い切らない）。 */
        const val MAX_RING_MS = 10 * 60_000L

        /** 鳴動を開始する。起動自体を拒否された場合は false（呼び出し側が予備経路へ回す）。 */
        fun start(context: Context, alarmId: String): Boolean {
            val intent = Intent(context, AlarmRingService::class.java)
                .setAction(ACTION_RING)
                .putExtra(AlarmReceiver.EXTRA_ALARM_ID, alarmId)
            return runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { Log.w(TAG, "startForegroundService failed: ${it.message}") }
                .isSuccess
        }
    }
}
