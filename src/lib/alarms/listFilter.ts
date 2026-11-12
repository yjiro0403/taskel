/**
 * GET /api/alarms で返すアラームの条件（PostgREST の `or` フィルタ文字列）。
 *
 * 時刻を過ぎても停止・スヌーズされなかったアラームは status が scheduled のまま残る
 * （fired へ遷移させる処理は無い）。そのまま返すと一覧が際限なく増え、
 * アプリを開くたびに過去分まで端末へ同期していた。
 *
 * 返すもの:
 * - fire_at が現在以降のもの（状態を問わない）
 * - scheduled のうち、fire_at が STALE_ALARM_GRACE_MS 以内に過ぎたもの
 *   （遅れて届いた端末・スヌーズ直前のものを取りこぼさない）
 * - scheduled のうち、鳴動中（ringing_at あり）のもの。停止バナーに必要
 *
 * 行は消さずに残す。相対指定のアラームはタスクを未来へ動かすと DB トリガーで
 * fire_at が追従するので、その時点で再び一覧に現れて鳴る。
 */
export const STALE_ALARM_GRACE_MS = 24 * 60 * 60 * 1000;

/** ringingColumn: false は ringing_at 列が無い（マイグレーション未適用の）データベース向け。 */
export function alarmListFilter(now: Date, options: { ringingColumn?: boolean } = {}): string {
    const nowIso = now.toISOString();
    const cutoffIso = new Date(now.getTime() - STALE_ALARM_GRACE_MS).toISOString();
    const recentOrRinging =
        options.ringingColumn === false
            ? `fire_at.gte.${cutoffIso}`
            : `or(fire_at.gte.${cutoffIso},ringing_at.not.is.null)`;
    return `fire_at.gte.${nowIso},and(status.eq.scheduled,${recentOrRinging})`;
}
