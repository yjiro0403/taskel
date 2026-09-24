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
}
