'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { taskStartToMillis } from '@/lib/alarmTime';
import {
    createAlarmDraft,
    fireAtForOffset,
    removeAlarmDraft,
    updateAlarmDraft,
    type AlarmDraft,
} from '@/lib/tasks/alarmDrafts';
import { useStore } from '@/store/useStore';
import { Task } from '@/types';

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
 * 「何分前」の選択肢（分）。Google カレンダーの通知 UI に倣う。
 * 0 = 開始時刻ちょうど。
 */
const OFFSET_PRESETS_MINUTES = [0, 5, 10, 15, 30, 60, 120, 1440];
const DEFAULT_OFFSET_MINUTES = 30;

// epoch ms → <input type="datetime-local"> 用のローカル時刻文字列（YYYY-MM-DDTHH:mm）。
function toDatetimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 開始時刻からの「何分前か」。負値 = 開始より後。 */
function offsetMinutesFrom(startMillis: number, fireAt: number): number {
    return Math.round((startMillis - fireAt) / 60000);
}

function displayOffset(alarm: AlarmDraft, startMillis: number): number {
    return alarm.offsetMinutes ?? offsetMinutesFrom(startMillis, alarm.fireAt);
}

function formatClock(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * タスク作成/編集モーダル内のアラーム設定。
 *
 * 開始時刻（フォームの date + scheduledStart）があるときは「30分前」のような
 * 相対指定を既定とし、offsetMinutes を一次情報として保存する。
 * 編集時は API へ即時保存。新規作成時は親の下書きを更新し、タスク保存後に書き込む。
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
    const [newOffset, setNewOffset] = useState(DEFAULT_OFFSET_MINUTES);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const persistedTaskId = task?.id;
    const isPersisted = Boolean(persistedTaskId);

    useEffect(() => {
        if (!isPersisted) return;
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
                    offsetMinutes: alarm.offsetMinutes,
                }))
                .sort((a, b) => a.fireAt - b.fireAt);
        }
        return [...drafts].sort((a, b) => a.fireAt - b.fireAt);
    }, [persistedTaskId, alarms, drafts]);

    const startMillis = useMemo(
        () => taskStartToMillis(date, scheduledStart),
        [date, scheduledStart]
    );

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

    const handleCreate = async (fireAt: number, offsetMinutes?: number) => {
        if (persistedTaskId) {
            setIsSubmitting(true);
            try {
                await addAlarm({ taskId: persistedTaskId, label: title, fireAt, offsetMinutes });
            } finally {
                setIsSubmitting(false);
            }
            return;
        }
        onDraftsChange([...drafts, createAlarmDraft({ fireAt, offsetMinutes })]);
    };

    const handleAddRelative = async () => {
        if (startMillis === null) return;
        await handleCreate(fireAtForOffset(startMillis, newOffset), newOffset);
    };

    const handleAddCustom = async () => {
        if (!customFireAt) return;
        const ms = new Date(customFireAt).getTime();
        if (Number.isNaN(ms)) return;
        await handleCreate(ms);
        setCustomFireAt('');
    };

    const handleRelativeChange = (id: string, next: number, start: number) => {
        const fireAt = fireAtForOffset(start, next);
        if (persistedTaskId) {
            updateAlarm(id, { fireAt, offsetMinutes: next, status: 'scheduled' });
            return;
        }
        onDraftsChange(updateAlarmDraft(drafts, id, { fireAt, offsetMinutes: next, status: 'scheduled' }));
    };

    const handleAbsoluteChange = (id: string, value: string) => {
        const ms = new Date(value).getTime();
        if (Number.isNaN(ms)) return;
        if (persistedTaskId) {
            updateAlarm(id, { fireAt: ms, status: 'scheduled' });
            return;
        }
        onDraftsChange(updateAlarmDraft(drafts, id, { fireAt: ms, status: 'scheduled', offsetMinutes: undefined }));
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

    const optionsFor = (current: number): number[] =>
        OFFSET_PRESETS_MINUTES.includes(current)
            ? OFFSET_PRESETS_MINUTES
            : [...OFFSET_PRESETS_MINUTES, current].sort((a, b) => a - b);

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
                    const start = startMillis;
                    const displayFireAt =
                        alarm.offsetMinutes !== undefined && start !== null
                            ? fireAtForOffset(start, alarm.offsetMinutes)
                            : alarm.fireAt;
                    return (
                        <div key={alarm.id} className="flex items-center gap-2">
                            {start !== null ? (
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                    <select
                                        value={displayOffset(alarm, start)}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            if (Number.isNaN(next)) return;
                                            handleRelativeChange(alarm.id, next, start);
                                        }}
                                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        aria-label={t('pick_offset')}
                                    >
                                        {optionsFor(displayOffset(alarm, start)).map((minutes) => (
                                            <option key={minutes} value={minutes}>
                                                {formatOffset(minutes)}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                                        {formatClock(displayFireAt)}
                                    </span>
                                </div>
                            ) : (
                                <input
                                    type="datetime-local"
                                    value={toDatetimeLocalValue(alarm.fireAt)}
                                    onChange={(e) => handleAbsoluteChange(alarm.id, e.target.value)}
                                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                />
                            )}
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
                            {formatClock(fireAtForOffset(startMillis, newOffset))}
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
