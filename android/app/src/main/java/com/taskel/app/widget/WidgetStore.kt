package com.taskel.app.widget

import android.content.Context
import org.json.JSONObject

/**
 * Web から受け取った「今 / 次」スナップショットの永続化（SharedPreferences + JSON 文字列）。
 *
 * ネイティブは Supabase に触れないため、これがウィジェットの唯一のデータ源になる。
 * 描画のたびに読み直し、描画時点の時刻で解釈する（NowNextSnapshot 参照）。
 */
object WidgetStore {
    private const val PREFS_NAME = "taskel_widget"
    private const val KEY_SNAPSHOT = "now_next"
    /** ウィジェットの「+」/ 行タップで積まれた起動アクション。Web が取り出すまで保持する。 */
    private const val KEY_PENDING_ACTION = "pending_action"
    /** 予定ウィジェットの描画に使うレイアウトの世代（偶奇で 2 つのレイアウトを交互に使う）。 */
    private const val KEY_SCHEDULE_LAYOUT_GENERATION = "schedule_layout_generation"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Synchronized
    fun save(context: Context, json: JSONObject) {
        prefs(context).edit().putString(KEY_SNAPSHOT, json.toString()).apply()
    }

    /** 保存が無い、または壊れている場合は null（ウィジェットは「同期待ち」表示になる）。 */
    @Synchronized
    fun load(context: Context): NowNextSnapshot? {
        val raw = prefs(context).getString(KEY_SNAPSHOT, null) ?: return null
        return runCatching { NowNextSnapshot.fromJson(JSONObject(raw)) }.getOrNull()
    }

    @Synchronized
    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_SNAPSHOT).apply()
    }

    /**
     * 予定ウィジェットを描くたびに世代を進めて返す。ScheduleWidgetProvider はこの偶奇で
     * レイアウト ID を切り替え、ランチャーに完全な再インフレートをさせる（reapply では
     * コレクション付きウィジェットのヘッダーや PendingIntent が更新されないため）。
     */
    @Synchronized
    fun nextScheduleLayoutGeneration(context: Context): Long {
        val next = prefs(context).getLong(KEY_SCHEDULE_LAYOUT_GENERATION, 0L) + 1
        prefs(context).edit().putLong(KEY_SCHEDULE_LAYOUT_GENERATION, next).apply()
        return next
    }

    @Synchronized
    fun savePendingAction(context: Context, json: JSONObject) {
        prefs(context).edit().putString(KEY_PENDING_ACTION, json.toString()).apply()
    }

    /** 取り出すと消える（同じ操作でモーダルが二度開かないように）。無ければ null。 */
    @Synchronized
    fun consumePendingAction(context: Context): JSONObject? {
        val raw = prefs(context).getString(KEY_PENDING_ACTION, null) ?: return null
        prefs(context).edit().remove(KEY_PENDING_ACTION).apply()
        return runCatching { JSONObject(raw) }.getOrNull()
    }
}
