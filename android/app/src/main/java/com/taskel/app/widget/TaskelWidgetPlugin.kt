package com.taskel.app.widget

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * Web(WebView) から呼ばれるローカル Capacitor プラグイン。
 *
 * 責務:
 * - Web が計算したスナップショット（src/lib/tasks/widgetPayload.ts）を受け取って保存し、
 *   配置済みのホーム画面ウィジェット（今 / 次、予定）を描き直す
 * - 予定ウィジェットの「+」/ 行タップで MainActivity が受け取った Intent から
 *   起動アクションを取り出して保存し、Web が consumeLaunchAction() で受け取れるようにする
 * ネイティブは Supabase に直接アクセスしない（TaskelAlarm と同じ方針）。
 */
@CapacitorPlugin(name = "TaskelWidget")
class TaskelWidgetPlugin : Plugin() {

    /** コールドスタート: ウィジェットから起動された場合は Activity の Intent に extra が入っている。 */
    override fun load() {
        captureLaunchAction(activity?.intent)
    }

    /** 起動中（singleTask）: ウィジェットからの Intent は onNewIntent としてここへ届く。 */
    override fun handleOnNewIntent(intent: Intent?) {
        captureLaunchAction(intent)
    }

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
        ScheduleWidgetProvider.refreshAll(context)
        val widgets = NowNextWidgetProvider.instanceCount(context) + ScheduleWidgetProvider.instanceCount(context)
        call.resolve(JSObject().put("widgets", widgets))
    }

    /** ログアウト時: スナップショットを消して「アプリを開くと同期されます」表示に戻す。 */
    @PluginMethod
    fun clear(call: PluginCall) {
        WidgetStore.clear(context)
        NowNextWidgetProvider.refreshAll(context)
        ScheduleWidgetProvider.refreshAll(context)
        call.resolve()
    }

    /** 積まれている起動アクションを 1 回だけ返す（返した時点で消える）。無ければ action: null。 */
    @PluginMethod
    fun consumeLaunchAction(call: PluginCall) {
        val pending = WidgetStore.consumePendingAction(context)
        val result = JSObject()
        if (pending == null) {
            result.put("action", JSONObject.NULL)
        } else {
            result.put("action", pending.optString(KEY_ACTION, ""))
            val taskId = pending.optString(KEY_TASK_ID, "")
            if (taskId.isNotBlank()) result.put("taskId", taskId)
        }
        call.resolve(result)
    }

    /**
     * Intent の extra を起動アクションとして保存し、extra を消す（WebView の再読み込みなどで
     * load() が再度走っても同じ操作を二度扱わないため）。
     */
    private fun captureLaunchAction(intent: Intent?) {
        val action = intent?.getStringExtra(EXTRA_ACTION) ?: return
        val taskId = intent.getStringExtra(EXTRA_TASK_ID)
        intent.removeExtra(EXTRA_ACTION)
        intent.removeExtra(EXTRA_TASK_ID)
        if (action != ACTION_NEW_TASK && action != ACTION_EDIT_TASK) return
        WidgetStore.savePendingAction(
            context,
            JSONObject().put(KEY_ACTION, action).put(KEY_TASK_ID, taskId ?: ""),
        )
    }

    companion object {
        /** ウィジェット → MainActivity の Intent extra。 */
        const val EXTRA_ACTION = "com.taskel.app.extra.WIDGET_ACTION"
        const val EXTRA_TASK_ID = "com.taskel.app.extra.WIDGET_TASK_ID"
        const val ACTION_NEW_TASK = "new_task"
        const val ACTION_EDIT_TASK = "edit_task"

        private const val KEY_ACTION = "action"
        private const val KEY_TASK_ID = "taskId"
    }
}
