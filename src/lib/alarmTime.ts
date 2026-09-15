/**
 * タスクの開始時刻（date + scheduledStart）を扱うユーティリティ。
 *
 * scheduledStart は入力元によって表記が揺れる:
 * - Supabase の time 型は "HH:mm:ss"（例: "18:30:00"）
 * - input[type=time] は "HH:mm"（例: "18:30"）
 * どちらでも同じ結果になるよう、時刻部分は必ず正規化してから解釈する。
 */

/** "18:30" / "18:30:00" / "8:5" いずれも "18:30" 形式へ揃える。不正なら null。 */
export function normalizeTimeOfDay(value: string): string | null {
    const [rawHours, rawMinutes] = value.split(':');
    if (rawHours === undefined || rawMinutes === undefined) return null;

    const hours = Number(rawHours);
    const minutes = Number(rawMinutes);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * タスクの date (YYYY-MM-DD) + scheduledStart をローカル時刻の epoch ms へ変換する。
 * 解釈できない場合は null（呼び出し側は相対指定 UI を出さない判断に使う）。
 */
export function taskStartToMillis(
    date: string | undefined,
    scheduledStart: string | undefined
): number | null {
    if (!date || !scheduledStart) return null;

    const time = normalizeTimeOfDay(scheduledStart);
    if (!time) return null;

    const ms = new Date(`${date}T${time}:00`).getTime();
    return Number.isNaN(ms) ? null : ms;
}
