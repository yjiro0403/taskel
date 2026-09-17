'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
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

/** 通知タイミングの単位。保存は常に分（offsetMinutes）で行う。 */
type OffsetUnit = 'minutes' | 'hours' | 'days';

const UNIT_MULTIPLIER: Record<OffsetUnit, number> = { minutes: 1, hours: 60, days: 1440 };
/** DB 制約（0〜40320 分 = 4 週間）と揃える。 */
const MAX_OFFSET_MINUTES = 40320;
const DEFAULT_OFFSET: { value: number; unit: OffsetUnit } = { value: 30, unit: 'minutes' };

/** 分 → 表示用の値と単位。割り切れる最大の単位を選ぶ（90分は 90分、120分は 2時間）。 */
function toUnitValue(minutes: number): { value: number; unit: OffsetUnit } {
    if (minutes > 0 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
    if (minutes > 0 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
    return { value: minutes, unit: 'minutes' };
}

/** 入力文字列を 0 以上の整数として解釈する。無効なら null。 */
function parseWhole(raw: string): number | null {
    if (!/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
}

function toMinutes(value: number, unit: OffsetUnit): number {
    return value * UNIT_MULTIPLIER[unit];
}

function maxValueFor(unit: OffsetUnit): number {
    return Math.floor(MAX_OFFSET_MINUTES / UNIT_MULTIPLIER[unit]);
}

function toDatetimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

interface OffsetFieldsProps {
    value: string;
    unit: OffsetUnit;
    invalid: boolean;
    onValueChange: (value: string) => void;
    onUnitChange: (unit: OffsetUnit) => void;
    onBlur?: () => void;
    onEnter?: () => void;
}

/** 「[40] [分 ▾] 前」の入力欄。状態は親が持ち、ここは見た目だけを担当する。 */
function OffsetFields({ value, unit, invalid, onValueChange, onUnitChange, onBlur, onEnter }: OffsetFieldsProps) {
    const t = useTranslations('Alarm');

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
        }
    };

    return (
        <div className="flex items-center gap-1.5 min-w-0">
            <input
                type="number"
                inputMode="numeric"
                min={0}
                max={maxValueFor(unit)}
                step={1}
                value={value}
                onChange={(e) => onValueChange(e.target.value)}
                onBlur={onBlur}
                onKeyDown={handleKeyDown}
                aria-label={t('pick_offset_value')}
                aria-invalid={invalid}
                className={clsx(
                    'w-16 px-2 py-1.5 border rounded-lg text-sm text-gray-900 text-right tabular-nums focus:ring-2 outline-none',
                    invalid
                        ? 'border-red-400 focus:ring-red-400 focus:border-red-400'
                        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                )}
            />
            <select
                value={unit}
                onChange={(e) => onUnitChange(e.target.value as OffsetUnit)}
                aria-label={t('pick_offset_unit')}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
                <option value="minutes">{t('unit_minutes')}</option>
                <option value="hours">{t('unit_hours')}</option>
                <option value="days">{t('unit_days')}</option>
            </select>
            <span className="text-sm text-gray-600 flex-shrink-0">{t('offset_before')}</span>
        </div>
    );
}

interface ExistingOffsetEditorProps {
    minutes: number;
    startMillis: number;
    onCommit: (minutes: number) => void;
}

/**
 * 設定済みアラーム 1 件分の編集欄。
 * 入力途中で保存が走らないよう、確定は blur / Enter / 単位変更のタイミングに限る。
 */
function ExistingOffsetEditor({ minutes, startMillis, onCommit }: ExistingOffsetEditorProps) {
    const t = useTranslations('Alarm');
    const initial = toUnitValue(minutes);
    const [value, setValue] = useState(String(initial.value));
    const [unit, setUnit] = useState<OffsetUnit>(initial.unit);

    const [syncedMinutes, setSyncedMinutes] = useState(minutes);
    if (minutes !== syncedMinutes) {
        setSyncedMinutes(minutes);
        const parsed = parseWhole(value);
        if (parsed === null || toMinutes(parsed, unit) !== minutes) {
            const next = toUnitValue(minutes);
            setValue(String(next.value));
            setUnit(next.unit);
        }
    }

    const parsed = parseWhole(value);
    const invalid = parsed === null || parsed > maxValueFor(unit);
    const draftMinutes = parsed !== null && !invalid ? toMinutes(parsed, unit) : null;

    const revert = () => {
        const keepUnit = minutes % UNIT_MULTIPLIER[unit] === 0;
        const next = keepUnit ? { value: minutes / UNIT_MULTIPLIER[unit], unit } : toUnitValue(minutes);
        setValue(String(next.value));
        setUnit(next.unit);
    };

    const commit = () => {
        if (draftMinutes === null) {
            revert();
            return;
        }
        if (draftMinutes !== minutes) onCommit(draftMinutes);
    };

    const changeUnit = (next: OffsetUnit) => {
        setUnit(next);
        const p = parseWhole(value);
        if (p !== null && p <= maxValueFor(next)) {
            const m = toMinutes(p, next);
            if (m !== minutes) onCommit(m);
        }
    };

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <OffsetFields
                    value={value}
                    unit={unit}
                    invalid={invalid}
                    onValueChange={setValue}
                    onUnitChange={changeUnit}
                    onBlur={commit}
                    onEnter={commit}
                />
                <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                    {formatClock(startMillis - (draftMinutes ?? minutes) * 60000)}
                </span>
            </div>
            {invalid && (
                <p className="mt-1 text-[11px] text-red-600">{t('offset_invalid', { max: maxValueFor(unit) })}</p>
            )}
        </div>
    );
}

