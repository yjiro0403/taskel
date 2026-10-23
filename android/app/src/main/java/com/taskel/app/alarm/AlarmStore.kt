package com.taskel.app.alarm

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

/**
 * ネイティブ側のアラーム永続化（SharedPreferences + JSON）。
 *
 * - "alarms": Web から同期された scheduled アラームの全件スナップショット。
 *   再起動後の再登録（BootReceiver）とスヌーズ再計算に使う。
 * - "events": 停止/スヌーズ操作の記録。Phase C で Supabase へ書き戻すまでの置き場。
 *
 * fireAt は UTC epoch ms。AlarmManager も epoch ms を受け取るためタイムゾーン変換は不要。
 */
data class StoredAlarm(
    val id: String,
    val fireAt: Long,
    val label: String,
    val snoozeMinutes: Int,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("fireAt", fireAt)
        .put("label", label)
        .put("snoozeMinutes", snoozeMinutes)

    companion object {
        fun fromJson(json: JSONObject): StoredAlarm = StoredAlarm(
            id = json.getString("id"),
            fireAt = json.getLong("fireAt"),
            label = json.optString("label", ""),
            snoozeMinutes = json.optInt("snoozeMinutes", 5),
        )
    }
}

object AlarmStore {
    private const val PREFS_NAME = "taskel_alarms"
    private const val KEY_ALARMS = "alarms"
    private const val KEY_EVENTS = "events"
    private const val KEY_FCM_TOKEN = "fcm_token"
    private const val KEY_DEVICE_SECRET = "device_secret"
    private const val KEY_API_BASE = "api_base"
    private const val DEFAULT_API_BASE = "https://taskel.vercel.app"
    private const val MAX_EVENTS = 200

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun loadAlarms(context: Context): List<StoredAlarm> {
        val raw = prefs(context).getString(KEY_ALARMS, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { StoredAlarm.fromJson(array.getJSONObject(it)) }
        }.getOrElse { emptyList() }
    }

    @Synchronized
    fun saveAlarms(context: Context, alarms: List<StoredAlarm>) {
        val array = JSONArray()
        alarms.forEach { array.put(it.toJson()) }
        prefs(context).edit().putString(KEY_ALARMS, array.toString()).apply()
    }

    @Synchronized
    fun findAlarm(context: Context, id: String): StoredAlarm? =
        loadAlarms(context).firstOrNull { it.id == id }

    /** 1件を差し替え（スヌーズ時の fireAt 更新）または追加する。 */
    @Synchronized
    fun upsertAlarm(context: Context, alarm: StoredAlarm) {
        val rest = loadAlarms(context).filterNot { it.id == alarm.id }
        saveAlarms(context, rest + alarm)
    }

    @Synchronized
    fun removeAlarm(context: Context, id: String) {
        saveAlarms(context, loadAlarms(context).filterNot { it.id == id })
    }

    /**
     * 停止/スヌーズなどの操作イベントを記録する（Web が drainEvents で回収し Supabase へ書き戻す）。
     * スヌーズの場合は再計算後の fireAt を渡す（Web 側の PATCH に使う）。
     */
    @Synchronized
    fun recordEvent(context: Context, alarmId: String, action: String, fireAt: Long? = null) {
        val p = prefs(context)
        val array = runCatching { JSONArray(p.getString(KEY_EVENTS, "[]")) }.getOrElse { JSONArray() }
        array.put(
            JSONObject()
                .put("alarmId", alarmId)
                .put("action", action)
                .put("at", System.currentTimeMillis())
                .apply { if (fireAt != null) put("fireAt", fireAt) }
        )
        // 無限に肥大しないよう直近 MAX_EVENTS 件のみ保持
        val trimmed = JSONArray()
        val start = maxOf(0, array.length() - MAX_EVENTS)
        for (i in start until array.length()) trimmed.put(array.getJSONObject(i))
        p.edit().putString(KEY_EVENTS, trimmed.toString()).apply()
    }

    /** 蓄積した操作イベントを返して消去する（Web の status 書き戻し用）。 */
    @Synchronized
    fun drainEvents(context: Context): JSONArray {
        val p = prefs(context)
        val array = runCatching { JSONArray(p.getString(KEY_EVENTS, "[]")) }.getOrElse { JSONArray() }
        p.edit().remove(KEY_EVENTS).apply()
        return array
    }

    /** FCM 登録トークンを保存する（onNewToken から。Web が未登録時のフォールバック取得に使う）。 */
    @Synchronized
    fun saveFcmToken(context: Context, token: String) {
        prefs(context).edit().putString(KEY_FCM_TOKEN, token).apply()
    }

    @Synchronized
    fun loadFcmToken(context: Context): String? =
        prefs(context).getString(KEY_FCM_TOKEN, null)

    /** 鳴動報告の認可に使う秘密。端末内だけで生成し、サーバーにはハッシュだけが残る。 */
    @Synchronized
    fun deviceSecret(context: Context): String {
        val existing = prefs(context).getString(KEY_DEVICE_SECRET, null)
        if (!existing.isNullOrBlank()) return existing
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        val secret = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        prefs(context).edit().putString(KEY_DEVICE_SECRET, secret).apply()
        return secret
    }

    @Synchronized
    fun saveApiBase(context: Context, raw: String) {
        val url = raw.trim().trimEnd('/')
        val allowed = url.startsWith("https://") ||
            url.startsWith("http://localhost") ||
            url.startsWith("http://127.0.0.1") ||
            url.startsWith("http://10.0.2.2")
        if (!allowed || url.length > 200) return
        prefs(context).edit().putString(KEY_API_BASE, url).apply()
    }

    @Synchronized
    fun apiBase(context: Context): String =
        prefs(context).getString(KEY_API_BASE, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_API_BASE
}
