'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { useStore } from '@/store/useStore';
import { Task } from '@/types';

interface TaskAlarmSectionProps {
    task: Task;
}

/**
 * 「何分前」の選択肢（分）。Google カレンダーの通知 UI に倣う。
 * 0 = 開始時刻ちょうど。
 */
const OFFSET_PRESETS_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440];
const DEFAULT_OFFSET_MINUTES = 30;

// epoch ms → <input type="datetime-local"> 用のローカル時刻文字列（YYYY-MM-DDTHH:mm）。
// toISOString() は UTC になり JST では日時がずれるため、ローカル成分から組み立てる。
function toDatetimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// タスクの date (YYYY-MM-DD) + scheduledStart (HH:mm) をローカル時刻の epoch ms に変換する。
function taskStartToMillis(date: string, scheduledStart: string): number | null {
    const parsed = new Date(`${date}T${scheduledStart}:00`);
    const ms = parsed.getTime();
    return Number.isNaN(ms) ? null : ms;
}

/** 開始時刻からの「何分前か」。負値 = 開始より後。 */
function offsetMinutesFrom(startMillis: number, fireAt: number): number {
    return Math.round((startMillis - fireAt) / 60000);
}

/** 時刻のみの表示（実際に何時に鳴るかを常に併記するため）。 */
function formatClock(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * タスク編集モーダル内のアラーム設定セクション。
 *
 * 開始時刻（date + scheduledStart）があるタスクでは「30分前」のような相対表記で
 * 扱う。保存されるのは絶対時刻（fireAt）なので、あとからタスクの開始時刻を
 * 動かした場合、表示上のオフセットはその分ずれて見える（鳴る時刻自体は不変）。
 * 開始時刻が未設定のタスクでは従来どおり日時を直接指定する。
 */
export function TaskAlarmSection({ task }: TaskAlarmSectionProps) {
    const t = useTranslations('Alarm');
    const { alarms, alarmsLoaded, fetchAlarms, addAlarm, updateAlarm, deleteAlarm } = useStore();
    const [customFireAt, setCustomFireAt] = useState('');
    const [newOffset, setNewOffset] = useState(DEFAULT_OFFSET_MINUTES);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        // モーダルを開くたびに最新化する（他端末での変更を拾う）。
        fetchAlarms();
    }, [fetchAlarms]);

    const taskAlarms = useMemo(
        () =>
            alarms
                .filter((alarm) => alarm.taskId === task.id)
                .sort((a, b) => a.fireAt - b.fireAt),
        [alarms, task.id]
    );

    const startMillis = useMemo(() => {
        if (!task.date || !task.scheduledStart) return null;
        return taskStartToMillis(task.date, task.scheduledStart);
    }, [task.date, task.scheduledStart]);

    /** 「30分前」等のラベル。端数（1時間30分前）や開始後にも耐えるようにする。 */
    function formatOffset(minutes: number): string {
        if (minutes === 0) return t('offset_at_start');
        if (minutes < 0) return t('offset_after', { label: formatOffset(-minutes) });
        if (minutes % 1440 === 0) return t('offset_days', { count: minutes / 1440 });
        if (minutes % 60 === 0) return t('offset_hours', { count: minutes / 60 });
        if (minutes > 60) {
            return t('offset_hours_minutes', {
                hours: Math.floor(minutes / 60),
                minutes: minutes % 60,
            });
        }
        return t('offset_minutes', { count: minutes });
    }

    const handleCreate = async (fireAt: number) => {
        setIsSubmitting(true);
        try {
            await addAlarm({ taskId: task.id, label: task.title, fireAt });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddRelative = async () => {
        if (startMillis === null) return;
        await handleCreate(startMillis - newOffset * 60000);
    };

    const handleAddCustom = async () => {
        if (!customFireAt) return;
        const ms = new Date(customFireAt).getTime();
        if (Number.isNaN(ms)) return;
        await handleCreate(ms);
        setCustomFireAt('');
    };

    /** 既存アラームの選択肢。プリセットに無いオフセットは実値を追加して選択状態を保つ。 */
    const optionsFor = (current: number): number[] =>
        OFFSET_PRESETS_MINUTES.includes(current)
            ? OFFSET_PRESETS_MINUTES
            : [...OFFSET_PRESETS_MINUTES, current].sort((a, b) => a - b);

    return (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <AlarmClock size={14} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-600">{t('title')}</span>
                {taskAlarms.length > 0 && (
                    <span className="text-[10px] text-gray-400">({taskAlarms.length})</span>
                )}
            </div>

            <div className="p-3 space-y-2">
                {/* 設定済みアラーム一覧 */}
                {taskAlarms.length === 0 && alarmsLoaded && (
                    <p className="text-xs text-gray-400">{t('no_alarms')}</p>
                )}
                {taskAlarms.map((alarm) => {
                    const isOn = alarm.status === 'scheduled';
                    // ternary 内で narrowing を効かせるためローカルへ束ねる
                    const start = startMillis;
                    return (
                        <div key={alarm.id} className="flex items-center gap-2">
                            {start !== null ? (
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                    <select
                                        value={offsetMinutesFrom(start, alarm.fireAt)}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            if (Number.isNaN(next)) return;
                                            // 時刻変更したアラームは再度 ON（scheduled）へ戻す
                                            updateAlarm(alarm.id, {
                                                fireAt: start - next * 60000,
                                                status: 'scheduled',
                                            });
                                        }}
                                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        aria-label={t('pick_offset')}
                                    >
                                        {optionsFor(offsetMinutesFrom(start, alarm.fireAt)).map((minutes) => (
                                            <option key={minutes} value={minutes}>
                                                {formatOffset(minutes)}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                                        {formatClock(alarm.fireAt)}
                                    </span>
                                </div>
                            ) : (
                                <input
                                    type="datetime-local"
                                    value={toDatetimeLocalValue(alarm.fireAt)}
                                    onChange={(e) => {
                                        const ms = new Date(e.target.value).getTime();
                                        if (!Number.isNaN(ms)) {
                                            updateAlarm(alarm.id, { fireAt: ms, status: 'scheduled' });
                                        }
                                    }}
                                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                />
                            )}
                            <button
                                type="button"
                                onClick={() =>
                                    updateAlarm(alarm.id, { status: isOn ? 'dismissed' : 'scheduled' })
                                }
                                className={clsx(
                                    'px-2.5 py-1.5 text-xs font-semibold rounded-full transition-colors flex-shrink-0',
                                    isOn
                                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                )}
                                aria-label={isOn ? t('turn_off') : t('turn_on')}
                                title={isOn ? t('turn_off') : t('turn_on')}
                            >
                                {isOn ? t('on') : t('off')}
                            </button>
                            <button
                                type="button"
                                onClick={() => deleteAlarm(alarm.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                                aria-label={t('delete')}
                                title={t('delete')}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    );
                })}

                {/* 追加 UI。開始時刻があれば「何分前」、無ければ日時指定にフォールバック */}
                {startMillis !== null ? (
                    <div className="flex items-center gap-2">
                        <select
                            value={newOffset}
                            onChange={(e) => setNewOffset(Number(e.target.value))}
                            className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            aria-label={t('pick_offset')}
                        >
                            {OFFSET_PRESETS_MINUTES.map((minutes) => (
                                <option key={minutes} value={minutes}>
                                    {formatOffset(minutes)}
                                </option>
                            ))}
                        </select>
                        <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                            {formatClock(startMillis - newOffset * 60000)}
                        </span>
                        <button
                            type="button"
                            onClick={handleAddRelative}
                            disabled={isSubmitting}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        >
                            <Plus size={14} />
                            {t('add')}
                        </button>
                    </div>
                ) : (
                    <>
                        <p className="text-[11px] text-gray-400">{t('needs_start_time')}</p>
                        <div className="flex items-center gap-2">
                            <input
                                type="datetime-local"
                                value={customFireAt}
                                onChange={(e) => setCustomFireAt(e.target.value)}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                aria-label={t('pick_time')}
                            />
                            <button
                                type="button"
                                onClick={handleAddCustom}
                                disabled={!customFireAt || isSubmitting}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            >
                                <Plus size={14} />
                                {t('add')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
