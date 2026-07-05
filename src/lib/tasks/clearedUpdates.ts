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
 * 注意: NOT NULL 列（date/title/sectionId/status/order/estimatedMinutes/
 * actualMinutes）や特殊変換される timestamp 列（startedAt/completedAt/
 * aiCompletedAt）は含めない。これらを null 化すると NOT NULL 制約違反や不正な
 * 日時変換を起こすため。特に tasks.date は PostgreSQL の DATE 型かつ NOT NULL で、
 * 「日付なし」を表現するにはスキーマ側で nullable 化が必要（Phase 2 の課題）。
 */
const CLEARABLE_NULLABLE_KEYS: ReadonlySet<keyof Task> = new Set<keyof Task>([
    'assigneeId',
    'reporterId',
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
