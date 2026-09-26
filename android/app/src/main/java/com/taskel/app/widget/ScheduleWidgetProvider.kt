package com.taskel.app.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import com.taskel.app.MainActivity
import com.taskel.app.R
import com.taskel.app.alarm.AlarmScheduler
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * ホーム画面ウィジェット「今日の予定」。
 *
 * Google カレンダーの「スケジュール」ウィジェットに倣い、今日これからの時刻付きタスクを
 * 開始時刻順にスクロールできるリストで見せ、右上の「+」でタスクを追加できる。
 *
 * - データ源は WidgetStore の Web 発スナップショット（schedule）のみ。行の生成は
 *   ScheduleWidgetService（RemoteViewsFactory）が描画時点の now で行う
 * - 「+」と行タップは MainActivity を起動する Intent に extra を載せるだけ。実際に
 *   モーダルを開くのは Web 側（TaskelWidgetPlugin.consumeLaunchAction 経由）
 * - 行の色が変わる開始時刻・行が消える終了時刻には AlarmManager で再描画を 1 件予約する。
 *   保険として updatePeriodMillis（30 分）でも再描画される
 */
class ScheduleWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        render(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            refreshAll(context)
        }
    }

    override fun onEnabled(context: Context) {
        refreshAll(context)
    }

    override fun onDisabled(context: Context) {
        cancelRefresh(context)
    }

    companion object {
        private const val TAG = "TaskelScheduleWidget"
        const val ACTION_REFRESH = "com.taskel.app.action.SCHEDULE_WIDGET_REFRESH"
        private const val REFRESH_REQUEST_CODE = 9003
        private const val ADD_REQUEST_CODE = 9004
        private const val ROW_TEMPLATE_REQUEST_CODE = 9005
        private const val OPEN_APP_REQUEST_CODE = 9006

        /** 切り替え時刻の少し後に予約し、境界ちょうどの再描画で古い状態を描かないようにする。 */
        private const val TRANSITION_SLACK_MS = 1_000L

        fun instanceCount(context: Context): Int = widgetIds(context).size

        /** 配置済みの全ウィジェットを描き直し、リストの行も作り直させる。 */
        fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = widgetIds(context)
            render(context, manager, ids)
            if (ids.isNotEmpty()) {
                manager.notifyAppWidgetViewDataChanged(ids, R.id.schedule_list)
            }
        }

        private fun widgetIds(context: Context): IntArray =
            AppWidgetManager.getInstance(context)
                .getAppWidgetIds(ComponentName(context, ScheduleWidgetProvider::class.java))

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) {
                cancelRefresh(context)
                return
            }
            val now = System.currentTimeMillis()
            val snapshot = WidgetStore.load(context)
            // ランチャーは同じレイアウト ID の更新を既存 View への再適用（reapply）で済ませようとし、
            // コレクション（ListView）を含むこのウィジェットではヘッダーの文言や PendingIntent が
            // 更新されなかった（行は notifyAppWidgetViewDataChanged の別経路で更新される）。
            // 同一内容のレイアウトを描画ごとに交互に使い、毎回完全に再インフレートさせる。
            val layoutId = if (WidgetStore.nextScheduleLayoutGeneration(context) % 2L == 0L) {
                R.layout.widget_schedule_alt
            } else {
                R.layout.widget_schedule
            }
            ids.forEach { id -> manager.updateAppWidget(id, buildViews(context, id, snapshot, now, layoutId)) }
            scheduleRefresh(context, snapshot, now)
            Log.i(TAG, "Rendered ${ids.size} schedule widget(s) (rows=${snapshot?.scheduleAt(now)?.size ?: -1})")
        }

        private fun buildViews(
            context: Context,
            appWidgetId: Int,
            snapshot: NowNextSnapshot?,
            now: Long,
            layoutId: Int,
        ): RemoteViews {
            val views = RemoteViews(context.packageName, layoutId)

            views.setTextViewText(R.id.schedule_date, formatDate(now))
            openAppOperation(context)?.let { views.setOnClickPendingIntent(R.id.schedule_date, it) }

            val remaining = snapshot?.scheduleAt(now) ?: emptyList()
            views.setTextViewText(
                R.id.schedule_count,
                if (snapshot == null) "" else context.getString(R.string.widget_schedule_count, remaining.size),
            )

            // 「+」: MainActivity を new_task の extra 付きで起動する
            views.setOnClickPendingIntent(
                R.id.schedule_add,
                launchOperation(context, ADD_REQUEST_CODE, TaskelWidgetPlugin.ACTION_NEW_TASK),
            )

            // リスト本体。Intent にウィジェット ID を data として埋め、ID ごとに別の factory にする
            val serviceIntent = Intent(context, ScheduleWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.schedule_list, serviceIntent)
            views.setEmptyView(R.id.schedule_list, R.id.schedule_empty)
            views.setTextViewText(
                R.id.schedule_empty,
                context.getString(if (snapshot == null) R.string.widget_not_synced else R.string.widget_schedule_empty),
            )

            // 行タップのテンプレート。行ごとの差分（edit_task + taskId）は factory が fill-in で足す
            val template = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            views.setPendingIntentTemplate(
                R.id.schedule_list,
                PendingIntent.getActivity(
                    context,
                    ROW_TEMPLATE_REQUEST_CODE,
                    template,
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            return views
        }

        /** MainActivity を起動アクション付きで開く PendingIntent（singleTask なので起動中は onNewIntent）。 */
        private fun launchOperation(context: Context, requestCode: Int, action: String): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).apply {
                this.action = Intent.ACTION_MAIN
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(TaskelWidgetPlugin.EXTRA_ACTION, action)
            }
            return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        private fun openAppOperation(context: Context): PendingIntent? {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(
                context,
                OPEN_APP_REQUEST_CODE,
                launch,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        private fun formatDate(epochMs: Long): String =
            SimpleDateFormat(
                datePattern(),
                Locale.getDefault(),
            ).format(Date(epochMs))

        /** 日本語なら「9/26（金）」、それ以外は「Fri, Sep 26」風。 */
        private fun datePattern(): String =
            if (Locale.getDefault().language == "ja") "M/d（E）" else "EEE, MMM d"

        private fun refreshOperation(context: Context): PendingIntent {
            val intent = Intent(context, ScheduleWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            return PendingIntent.getBroadcast(
                context,
                REFRESH_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        /** 行の色替え / 消える時刻に 1 件だけ再描画を予約する（既存の予約は差し替え）。 */
        private fun scheduleRefresh(context: Context, snapshot: NowNextSnapshot?, now: Long) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val operation = refreshOperation(context)
            alarmManager.cancel(operation)

            val transition = snapshot?.nextTransitionAfter(now) ?: return
            val at = transition + TRANSITION_SLACK_MS
            runCatching {
                if (AlarmScheduler.canScheduleExactAlarms(context)) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC, at, operation)
                } else {
                    alarmManager.setAndAllowWhileIdle(AlarmManager.RTC, at, operation)
                }
            }.onFailure { Log.w(TAG, "Failed to schedule widget refresh: ${it.message}") }
        }

        private fun cancelRefresh(context: Context) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarmManager.cancel(refreshOperation(context))
        }
    }
}
