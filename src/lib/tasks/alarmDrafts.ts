import type { AlarmStatus } from '@/types';

export type AlarmDraft = {
    id: string;
    fireAt: number;
    status: AlarmStatus;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// epoch ms → <input type="datetime-local"> 用のローカル時刻文字列（YYYY-MM-DDTHH:mm）。
// toISOString() は UTC になり JST では日時がずれるため、ローカル成分から組み立てる。
export function toDatetimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// タスクの date (YYYY-MM-DD) + scheduledStart (HH:mm) をローカル時刻の epoch ms に変換する。
export function taskStartToMillis(date: string, scheduledStart: string): number | null {
    if (!DATE_RE.test(date) || !TIME_RE.test(scheduledStart)) return null;
    const parsed = new Date(`${date}T${scheduledStart}:00`);
    const ms = parsed.getTime();
    return Number.isNaN(ms) ? null : ms;
}

export function createAlarmDraft(fireAt: number, id: string = crypto.randomUUID()): AlarmDraft {
    return { id, fireAt, status: 'scheduled' };
}

export function updateAlarmDraft(
    drafts: AlarmDraft[],
    id: string,
    updates: Partial<Pick<AlarmDraft, 'fireAt' | 'status'>>
): AlarmDraft[] {
    return drafts.map((draft) => (draft.id === id ? { ...draft, ...updates } : draft));
}

export function removeAlarmDraft(drafts: AlarmDraft[], id: string): AlarmDraft[] {
    return drafts.filter((draft) => draft.id !== id);
}

type PersistAlarmDraftsOptions = {
    drafts: AlarmDraft[];
    taskId: string;
    label: string;
    addAlarm: (input: {
        taskId: string;
        label?: string;
        fireAt: number;
    }) => Promise<{ id: string } | null>;
    updateAlarm: (alarmId: string, updates: { status: AlarmStatus }) => Promise<boolean>;
};

/**
 * 新規作成モーダルの下書きアラームを、保存済みタスクへ順に書き込む。
 * 失敗した時点で打ち切り、未書き込み分を remaining として返す（再試行で二重作成しないため）。
 */
export async function persistAlarmDrafts(
    options: PersistAlarmDraftsOptions
): Promise<{ remaining: AlarmDraft[] }> {
    const remaining = [...options.drafts];
    const label = options.label.trim() || undefined;

    while (remaining.length > 0) {
        const draft = remaining[0];
        const created = await options.addAlarm({
            taskId: options.taskId,
            label,
            fireAt: draft.fireAt,
        });
        if (!created) {
            return { remaining };
        }
        // 作成 API は scheduled 固定。OFF 指定は作成後に更新する。
        // 更新失敗でも行は既にあるので下書きからは外す（再試行で二重作成しない）。
        if (draft.status !== 'scheduled') {
            await options.updateAlarm(created.id, { status: draft.status });
        }
        remaining.shift();
    }

    return { remaining };
}
