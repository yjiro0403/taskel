import { describe, expect, it } from 'vitest';

import {
    assertHalfOpenRange,
    dayRange,
    isoWeekRange,
    isoWeekRangeFromDate,
    monthRange,
    isIsoDate,
    parseIsoDate,
    resolveFinanceOccurrenceDate,
    yearRange,
} from './dateRange';

describe('half-open date ranges', () => {
    it('builds a one-day range as [date, next day)', () => {
        expect(dayRange('2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-01-02' });
        expect(dayRange('2026-12-31')).toEqual({ start: '2026-12-31', end: '2027-01-01' });
    });

    it('uses ISO weeks starting Monday and crosses the year boundary', () => {
        // 2026-01-01 is Thursday; ISO week 1 starts Monday 2025-12-29.
        expect(isoWeekRange('2026-01-01')).toEqual({ start: '2025-12-29', end: '2026-01-05' });
        expect(isoWeekRange('2025-12-29')).toEqual({ start: '2025-12-29', end: '2026-01-05' });
        expect(isoWeekRange('2025-12-28')).toEqual({ start: '2025-12-22', end: '2025-12-29' });
    });

    it('places late-December dates in ISO week 53 when appropriate', () => {
        // 2026-12-31 is Thursday of the week Mon 2026-12-28 .. Sun 2027-01-03.
        expect(isoWeekRange('2026-12-31')).toEqual({ start: '2026-12-28', end: '2027-01-04' });
        expect(isoWeekRangeFromDate(new Date(2026, 11, 31))).toEqual({
            start: '2026-12-28',
            end: '2027-01-04',
        });
    });

    it('builds calendar month and year ranges', () => {
        expect(monthRange('2026-01-15')).toEqual({ start: '2026-01-01', end: '2026-02-01' });
        expect(monthRange('2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-03-01' });
        expect(yearRange('2026-06-01')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
    });

    it('rejects inverted or equal ranges', () => {
        expect(() => assertHalfOpenRange('2026-01-02', '2026-01-01')).toThrow(/half-open/);
        expect(() => assertHalfOpenRange('2026-01-01', '2026-01-01')).toThrow(/half-open/);
        expect(assertHalfOpenRange('2026-01-01', '2026-01-02')).toEqual({
            start: '2026-01-01',
            end: '2026-01-02',
        });
    });

    it('rejects calendar dates that only match the YYYY-MM-DD shape', () => {
        expect(isIsoDate('2026-02-29')).toBe(false);
        expect(isIsoDate('2026-04-31')).toBe(false);
        expect(() => parseIsoDate('2026-02-31')).toThrow('Invalid ISO date');
        expect(isIsoDate('2028-02-29')).toBe(true);
    });
});

describe('resolveFinanceOccurrenceDate', () => {
    it('uses the task date for dated tasks and assignedDate for daily goals', () => {
        expect(resolveFinanceOccurrenceDate({ activeType: 'task', date: '2026-09-15' })).toBe(
            '2026-09-15'
        );
        expect(
            resolveFinanceOccurrenceDate({
                activeType: 'daily',
                assignedDate: '2026-09-16',
                date: '2026-09-15',
            })
        ).toBe('2026-09-16');
    });

    it('does not invent dates for weekly/monthly/yearly goals or empty task dates', () => {
        expect(resolveFinanceOccurrenceDate({ activeType: 'task', date: '' })).toBeNull();
        expect(resolveFinanceOccurrenceDate({ activeType: 'daily', assignedDate: '' })).toBeNull();
        expect(
            resolveFinanceOccurrenceDate({ activeType: 'weekly', assignedDate: '2026-09-15' })
        ).toBeNull();
        expect(resolveFinanceOccurrenceDate({ activeType: 'monthly', date: '2026-09-15' })).toBeNull();
        expect(resolveFinanceOccurrenceDate({ activeType: 'yearly' })).toBeNull();
    });
});
