import type { AlarmStatus } from '@/types';

export type AlarmDraft = {
    id: string;
    fireAt: number;
    status: AlarmStatus;
    /** タスク開始の何分前か。undefined = 絶対時刻指定。 */
    offsetMinutes?: number;
};

export function createAlarmDraft(input: {
    fireAt: number;
    offsetMinutes?: number;
    id?: string;
}): AlarmDraft {
    return {
        id: input.id ?? crypto.randomUUID(),
        fireAt: input.fireAt,
        status: 'scheduled',
        ...(input.offsetMinutes !== undefined ? { offsetMinutes: input.offsetMinutes } : {}),
    };
}

export function updateAlarmDraft(
    drafts: AlarmDraft[],
    id: string,
    updates: Partial<Pick<AlarmDraft, 'fireAt' | 'status' | 'offsetMinutes'>>
): AlarmDraft[] {
    return drafts.map((draft) => {
        if (draft.id !== id) return draft;
        const next: AlarmDraft = { ...draft, ...updates };
        if ('offsetMinutes' in updates && updates.offsetMinutes === undefined) {
            delete next.offsetMinutes;
        }
        return next;
    });
}

export function removeAlarmDraft(drafts: AlarmDraft[], id: string): AlarmDraft[] {
    return drafts.filter((draft) => draft.id !== id);
}

export function fireAtForOffset(startMillis: number, offsetMinutes: number): number {
    return startMillis - offsetMinutes * 60000;
}

type PersistAlarmDraftsOptions = {
    drafts: AlarmDraft[];
    taskId: string;
    label: string;
    /** 保存時点の開始時刻。相対下書きの fireAt をここで確定する。 */
    startMillis?: number | null;
    addAlarm: (input: {
        taskId: string;
        label?: string;
        fireAt: number;
        offsetMinutes?: number;
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
        if (!draft) break;

        const offset = draft.offsetMinutes;
        const fireAt =
            offset !== undefined && options.startMillis != null
                ? fireAtForOffset(options.startMillis, offset)
                : draft.fireAt;

        const created = await options.addAlarm({
            taskId: options.taskId,
            label,
            fireAt,
            ...(offset !== undefined ? { offsetMinutes: offset } : {}),
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
