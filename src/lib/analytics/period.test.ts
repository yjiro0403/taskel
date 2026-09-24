import { describe, expect, it } from 'vitest';

import { isValidPeriodKey, periodKeyFromDate, rangeForTimeRange, shiftPeriodDate } from './period';

describe('analytics period keys', () => {
    it('formats ISO week keys including year boundaries', () => {
        expect(periodKeyFromDate(new Date(2026, 0, 1), 'week')).toBe('2026-W01');
        expect(periodKeyFromDate(new Date(2025, 11, 29), 'week')).toBe('2026-W01');
        expect(periodKeyFromDate(new Date(2026, 8, 19), 'week')).toBe('2026-W38');
    });

    it('formats month and year keys', () => {
        expect(periodKeyFromDate(new Date(2026, 8, 19), 'month')).toBe('2026-09');
        expect(periodKeyFromDate(new Date(2026, 8, 19), 'year')).toBe('2026');
    });

    it('rejects malformed period keys', () => {
        expect(isValidPeriodKey('week', '2026-W38')).toBe(true);
        expect(isValidPeriodKey('week', '2026-W00')).toBe(false);
        expect(isValidPeriodKey('month', '2026-13')).toBe(false);
        expect(isValidPeriodKey('year', '26')).toBe(false);
    });

    it('returns a half-open ISO week range for week view', () => {
        expect(rangeForTimeRange('week', new Date(2026, 8, 16))).toEqual({
            start: '2026-09-14',
            end: '2026-09-21',
        });
        expect(rangeForTimeRange('all', new Date(2026, 8, 16))).toBeNull();
    });

    it('shifts week/month/year independently', () => {
        expect(periodKeyFromDate(shiftPeriodDate(new Date(2026, 8, 16), 'week', 1), 'week')).toBe('2026-W39');
        expect(periodKeyFromDate(shiftPeriodDate(new Date(2026, 8, 16), 'month', -1), 'month')).toBe('2026-08');
        expect(periodKeyFromDate(shiftPeriodDate(new Date(2026, 8, 16), 'year', 1), 'year')).toBe('2027');
    });
});
