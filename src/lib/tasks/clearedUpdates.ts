import type { Task } from '@/types';

/**
 * クリア可能な（DB上 nullable な）タスクフィールドの一覧。
 *
 * updateTaskRow は undefined を「更新しない（省略）」、null を「クリア」として扱う。
 * 週/月ビューの「バックログ/別カテゴリへ移す」操作はフィールドを空にする意図で
 * `{ assignedWeek: undefined }` のように undefined を渡すが、そのままでは省略され
 * クリアが永続化されない。そこで、ここに挙げた nullable フィールドに限り
 * 「明示的な undefined → null」に変換してクリアを成立させる。
 *
 * 注意: NOT NULL 列（title/status/order/estimatedMinutes/actualMinutes）や特殊
 * 変換される timestamp 列（startedAt/completedAt/aiCompletedAt）は含めない。null 化
 * すると NOT NULL 制約違反や不正な日時変換を起こすため。
 * date/sectionId は migration 006 で nullable 化済みのため含める（日次→バックログ
 * 移動で date:undefined を送る操作を永続化するため。データ層でも空文字→null 正規化）。
 */
const CLEARABLE_NULLABLE_KEYS: ReadonlySet<keyof Task> = new Set<keyof Task>([
    'assigneeId',
    'reporterId',
    'sectionId',
    'date',
    'scheduledStart',
    'externalLink',
    'parentGoalId',
    'projectId',
    'milestoneId',
    'routineId',
    'assignedWeek',
    'assignedMonth',
    'assignedYear',
    'assignedDate',
    'score',
    'memo',
    'aiStatus',
    'aiError',
]);

/**
 * updates のうち「明示的に undefined を渡された nullable フィールド」を null に変換し、
 * クリア意図を updateTaskRow に伝えられる形にする。NOT NULL 列は変換しない。
 */
export function withClearedNullables(updates: Partial<Task>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...updates };
    for (const key of Object.keys(normalized) as (keyof Task)[]) {
        if (normalized[key] === undefined && CLEARABLE_NULLABLE_KEYS.has(key)) {
            normalized[key] = null;
        }
    }
    return normalized;
}
