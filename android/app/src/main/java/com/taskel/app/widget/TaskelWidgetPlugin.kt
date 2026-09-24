package com.taskel.app.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Web(WebView) から呼ばれるローカル Capacitor プラグイン。
 *
 * 責務: Web が計算した「今 / 次」スナップショット（src/lib/tasks/widgetPayload.ts）を
 * 受け取って保存し、配置済みのホーム画面ウィジェットを描き直す。
 * ネイティブは Supabase に直接アクセスしない（TaskelAlarm と同じ方針）。
 */
@CapacitorPlugin(name = "TaskelWidget")
class TaskelWidgetPlugin : Plugin() {

    /** ペイロードはそのまま JSON 文字列で保存する。解釈は描画時（NowNextSnapshot.fromJson）。 */
    @PluginMethod
    fun updateNowNext(call: PluginCall) {
        val data = call.data
        if (!data.has("generatedAt")) {
            call.reject("generatedAt is required")
            return
        }
        WidgetStore.save(context, data)
        NowNextWidgetProvider.refreshAll(context)
        call.resolve(JSObject().put("widgets", NowNextWidgetProvider.instanceCount(context)))
    }

    /** ログアウト時: スナップショットを消して「アプリを開くと同期されます」表示に戻す。 */
    @PluginMethod
    fun clear(call: PluginCall) {
        WidgetStore.clear(context)
        NowNextWidgetProvider.refreshAll(context)
        call.resolve()
    }
}
