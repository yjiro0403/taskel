'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { useStore } from '@/store/useStore';
import { Task } from '@/types';
import {
    createAlarmDraft,
    removeAlarmDraft,
    taskStartToMillis,
    toDatetimeLocalValue,
    updateAlarmDraft,
    type AlarmDraft,
} from '@/lib/tasks/alarmDrafts';

interface TaskAlarmSectionProps {
    /** 既存タスク（編集時）。指定時は API へ即時保存する。未指定なら下書きとして親が保持する。 */
    task?: Task | null;
    title: string;
    date: string;
    scheduledStart: string;
    drafts: AlarmDraft[];
    onDraftsChange: (drafts: AlarmDraft[]) => void;
}

/**
 * タスク作成/編集モーダル内のアラーム設定セクション（Phase A: Web + DB）。
 * 編集時は Supabase に即時保存する。新規作成時は親の下書きを更新し、
 * タスク保存後に親が同じ内容を書き込む。
 */
export function TaskAlarmSection({
    task,
    title,
    date,
    scheduledStart,
    drafts,
    onDraftsChange,
}: TaskAlarmSectionProps) {
    const t = useTranslations('Alarm');
    const { alarms, alarmsLoaded, fetchAlarms, addAlarm, updateAlarm, deleteAlarm } = useStore();
    const [customFireAt, setCustomFireAt] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const persistedTaskId = task?.id;
    const isPersisted = Boolean(persistedTaskId);

    useEffect(() => {
        if (!isPersisted) return;
        // モーダルを開くたびに最新化する（他端末での変更を拾う）。
        fetchAlarms();
    }, [isPersisted, fetchAlarms]);

    const visibleAlarms: AlarmDraft[] = useMemo(() => {
        if (persistedTaskId) {
            return alarms
                .filter((alarm) => alarm.taskId === persistedTaskId)
                .map((alarm) => ({
                    id: alarm.id,
                    fireAt: alarm.fireAt,
                    status: alarm.status,
                }))
                .sort((a, b) => a.fireAt - b.fireAt);
        }
        return [...drafts].sort((a, b) => a.fireAt - b.fireAt);
    }, [persistedTaskId, alarms, drafts]);

    const startMillis = useMemo(
        () => taskStartToMillis(date, scheduledStart),
        [date, scheduledStart]
    );

    const hasStartAlarm = useMemo(
        () => startMillis !== null && visibleAlarms.some((alarm) => alarm.fireAt === startMillis),
        [visibleAlarms, startMillis]
    );

    const handleCreate = async (fireAt: number) => {
        if (persistedTaskId) {
            setIsSubmitting(true);
            try {
                await addAlarm({ taskId: persistedTaskId, label: title, fireAt });
            } finally {
                setIsSubmitting(false);
            }
            return;
        }
        onDraftsChange([...drafts, createAlarmDraft(fireAt)]);
    };

    const handleAddCustom = async () => {
        if (!customFireAt) return;
        const ms = new Date(customFireAt).getTime();
        if (Number.isNaN(ms)) return;
        await handleCreate(ms);
        setCustomFireAt('');
    };

    const handleFireAtChange = (id: string, value: string) => {
        const ms = new Date(value).getTime();
        if (Number.isNaN(ms)) return;
        if (persistedTaskId) {
            updateAlarm(id, { fireAt: ms, status: 'scheduled' });
            return;
        }
        onDraftsChange(updateAlarmDraft(drafts, id, { fireAt: ms, status: 'scheduled' }));
    };

    const handleToggle = (id: string, isOn: boolean) => {
        const status = isOn ? 'dismissed' : 'scheduled';
        if (persistedTaskId) {
            updateAlarm(id, { status });
            return;
        }
        onDraftsChange(updateAlarmDraft(drafts, id, { status }));
    };

    const handleDelete = (id: string) => {
        if (persistedTaskId) {
            deleteAlarm(id);
            return;
        }
        onDraftsChange(removeAlarmDraft(drafts, id));
    };

    const showEmpty = visibleAlarms.length === 0 && (isPersisted ? alarmsLoaded : true);

    return (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <AlarmClock size={14} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-600">{t('title')}</span>
                {visibleAlarms.length > 0 && (
                    <span className="text-[10px] text-gray-400">({visibleAlarms.length})</span>
                )}
            </div>

            <div className="p-3 space-y-2">
                {showEmpty && (
                    <p className="text-xs text-gray-400">{t('no_alarms')}</p>
                )}
                {visibleAlarms.map((alarm) => {
                    const isOn = alarm.status === 'scheduled';
                    return (
                        <div key={alarm.id} className="flex items-center gap-2">
                            <input
                                type="datetime-local"
                                value={toDatetimeLocalValue(alarm.fireAt)}
                                onChange={(e) => handleFireAtChange(alarm.id, e.target.value)}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => handleToggle(alarm.id, isOn)}
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
                                onClick={() => handleDelete(alarm.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                                aria-label={t('delete')}
                                title={t('delete')}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    );
                })}

                {startMillis !== null && !hasStartAlarm && (
                    <button
                        type="button"
                        onClick={() => handleCreate(startMillis)}
                        disabled={isSubmitting}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <AlarmClock size={14} />
                        {t('at_start', { time: scheduledStart })}
                    </button>
                )}

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
