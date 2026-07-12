/**
 * Supabase（Postgres）へ書き込む前の値の正規化ヘルパー。
 *
 * アプリ層は「未設定」を空文字 '' で表現する箇所が多い（sectionId:'' / date:'' / startTime:''）が、
 * Postgres の uuid / date / time 列は空文字を受け付けず、1 列でも '' があると
 * `invalid input syntax for type time: ""` のように INSERT/UPDATE 全体が落ちる。
 * 永続化の境界で必ずここを通し、'' → null に寄せる。
 *
 * Supabase へ書き込む全ての経路（data.ts / 各 store slice）はこのモジュールを使うこと。
 * 型別ヘルパーを使わず `?? null` で済ませると、'' が素通りして同じ障害が再発する。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID 列（section_id / project_id 等）向け: 空文字・センチネル（'goal' 等）・非UUIDは null に正規化。
export function toUuidOrNull(value: string | undefined | null): string | null {
    if (!value) return null;
    return UUID_RE.test(value) ? value : null;
}

// DATE 列（date / assigned_date）向け: 空文字は null に正規化（アプリの date:'' = 日付なし）。
export function toDateOrNull(value: string | undefined | null): string | null {
    if (!value) return null;
    return value;
}

// TIME 列（sections.start_time / scheduled_start 等）向け: 空文字は null に正規化。
export function toTimeOrNull(value: string | undefined | null): string | null {
    if (!value) return null;
    return value;
}

// UPDATE 経路用: undefined は「更新しない（キー省略）」を維持しつつ、値がある場合のみ正規化する。
export function uuidUpdate(value: string | undefined | null): string | null | undefined {
    return value === undefined ? undefined : toUuidOrNull(value);
}

export function dateUpdate(value: string | undefined | null): string | null | undefined {
    return value === undefined ? undefined : toDateOrNull(value);
}

// UPDATE 経路用: undefined は「更新しない」、空文字は null（＝クリア）にする。
export function timeUpdate(value: string | undefined | null): string | null | undefined {
    return value === undefined ? undefined : toTimeOrNull(value);
}
