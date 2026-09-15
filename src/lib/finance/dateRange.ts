import { addDays, addMonths, addYears, startOfISOWeek, startOfMonth, startOfYear } from 'date-fns';

import { formatLocalDate } from '../calendarService';
import { ISO_DATE_RE } from './types';

export interface HalfOpenDateRange {
    start: string;
    end: string;
}

export function isIsoDate(value: string | null | undefined): value is string {
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
        return false;
    }

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

export function parseIsoDate(value: string): Date {
    if (!isIsoDate(value)) {
        throw new Error(`Invalid ISO date: ${String(value)}`);
    }
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    return date;
}

export function assertHalfOpenRange(start: string, end: string): HalfOpenDateRange {
    if (!isIsoDate(start) || !isIsoDate(end)) {
        throw new Error(`Invalid half-open date range: [${start}, ${end})`);
    }
    if (start >= end) {
        throw new Error(`Invalid half-open date range: [${start}, ${end})`);
    }
    return { start, end };
}

export function dayRange(isoDate: string): HalfOpenDateRange {
    const date = parseIsoDate(isoDate);
    return {
        start: formatLocalDate(date),
        end: formatLocalDate(addDays(date, 1)),
    };
}

/** ISO week starting Monday. Handles year boundaries (e.g. 2026-01-01 → 2025-12-29). */
export function isoWeekRange(isoDate: string): HalfOpenDateRange {
    return isoWeekRangeFromDate(parseIsoDate(isoDate));
}

export function isoWeekRangeFromDate(date: Date): HalfOpenDateRange {
    const start = startOfISOWeek(date);
    return {
        start: formatLocalDate(start),
        end: formatLocalDate(addDays(start, 7)),
    };
}

export function monthRange(isoDate: string): HalfOpenDateRange {
    return monthRangeFromDate(parseIsoDate(isoDate));
}

export function monthRangeFromDate(date: Date): HalfOpenDateRange {
    const start = startOfMonth(date);
    return {
        start: formatLocalDate(start),
        end: formatLocalDate(addMonths(start, 1)),
    };
}

export function yearRange(isoDate: string): HalfOpenDateRange {
    return yearRangeFromDate(parseIsoDate(isoDate));
}

export function yearRangeFromDate(date: Date): HalfOpenDateRange {
    const start = startOfYear(date);
    return {
        start: formatLocalDate(start),
        end: formatLocalDate(addYears(start, 1)),
    };
}

export type FinanceCapableItemType = 'task' | 'daily';
export type TaskModalItemType = FinanceCapableItemType | 'weekly' | 'monthly' | 'yearly';

/**
 * Exact occurrence date used when saving finance rows with a task modal.
 * Weekly/monthly/yearly goals have no deterministic calendar day — return null
 * rather than inventing one.
 */
export function resolveFinanceOccurrenceDate(input: {
    activeType: TaskModalItemType;
    date?: string | null;
    assignedDate?: string | null;
}): string | null {
    if (input.activeType === 'task') {
        return isIsoDate(input.date) ? input.date : null;
    }
    if (input.activeType === 'daily') {
        return isIsoDate(input.assignedDate) ? input.assignedDate : null;
    }
    return null;
}
