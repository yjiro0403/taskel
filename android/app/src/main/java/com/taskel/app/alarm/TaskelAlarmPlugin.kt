package com.taskel.app.alarm

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Web(WebView) から呼ばれるローカル Capacitor プラグイン。
 *
 * 責務: Web が Supabase から取得したアラーム全件を受け取り、端末の
 * AlarmManager へリコンサイルする。ネイティブは Supabase に直接アクセスしない。
 *
 * 権限まわり（Android 12-14 の差分）:
 * - POST_NOTIFICATIONS: API 33+ のみ実行時権限。full-screen intent 通知に必要。
 * - SCHEDULE_EXACT_ALARM: API 31-32 では自動付与（設定から剥奪可能）。
 *   API 34+ では target 33+ のアプリにはデフォルト非付与だが、本アプリは
 *   USE_EXACT_ALARM（API 33+、目覚まし用途向け・自動付与・剥奪不可）を宣言して
 *   いるため対象外。SCHEDULE_EXACT_ALARM は maxSdkVersion=32 で併宣言。
 * - 電池最適化除外: setAlarmClock 自体は Doze 耐性があるため必須ではないが、
 *   メーカー独自の kill 対策として除外をリクエストできるようにしている。
 */
@CapacitorPlugin(
    name = "TaskelAlarm",
    permissions = [
        Permission(
            alias = TaskelAlarmPlugin.NOTIFICATIONS_ALIAS,
            strings = [Manifest.permission.POST_NOTIFICATIONS],
        ),
    ],
)
class TaskelAlarmPlugin : Plugin() {

    @PluginMethod
    fun syncAlarms(call: PluginCall) {
        val alarmsJson = call.getArray("alarms")
        if (alarmsJson == null) {
            call.reject("alarms array is required")
            return
        }

        val alarms = mutableListOf<StoredAlarm>()
        try {
            for (i in 0 until alarmsJson.length()) {
                val entry = alarmsJson.getJSONObject(i)
                val id = entry.getString("id")
                if (id.isNullOrBlank()) continue
                alarms.add(
                    StoredAlarm(
                        id = id,
                        fireAt = entry.getLong("fireAt"),
                        label = entry.optString("label", ""),
                        snoozeMinutes = entry.optInt("snoozeMinutes", 5),
                    )
                )
            }
        } catch (e: Exception) {
            call.reject("Invalid alarms payload: ${e.message}")
            return
        }

        val scheduled = AlarmScheduler.reconcile(context, alarms)
        call.resolve(
            JSObject()
                .put("received", alarms.size)
                .put("scheduled", scheduled)
        )
    }

    /**
     * FCM 登録トークンと端末名を返す（Web が /api/device-tokens へ登録するため）。
     * google-services.json 未配置で FirebaseApp が初期化されていない場合は
     * クラッシュせず token: null を返す（起動時同期のみで動作する Phase B 挙動）。
     */
    @PluginMethod
    fun getFcmToken(call: PluginCall) {
        val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()
        val resolveWith = { token: String? ->
            call.resolve(
                JSObject()
                    .put("token", token)
                    .put("deviceName", deviceName)
            )
        }

        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        task.result?.let { AlarmStore.saveFcmToken(context, it) }
                        resolveWith(task.result)
                    } else {
                        // 取得失敗時は onNewToken で保存済みのものがあればフォールバック
                        resolveWith(AlarmStore.loadFcmToken(context))
                    }
                }
        } catch (e: Exception) {
            // IllegalStateException（FirebaseApp 未初期化）など。Firebase 未設定でも動作継続。
            android.util.Log.i("TaskelAlarmPlugin", "FCM unavailable: ${e.message}")
            resolveWith(null)
        }
    }

    /**
     * ネイティブで蓄積した停止/スヌーズ等の操作イベントを返して消去する。
     * Web はこれを Supabase へ書き戻す（dismissed → status 更新、snoozed → fireAt 更新）。
     */
    @PluginMethod
    fun drainEvents(call: PluginCall) {
        // JSONArray → JSArray へは文字列経由で変換する（JSArray.from は Java 配列専用のため）
        val events = runCatching {
            com.getcapacitor.JSArray(AlarmStore.drainEvents(context).toString())
        }.getOrElse { com.getcapacitor.JSArray() }
        call.resolve(JSObject().put("events", events))
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        call.resolve(buildPermissionStatus())
    }

    /**
     * 不足している権限を1ステップずつ解消する。
     * 1. POST_NOTIFICATIONS が未許可 → 実行時権限ダイアログ
     * 2. exact alarm が不可（API 31-32 で剥奪時のみ）→ 専用設定画面へ
     * 3. 電池最適化の対象 → 除外リクエストダイアログへ
     * 設定画面から戻った後の最新状態は Web 側が checkPermissions で再取得する。
     */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState(NOTIFICATIONS_ALIAS) != com.getcapacitor.PermissionState.GRANTED
        ) {
            requestPermissionForAlias(NOTIFICATIONS_ALIAS, call, "notificationsPermissionCallback")
            return
        }
        launchNextSettingsIfNeeded()
        call.resolve(buildPermissionStatus())
    }

    @PermissionCallback
    @Suppress("unused")
    private fun notificationsPermissionCallback(call: PluginCall) {
        launchNextSettingsIfNeeded()
        call.resolve(buildPermissionStatus())
    }

    private fun launchNextSettingsIfNeeded() {
        val ctx = context
        if (!AlarmScheduler.canScheduleExactAlarms(ctx) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching {
                activity.startActivity(
                    Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))
                )
            }
            return
        }
        if (!isIgnoringBatteryOptimizations()) {
            runCatching {
                activity.startActivity(
                    // サイドロード個人利用前提のため、直接除外を要求するダイアログを使う
                    @Suppress("BatteryLife")
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:${ctx.packageName}"),
                    )
                )
            }
        }
    }

    private fun buildPermissionStatus(): JSObject {
        val notifications = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            "granted"
        } else {
            when (getPermissionState(NOTIFICATIONS_ALIAS)) {
                com.getcapacitor.PermissionState.GRANTED -> "granted"
                com.getcapacitor.PermissionState.DENIED -> "denied"
                else -> "prompt"
            }
        }
        return JSObject()
            .put("notifications", notifications)
            .put("exactAlarm", AlarmScheduler.canScheduleExactAlarms(context))
            .put("batteryOptimizationExempt", isIgnoringBatteryOptimizations())
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    companion object {
        const val NOTIFICATIONS_ALIAS = "notifications"
    }
}
