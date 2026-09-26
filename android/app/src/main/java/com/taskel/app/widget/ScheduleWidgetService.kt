package com.taskel.app.widget

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import androidx.core.content.ContextCompat
import com.taskel.app.R
import java.text.DateFormat
import java.util.Date

/**
 * 予定ウィジェットのリスト行を作る RemoteViewsService。
 * ランチャーがリストを描くたびに onDataSetChanged → getViewAt が呼ばれる。
 */
class ScheduleWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        ScheduleRemoteViewsFactory(applicationContext)
}

private class ScheduleRemoteViewsFactory(
    private val context: Context,
) : RemoteViewsService.RemoteViewsFactory {

    private var items: List<ScheduleItem> = emptyList()
    private var now: Long = 0L

    override fun onCreate() {
        reload()
    }

    /** notifyAppWidgetViewDataChanged のたびに呼ばれる。描画時点の now で行を決め直す。 */
    override fun onDataSetChanged() {
        reload()
    }

    private fun reload() {
        now = System.currentTimeMillis()
        items = WidgetStore.load(context)?.scheduleAt(now) ?: emptyList()
    }

    override fun onDestroy() {
        items = emptyList()
    }

    override fun getCount(): Int = items.size

    override fun getViewAt(position: Int): RemoteViews {
        val item = items[position]
        val row = RemoteViews(context.packageName, R.layout.widget_schedule_item)

        val text = ContextCompat.getColor(context, R.color.widget_text)
        val muted = ContextCompat.getColor(context, R.color.widget_text_muted)
        val accent = ContextCompat.getColor(context, R.color.widget_accent)
        val warn = ContextCompat.getColor(context, R.color.widget_warn)

        row.setTextViewText(R.id.row_time, "${formatTime(item.startAt)} – ${formatTime(item.endAt)}")
        row.setTextViewText(R.id.row_title, item.title)

        when {
            item.isRunning -> {
                // 実行中: 青で強調し「実行中」バッジ
                row.setTextColor(R.id.row_time, accent)
                row.setTextColor(R.id.row_title, accent)
                row.setViewVisibility(R.id.row_badge, View.VISIBLE)
                row.setTextViewText(R.id.row_badge, context.getString(R.string.widget_schedule_running))
                row.setTextColor(R.id.row_badge, accent)
            }
            item.startAt <= now -> {
                // 開始時刻を過ぎたが未着手: 琥珀色で「今すぐ」
                row.setTextColor(R.id.row_time, warn)
                row.setTextColor(R.id.row_title, text)
                row.setViewVisibility(R.id.row_badge, View.VISIBLE)
                row.setTextViewText(R.id.row_badge, context.getString(R.string.widget_due_now))
                row.setTextColor(R.id.row_badge, warn)
            }
            else -> {
                row.setTextColor(R.id.row_time, muted)
                row.setTextColor(R.id.row_title, text)
                row.setViewVisibility(R.id.row_badge, View.GONE)
            }
        }

        // 行タップ: Provider のテンプレートに edit_task + taskId を足して MainActivity を開く
        val fillIn = Intent().apply {
            putExtra(TaskelWidgetPlugin.EXTRA_ACTION, TaskelWidgetPlugin.ACTION_EDIT_TASK)
            putExtra(TaskelWidgetPlugin.EXTRA_TASK_ID, item.id)
        }
        row.setOnClickFillInIntent(R.id.schedule_row, fillIn)
        return row
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long =
        items.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()

    override fun hasStableIds(): Boolean = true

    private fun formatTime(epochMs: Long): String =
        DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(epochMs))
}
