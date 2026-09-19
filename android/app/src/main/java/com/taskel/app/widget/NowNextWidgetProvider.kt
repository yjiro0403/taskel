package com.taskel.app.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.taskel.app.R
import com.taskel.app.alarm.AlarmScheduler
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

/**
 * ホーム画面ウィジェット「今 / 次」。
 *
 * データ源は WidgetStore に保存された Web 発のスナップショットのみ（ネイティブは
 * Supabase に触れない）。描画時点の now でスナップショットを解釈するので、アプリを
 * 閉じたままでも次のことは端末側で完結する:
 * - 残り時間 / あと何分 は Chronometer がランチャー側で毎秒カウントする
 * - 「次」の開始時刻が来たら「今すぐ」、時間枠が過ぎたら次の候補へ繰り上げる
 * - 見積もりを超えたら「超過」に切り替える
 * 表示が切り替わる時刻には AlarmManager で自分宛の再描画を 1 件だけ予約する。
 * 保険として updatePeriodMillis（30 分）でも再描画される。
 */
class NowNextWidgetProvider : AppWidgetProvider() {

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

    private class Palette(
        val text: Int,
        val muted: Int,
        val accent: Int,
        val warn: Int,
        val danger: Int,
    )

    companion object {
        private const val TAG = "TaskelWidget"
        const val ACTION_REFRESH = "com.taskel.app.action.WIDGET_REFRESH"
        private const val REFRESH_REQUEST_CODE = 9001
        private const val OPEN_APP_REQUEST_CODE = 9002

        /** Chronometer が 0 を跨いだ直後に描き直せるよう、切り替え時刻の少し後に予約する。 */
        private const val TRANSITION_SLACK_MS = 1_000L

        /** 次の開始までこの範囲なら赤（アプリ内ウィジェットと同じ閾値）。 */
        private const val URGENT_MS = 5 * 60_000L

        /** 次の開始までこの範囲なら琥珀色。 */
        private const val SOON_MS = 15 * 60_000L

        fun instanceCount(context: Context): Int = widgetIds(context).size

        /** 配置済みの全ウィジェットを保存済みスナップショットから描き直す。 */
        fun refreshAll(context: Context) {
            render(context, AppWidgetManager.getInstance(context), widgetIds(context))
        }

        private fun widgetIds(context: Context): IntArray =
            AppWidgetManager.getInstance(context)
                .getAppWidgetIds(ComponentName(context, NowNextWidgetProvider::class.java))

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) {
                cancelRefresh(context)
                return
            }
            val now = System.currentTimeMillis()
            val snapshot = WidgetStore.load(context)
            val views = buildViews(context, snapshot, now)
            ids.forEach { manager.updateAppWidget(it, views) }
            scheduleRefresh(context, snapshot, now)
            Log.i(TAG, "Rendered ${ids.size} widget(s) (hasSnapshot=${snapshot != null})")
        }

        private fun buildViews(context: Context, snapshot: NowNextSnapshot?, now: Long): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_now_next)
            openAppOperation(context)?.let { views.setOnClickPendingIntent(R.id.widget_root, it) }

            val palette = Palette(
                text = ContextCompat.getColor(context, R.color.widget_text),
                muted = ContextCompat.getColor(context, R.color.widget_text_muted),
                accent = ContextCompat.getColor(context, R.color.widget_accent),
                warn = ContextCompat.getColor(context, R.color.widget_warn),
                danger = ContextCompat.getColor(context, R.color.widget_danger),
            )

            if (snapshot == null) {
                // アプリを一度も開いていない / ログアウト済み
                views.setTextViewText(R.id.now_title, context.getString(R.string.widget_not_synced))
                views.setTextColor(R.id.now_title, palette.muted)
                views.setViewVisibility(R.id.now_time_row, View.GONE)
                views.setViewVisibility(R.id.now_concurrent, View.GONE)
                views.setTextViewText(R.id.next_title, context.getString(R.string.widget_nothing_next))
                views.setTextColor(R.id.next_title, palette.muted)
                views.setViewVisibility(R.id.next_time_row, View.GONE)
                views.setViewVisibility(R.id.updated_at, View.GONE)
                return views
            }

            bindCurrent(context, views, snapshot.current, now, palette)
            bindNext(context, views, snapshot, now, palette)

            views.setViewVisibility(R.id.updated_at, View.VISIBLE)
            views.setTextViewText(
                R.id.updated_at,
                context.getString(R.string.widget_updated_at, formatUpdatedAt(snapshot.generatedAt, now)),
            )
            return views
        }

        private fun bindCurrent(
            context: Context,
            views: RemoteViews,
            current: CurrentAction?,
            now: Long,
            palette: Palette,
        ) {
            if (current == null) {
                views.setTextViewText(R.id.now_title, context.getString(R.string.widget_nothing_now))
                views.setTextColor(R.id.now_title, palette.muted)
                views.setViewVisibility(R.id.now_time_row, View.GONE)
                views.setViewVisibility(R.id.now_concurrent, View.GONE)
                return
            }

            views.setTextViewText(R.id.now_title, current.title)
            views.setTextColor(R.id.now_title, palette.text)
            views.setViewVisibility(R.id.now_time_row, View.VISIBLE)

            if (current.concurrentCount > 0) {
                views.setViewVisibility(R.id.now_concurrent, View.VISIBLE)
                views.setTextViewText(
                    R.id.now_concurrent,
                    context.getString(R.string.widget_concurrent, current.concurrentCount),
                )
            } else {
                views.setViewVisibility(R.id.now_concurrent, View.GONE)
            }

            val endAt = current.endAt
            when {
                endAt == null -> {
                    // 見積もりなし: 開始からの経過を数える
                    views.setTextViewText(R.id.now_mode, context.getString(R.string.widget_elapsed))
                    views.setTextColor(R.id.now_mode, palette.text)
                    startChronometer(views, R.id.now_chrono, current.startAt, now, countDown = false)
                    views.setTextColor(R.id.now_chrono, palette.text)
                    views.setViewVisibility(R.id.now_end, View.GONE)
                }
                now >= endAt -> {
                    // 超過: 終了予定からの経過を赤で数える
                    views.setTextViewText(R.id.now_mode, context.getString(R.string.widget_overrun))
                    views.setTextColor(R.id.now_mode, palette.danger)
                    startChronometer(views, R.id.now_chrono, endAt, now, countDown = false)
                    views.setTextColor(R.id.now_chrono, palette.danger)
                    views.setViewVisibility(R.id.now_end, View.VISIBLE)
                    views.setTextViewText(R.id.now_end, context.getString(R.string.widget_ends_at, formatTime(endAt)))
                    views.setTextColor(R.id.now_end, palette.muted)
                }
                else -> {
                    views.setTextViewText(R.id.now_mode, context.getString(R.string.widget_remaining))
                    views.setTextColor(R.id.now_mode, palette.accent)
                    startChronometer(views, R.id.now_chrono, endAt, now, countDown = true)
                    views.setTextColor(R.id.now_chrono, palette.accent)
                    views.setViewVisibility(R.id.now_end, View.VISIBLE)
                    views.setTextViewText(R.id.now_end, context.getString(R.string.widget_ends_at, formatTime(endAt)))
                    views.setTextColor(R.id.now_end, palette.muted)
                }
            }
        }

        private fun bindNext(
            context: Context,
            views: RemoteViews,
            snapshot: NowNextSnapshot,
            now: Long,
            palette: Palette,
        ) {
            val next = snapshot.nextAt(now)
            if (next != null) {
                views.setTextViewText(R.id.next_title, next.title)
                views.setTextColor(R.id.next_title, palette.text)
                views.setViewVisibility(R.id.next_time_row, View.VISIBLE)
                views.setViewVisibility(R.id.next_start, View.VISIBLE)
                views.setTextViewText(
                    R.id.next_start,
                    context.getString(R.string.widget_starts_at, formatTime(next.startAt)),
                )

                val untilMs = next.startAt - now
                val dueNow = untilMs <= 0
                val tone = when {
                    dueNow || untilMs <= URGENT_MS -> palette.danger
                    untilMs <= SOON_MS -> palette.warn
                    else -> palette.text
                }
                views.setTextColor(R.id.next_start, tone)

                if (dueNow) {
                    views.setViewVisibility(R.id.next_mode, View.GONE)
                    views.setViewVisibility(R.id.next_chrono, View.GONE)
                    views.setViewVisibility(R.id.next_due, View.VISIBLE)
                    views.setTextColor(R.id.next_due, palette.danger)
                } else {
                    views.setViewVisibility(R.id.next_due, View.GONE)
                    views.setViewVisibility(R.id.next_mode, View.VISIBLE)
                    views.setTextColor(R.id.next_mode, tone)
                    views.setViewVisibility(R.id.next_chrono, View.VISIBLE)
                    startChronometer(views, R.id.next_chrono, next.startAt, now, countDown = true)
                    views.setTextColor(R.id.next_chrono, tone)
                }
                return
            }

            val queued = snapshot.queued
            if (queued != null) {
                // 時刻付きが残っていない: 一覧順の次のタスク（時刻なし）
                views.setTextViewText(R.id.next_title, queued)
                views.setTextColor(R.id.next_title, palette.text)
                views.setViewVisibility(R.id.next_time_row, View.VISIBLE)
                views.setViewVisibility(R.id.next_start, View.VISIBLE)
                views.setTextViewText(R.id.next_start, context.getString(R.string.widget_no_time))
                views.setTextColor(R.id.next_start, palette.muted)
                views.setViewVisibility(R.id.next_mode, View.GONE)
                views.setViewVisibility(R.id.next_chrono, View.GONE)
                views.setViewVisibility(R.id.next_due, View.GONE)
                return
            }

            views.setTextViewText(R.id.next_title, context.getString(R.string.widget_nothing_next))
            views.setTextColor(R.id.next_title, palette.muted)
            views.setViewVisibility(R.id.next_time_row, View.GONE)
        }

        /**
         * Chronometer の base は elapsedRealtime 基準なので、目標時刻（epoch ms）との差分で
         * 変換する。countDown=true なら目標までの残り、false なら目標からの経過を表示する。
         */
        private fun startChronometer(views: RemoteViews, viewId: Int, targetEpochMs: Long, now: Long, countDown: Boolean) {
            val base = SystemClock.elapsedRealtime() + (targetEpochMs - now)
            views.setChronometerCountDown(viewId, countDown)
            views.setChronometer(viewId, base, null, true)
        }

        private fun formatTime(epochMs: Long): String =
            DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(epochMs))

        /** 同じ日なら時刻のみ、前日以前の古いスナップショットなら日付も付けて古さが分かるようにする。 */
        private fun formatUpdatedAt(generatedAt: Long, now: Long): String =
            if (isSameDay(generatedAt, now)) {
                formatTime(generatedAt)
            } else {
                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(generatedAt))
            }

        private fun isSameDay(a: Long, b: Long): Boolean {
            val ca = Calendar.getInstance().apply { timeInMillis = a }
            val cb = Calendar.getInstance().apply { timeInMillis = b }
            return ca.get(Calendar.YEAR) == cb.get(Calendar.YEAR) &&
                ca.get(Calendar.DAY_OF_YEAR) == cb.get(Calendar.DAY_OF_YEAR)
        }

        /** タップでアプリ本体を開く。 */
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

        private fun refreshOperation(context: Context): PendingIntent {
            val intent = Intent(context, NowNextWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            return PendingIntent.getBroadcast(
                context,
                REFRESH_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        /**
         * 表示が次に切り替わる時刻に 1 件だけ再描画を予約する（既存の予約は差し替え）。
         * 画面を見ていないときに端末を起こす必要はないので RTC（非 WAKEUP）を使う。
         */
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
