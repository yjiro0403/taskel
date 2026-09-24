import { getISOWeek, getISOWeekYear } from 'date-fns';

import {
    isoWeekRangeFromDate,
    monthRangeFromDate,
    parseIsoDate,
    yearRangeFromDate,
    type HalfOpenDateRange,
} from '../finance/dateRange';
import type { AnalyticsPeriodType, AnalyticsTimeRange } from './types';

const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const YEAR_KEY_RE = /^(\d{4})$/;

export function periodKeyFromDate(date: Date, periodType: AnalyticsPeriodType): string {
    if (periodType === 'week') {
        const week = String(getISOWeek(date)).padStart(2, '0');
        return `${getISOWeekYear(date)}-W${week}`;
    }
    if (periodType === 'month') {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    return String(date.getFullYear());
}

export function periodKeyFromIsoDate(isoDate: string, periodType: AnalyticsPeriodType): string {
    return periodKeyFromDate(parseIsoDate(isoDate), periodType);
}

export function isValidPeriodKey(periodType: AnalyticsPeriodType, periodKey: string): boolean {
    if (periodType === 'week') {
        const match = WEEK_KEY_RE.exec(periodKey);
        if (!match) return false;
        const week = Number(match[2]);
        return week >= 1 && week <= 53;
    }
    if (periodType === 'month') {
        const match = MONTH_KEY_RE.exec(periodKey);
        if (!match) return false;
        const month = Number(match[2]);
        return month >= 1 && month <= 12;
    }
    return YEAR_KEY_RE.test(periodKey);
}

export function rangeForTimeRange(
    timeRange: AnalyticsTimeRange,
    currentDate: Date
): HalfOpenDateRange | null {
    if (timeRange === 'all') {
        return null;
    }
    if (timeRange === 'week') {
        return isoWeekRangeFromDate(currentDate);
    }
    if (timeRange === 'month') {
        return monthRangeFromDate(currentDate);
    }
    return yearRangeFromDate(currentDate);
}

export function shiftPeriodDate(date: Date, timeRange: AnalyticsPeriodType, delta: number): Date {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    if (timeRange === 'week') {
        next.setDate(next.getDate() + delta * 7);
        return next;
    }
    if (timeRange === 'month') {
        next.setMonth(next.getMonth() + delta);
        return next;
    }
    next.setFullYear(next.getFullYear() + delta);
    return next;
}
