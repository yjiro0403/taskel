'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { taskStartToMillis } from '@/lib/alarmTime';
import { useStore } from '@/store/useStore';
import { Alarm, Task } from '@/types';

interface TaskAlarmSectionProps {
    task: Task;
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

// epoch ms → <input type="datetime-local"> 用のローカル時刻文字列（YYYY-MM-DDTHH:mm）。
// toISOString() は UTC になり JST では日時がずれるため、ローカル成分から組み立てる。
function toDatetimeLocalValue(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 開始時刻からの「何分前か」。負値 = 開始より後。 */
function offsetMinutesFrom(startMillis: number, fireAt: number): number {
    return Math.round((startMillis - fireAt) / 60000);
}

/**
 * 表示に使うオフセット。保存済みの offsetMinutes を優先し、無い場合（この機能の
 * 導入前に作られたアラーム）は fireAt から導出する。
 */
function displayOffset(alarm: Alarm, startMillis: number): number {
    return alarm.offsetMinutes ?? offsetMinutesFrom(startMillis, alarm.fireAt);
}

/** 時刻のみの表示（実際に何時に鳴るかを常に併記するため）。 */
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

    // 保存値が外から変わったとき（別端末の更新など）は下書きを追従させる。
    // ただし下書きが既に同じ分数を表していれば、ユーザーが選んだ単位を崩さない
    // （60 と入力して確定した直後に「1 時間」へ勝手に変わるのを防ぐ）。
    // effect や ref を使わず、React が推奨する「前回の props を state に持つ」形で
    // レンダー中に同期する。
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
        // 単位はなるべく維持し、割り切れないときだけ最適な単位へ落とす
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
 * タスク編集モーダル内のアラーム設定セクション。
 *
 * 開始時刻（date + scheduledStart）があるタスクでは「40分前」「2時間前」のような
 * 相対指定を既定とし、offsetMinutes を一次情報として保存する。タスクの開始時刻を
 * 動かすと DB のトリガーが fireAt を同じ差分だけずらすため、相対関係は維持される。
 * 開始時刻が未設定のタスクでは従来どおり日時を直接指定する（offsetMinutes は null）。
 */
export function TaskAlarmSection({ task }: TaskAlarmSectionProps) {
    const t = useTranslations('Alarm');
    const { alarms, alarmsLoaded, fetchAlarms, addAlarm, updateAlarm, deleteAlarm } = useStore();
    const [customFireAt, setCustomFireAt] = useState('');
    const [newValue, setNewValue] = useState(String(DEFAULT_OFFSET.value));
    const [newUnit, setNewUnit] = useState<OffsetUnit>(DEFAULT_OFFSET.unit);
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

    // Supabase の time は "HH:mm:ss"、input[type=time] は "HH:mm" を返す。
    // ヘルパー側で正規化するので、どちらの表記でも相対指定 UI が出る。
    const startMillis = useMemo(
        () => taskStartToMillis(task.date, task.scheduledStart),
        [task.date, task.scheduledStart]
    );

    const newParsed = parseWhole(newValue);
    const newInvalid = newParsed === null || newParsed > maxValueFor(newUnit);
    const newMinutes = newParsed !== null && !newInvalid ? toMinutes(newParsed, newUnit) : null;

    const handleCreate = async (fireAt: number, offsetMinutes?: number) => {
        setIsSubmitting(true);
        try {
            await addAlarm({ taskId: task.id, label: task.title, fireAt, offsetMinutes });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddRelative = async () => {
        if (startMillis === null || newMinutes === null || isSubmitting) return;
        // offsetMinutes を渡すと、以後タスクの開始時刻変更に追従する
        await handleCreate(startMillis - newMinutes * 60000, newMinutes);
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
                    // ternary 内で narrowing を効かせるためローカルへ束ねる
                    const start = startMillis;
                    // 開始より後に設定された古いアラームは相対表現に収まらないため日時指定へ
                    const relative = start !== null && displayOffset(alarm, start) >= 0;
                    return (
                        <div key={alarm.id} className="flex items-start gap-2">
                            {start !== null && relative ? (
                                <ExistingOffsetEditor
                                    minutes={displayOffset(alarm, start)}
                                    startMillis={start}
                                    onCommit={(minutes) => {
                                        // 時刻変更したアラームは再度 ON（scheduled）へ戻す
                                        updateAlarm(alarm.id, {
                                            fireAt: start - minutes * 60000,
                                            offsetMinutes: minutes,
                                            status: 'scheduled',
                                        });
                                    }}
                                />
                            ) : (
                                <input
                                    type="datetime-local"
                                    value={toDatetimeLocalValue(alarm.fireAt)}
                                    onChange={(e) => {
                                        const ms = new Date(e.target.value).getTime();
                                        if (!Number.isNaN(ms)) {
                                            updateAlarm(alarm.id, { fireAt: ms, offsetMinutes: null, status: 'scheduled' });
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
                                {newMinutes !== null ? formatClock(startMillis - newMinutes * 60000) : '--:--'}
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
