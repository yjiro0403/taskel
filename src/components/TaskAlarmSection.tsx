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

/**
 * タスク編集モーダル内のアラーム設定セクション（Phase A: Web + DB）。
 * 設定は Supabase に保存され、後続フェーズで Capacitor アプリが端末の
 * AlarmManager へ同期して鳴らす。
 */
export function TaskAlarmSection({ task }: TaskAlarmSectionProps) {
    const t = useTranslations('Alarm');
    const { alarms, alarmsLoaded, fetchAlarms, addAlarm, updateAlarm, deleteAlarm } = useStore();
    const [customFireAt, setCustomFireAt] = useState('');
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

    const hasStartAlarm = useMemo(
        () => startMillis !== null && taskAlarms.some((alarm) => alarm.fireAt === startMillis),
        [taskAlarms, startMillis]
    );

    const handleCreate = async (fireAt: number) => {
        setIsSubmitting(true);
        try {
            await addAlarm({ taskId: task.id, label: task.title, fireAt });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddCustom = async () => {
        if (!customFireAt) return;
        const ms = new Date(customFireAt).getTime();
        if (Number.isNaN(ms)) return;
        await handleCreate(ms);
        setCustomFireAt('');
    };

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
                    return (
                        <div key={alarm.id} className="flex items-center gap-2">
                            <input
                                type="datetime-local"
                                value={toDatetimeLocalValue(alarm.fireAt)}
                                onChange={(e) => {
                                    const ms = new Date(e.target.value).getTime();
                                    if (!Number.isNaN(ms)) {
                                        // 時刻変更したアラームは再度 ON（scheduled）へ戻す
                                        updateAlarm(alarm.id, { fireAt: ms, status: 'scheduled' });
                                    }
                                }}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
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

                {/* 開始時刻ワンタップ作成（date + scheduledStart 設定時のみ） */}
                {startMillis !== null && !hasStartAlarm && (
                    <button
                        type="button"
                        onClick={() => handleCreate(startMillis)}
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <AlarmClock size={14} />
                        {t('at_start', { time: task.scheduledStart ?? '' })}
                    </button>
                )}

                {/* 任意時刻での追加 */}
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
            </div>
        </div>
    );
}
