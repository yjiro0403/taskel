import { parseISO, isBefore, isSameDay } from 'date-fns';
import type { Routine } from '@/types';

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RoutineSchedule {
    frequency: Routine['frequency'];
    daysOfWeek?: number[];
    interval?: number;
    startDate?: string;
}

/**
 * 次回出現日（YYYY-MM-DD）を、開始日と asOf のうち遅い方以降で求める。
 *
 * 曜日と加減算は UTC 正午の暦日で行う。`new Date('YYYY-MM-DD')` や
 * `toISOString().slice(0, 10)` は UTC の日付になり、JST の 0:00–8:59 に
 * 曜日が前日へずれる。
 *
 * DB の next_run は作成・更新時のスナップショットで、出現のたびに進まない。
 * 一覧に出す Next は保存値ではなくこの関数の結果を使う。
 */
export function computeNextRun(routine: RoutineSchedule, asOf: string): string {
    const today = CIVIL_DATE_RE.test(asOf) ? asOf : '1970-01-01';
    const start = routine.startDate && CIVIL_DATE_RE.test(routine.startDate)
        ? routine.startDate
        : today;
    const from = start > today ? start : today;

    switch (routine.frequency) {
        case 'weekly':
            return nextWeeklyDate(start, from, routine.daysOfWeek);
        case 'monthly':
            return nextMonthlyDate(start, from);
        case 'custom':
            return nextCustomDate(start, from, routine.interval);
        case 'daily':
        default:
            return from;
    }
}

function civilDateUtc(isoDate: string): Date {
    return new Date(`${isoDate}T12:00:00Z`);
}

function formatCivilDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function addCivilDays(isoDate: string, days: number): string {
    const date = civilDateUtc(isoDate);
    date.setUTCDate(date.getUTCDate() + days);
    return formatCivilDate(date);
}

function civilWeekday(isoDate: string): number {
    return civilDateUtc(isoDate).getUTCDay();
}

function civilDiffDays(earlier: string, later: string): number {
    const ms = civilDateUtc(later).getTime() - civilDateUtc(earlier).getTime();
    return Math.round(ms / 86_400_000);
}

function weekdayTargets(start: string, daysOfWeek: number[] | undefined): number[] {
    const days = (daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (days.length === 0) {
        return [civilWeekday(start)];
    }
    return [...new Set(days)];
}

function nextWeeklyDate(start: string, from: string, daysOfWeek: number[] | undefined): string {
    const targets = weekdayTargets(start, daysOfWeek);
    for (let offset = 0; offset < 7; offset += 1) {
        const candidate = addCivilDays(from, offset);
        if (targets.includes(civilWeekday(candidate))) {
            return candidate;
        }
    }
    return from;
}

function daysInCivilMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextMonthlyDate(start: string, from: string): string {
    const startDay = Number(start.slice(8, 10));
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));

    for (let i = 0; i < 14; i += 1) {
        const day = Math.min(startDay, daysInCivilMonth(year, month));
        const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (candidate >= from && candidate >= start) {
            return candidate;
        }
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }

    return from;
}

function nextCustomDate(start: string, from: string, interval: number | undefined): string {
    if (!interval || interval <= 0) {
        return from;
    }
    const diff = civilDiffDays(start, from);
    if (diff <= 0) {
        return start;
    }
    const remainder = diff % interval;
    if (remainder === 0) {
        return from;
    }
    return addCivilDays(from, interval - remainder);
}

/**
 * 指定日（YYYY-MM-DD）にルーチンが出現するかを判定する純粋関数。
 *
 * getMergedTasks から切り出して単体テスト可能にしたもの。出現判定はここ、
 * 次回日の計算は computeNextRun に集約する。
 */
export function routineOccursOn(routine: Pick<Routine,
    'frequency' | 'daysOfWeek' | 'interval' | 'startDate' | 'nextRun'>, dateStr: string): boolean {
    const targetDate = parseISO(dateStr);
    const startDate = parseISO(routine.startDate || routine.nextRun);

    // 開始日より前は出現しない
    if (isBefore(targetDate, startDate) && !isSameDay(targetDate, startDate)) return false;

    switch (routine.frequency) {
        case 'daily':
            return true;

        case 'weekly':
            if (routine.daysOfWeek && routine.daysOfWeek.length > 0) {
                return routine.daysOfWeek.includes(targetDate.getDay());
            }
            return targetDate.getDay() === startDate.getDay();

        case 'monthly': {
            // 月末繰り上げ: 開始日が31日でも、31日が無い月では月末に発火させる
            const startDay = startDate.getDate();
            const lastDayOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
            const effectiveDay = Math.min(startDay, lastDayOfMonth);
            return targetDate.getDate() === effectiveDay;
        }

        case 'custom': {
            if (!routine.interval || routine.interval <= 0) return false;
            const diffDays = Math.floor(
                (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            return diffDays >= 0 && diffDays % routine.interval === 0;
        }

        default:
            return false;
    }
}