/**
 * タスク作成/編集モーダル内のアラーム設定。
 *
 * 開始時刻（フォームの date + scheduledStart）があるときは「40分前」のような
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
    const [newValue, setNewValue] = useState(String(DEFAULT_OFFSET.value));
    const [newUnit, setNewUnit] = useState<OffsetUnit>(DEFAULT_OFFSET.unit);
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

    const newParsed = parseWhole(newValue);
    const newInvalid = newParsed === null || newParsed > maxValueFor(newUnit);
    const newMinutes = newParsed !== null && !newInvalid ? toMinutes(newParsed, newUnit) : null;

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
        if (startMillis === null || newMinutes === null || isSubmitting) return;
        await handleCreate(fireAtForOffset(startMillis, newMinutes), newMinutes);
    };

    const handleAddCustom = async () => {
        if (!customFireAt) return;
        const ms = new Date(customFireAt).getTime();
        if (Number.isNaN(ms)) return;
        await handleCreate(ms);
        setCustomFireAt('');
    };

    const handleRelativeCommit = (id: string, minutes: number, start: number) => {
        const fireAt = fireAtForOffset(start, minutes);
        if (persistedTaskId) {
            updateAlarm(id, { fireAt, offsetMinutes: minutes, status: 'scheduled' });
            return;
        }
        onDraftsChange(updateAlarmDraft(drafts, id, { fireAt, offsetMinutes: minutes, status: 'scheduled' }));
    };

    const handleAbsoluteChange = (id: string, value: string) => {
        const ms = new Date(value).getTime();
        if (Number.isNaN(ms)) return;
        if (persistedTaskId) {
            updateAlarm(id, { fireAt: ms, offsetMinutes: null, status: 'scheduled' });
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
                    const relative = start !== null && displayOffset(alarm, start) >= 0;
                    return (
                        <div key={alarm.id} className="flex items-start gap-2">
                            {start !== null && relative ? (
                                <ExistingOffsetEditor
                                    minutes={displayOffset(alarm, start)}
                                    startMillis={start}
                                    onCommit={(minutes) => handleRelativeCommit(alarm.id, minutes, start)}
                                />
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
                    <div>
                        <div className="flex items-center gap-2">
                            <OffsetFields
                                value={newValue}
                                unit={newUnit}
                                invalid={newInvalid}
                                onValueChange={setNewValue}
                                onUnitChange={setNewUnit}
                                onEnter={handleAddRelative}
                            />
                            <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0">
                                {newMinutes !== null ? formatClock(fireAtForOffset(startMillis, newMinutes)) : '--:--'}
                            </span>
                            <button
                                type="button"
                                onClick={handleAddRelative}
                                disabled={newMinutes === null || isSubmitting}
                                className="ml-auto flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            >
                                <Plus size={14} />
                                {t('add')}
                            </button>
                        </div>
                        {newInvalid && (
                            <p className="mt-1 text-[11px] text-red-600">{t('offset_invalid', { max: maxValueFor(newUnit) })}</p>
                        )}
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
