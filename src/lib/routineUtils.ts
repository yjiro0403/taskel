import { parseISO, isBefore, isSameDay } from 'date-fns';
import type { Routine } from '@/types';

/**
 * 指定日（YYYY-MM-DD）にルーチンが出現するかを判定する純粋関数。
 *
 * getMergedTasks から切り出して単体テスト可能にしたもの。頻度判定のロジックは
 * ここに集約し、UI/ストア側からはこの関数のみを参照する。
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
