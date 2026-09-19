package com.taskel.app.widget

import org.json.JSONObject

/** 実行中タスク。endAt が null なら見積もりなし（経過時間のみ表示）。 */
data class CurrentAction(
    val title: String,
    val startAt: Long,
    val endAt: Long?,
    val concurrentCount: Int,
)

/** 今日の未完了の時刻付きタスク。[startAt, endAt) がそのタスクの時間枠。 */
data class UpcomingAction(
    val title: String,
    val startAt: Long,
    val endAt: Long,
)

/**
 * Web（src/lib/tasks/widgetPayload.ts）が送るスナップショット。時刻はすべて epoch ms。
 *
 * upcoming は「今日の未完了の時刻付きタスク」を開始時刻順に持つので、アプリを閉じた
 * ままでも描画時点の now から「次」を決め直せる。current は Web が最後に送った状態
 * （タイマーはアプリ側でしか止まらないので、止まるまで走り続けているのが正しい）。
 */
data class NowNextSnapshot(
    val generatedAt: Long,
    val current: CurrentAction?,
    val upcoming: List<UpcomingAction>,
    val queued: String?,
) {
    /** 描画時点の「次」: 時間枠がまだ終わっていない最初の時刻付きタスク。 */
    fun nextAt(now: Long): UpcomingAction? = upcoming.firstOrNull { it.endAt > now }

    /** 表示が切り替わる次の時刻（ms）。無ければ null。 */
    fun nextTransitionAfter(now: Long): Long? {
        val candidates = mutableListOf<Long>()
        current?.endAt?.let { if (it > now) candidates.add(it) }
        upcoming.forEach {
            if (it.startAt > now) candidates.add(it.startAt)
            if (it.endAt > now) candidates.add(it.endAt)
        }
        return candidates.minOrNull()
    }

    companion object {
        /** 欠けているフィールドは既定値で埋める（Web 側の将来の変更で落ちないように）。 */
        fun fromJson(json: JSONObject): NowNextSnapshot {
            val current = json.optJSONObject("current")?.let {
                CurrentAction(
                    title = it.optString("title", ""),
                    startAt = it.optLong("startAt", 0L),
                    endAt = if (it.isNull("endAt")) null else it.optLong("endAt"),
                    concurrentCount = it.optInt("concurrentCount", 0),
                )
            }

            val upcomingJson = json.optJSONArray("upcoming")
            val upcoming = if (upcomingJson == null) {
                emptyList()
            } else {
                (0 until upcomingJson.length())
                    .mapNotNull { index -> upcomingJson.optJSONObject(index) }
                    .map {
                        UpcomingAction(
                            title = it.optString("title", ""),
                            startAt = it.optLong("startAt", 0L),
                            endAt = it.optLong("endAt", 0L),
                        )
                    }
                    .sortedBy { it.startAt }
            }

            val queued = json.optJSONObject("queued")
                ?.optString("title", "")
                ?.takeIf { it.isNotBlank() }

            return NowNextSnapshot(
                generatedAt = json.optLong("generatedAt", 0L),
                current = current,
                upcoming = upcoming,
                queued = queued,
            )
        }
    }
}
