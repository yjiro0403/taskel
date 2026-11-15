import { describe, expect, it } from 'vitest';

import {
    addDays,
    dateOfTimestamp,
    diffDays,
    isCivilDate,
    isIanaTimeZone,
    MCP_RANGE_PRESETS,
    resolveMcpDate,
    resolveMcpRange,
    timeInTimeZone,
    todayInTimeZone,
    weekdayOf,
} from './dates';

describe('todayInTimeZone', () => {
    it('is the calendar date of the token time zone, not of UTC', () => {
        const now = new Date('2026-11-14T15:30:00Z');
        expect(todayInTimeZone('Asia/Tokyo', now)).toBe('2026-11-15');
        expect(todayInTimeZone('UTC', now)).toBe('2026-11-14');
        expect(todayInTimeZone('America/Los_Angeles', now)).toBe('2026-11-14');
    });

    it('changes at local midnight', () => {
        expect(todayInTimeZone('Asia/Tokyo', new Date('2026-11-14T14:59:59Z'))).toBe('2026-11-14');
        expect(todayInTimeZone('Asia/Tokyo', new Date('2026-11-14T15:00:00Z'))).toBe('2026-11-15');
    });

    it('gives the local wall-clock time', () => {
        expect(timeInTimeZone('Asia/Tokyo', new Date('2026-11-14T15:30:00Z'))).toBe('00:30');
        expect(timeInTimeZone('Asia/Tokyo', new Date('2026-11-14T18:05:00Z'))).toBe('03:05');
        expect(timeInTimeZone('UTC', new Date('2026-11-14T23:59:00Z'))).toBe('23:59');
    });

    it('reads the local date of a stored timestamp', () => {
        expect(dateOfTimestamp('2026-11-04T16:00:00+00:00', 'Asia/Tokyo')).toBe('2026-11-05');
        expect(dateOfTimestamp('2026-11-04T16:00:00+00:00', 'UTC')).toBe('2026-11-04');
        expect(dateOfTimestamp(null, 'Asia/Tokyo')).toBeNull();
        expect(dateOfTimestamp('not a time', 'Asia/Tokyo')).toBeNull();
    });
});

describe('isCivilDate / isIanaTimeZone', () => {
    it.each(['2026-11-15', '2024-02-29', '2026-12-31', '0001-01-01'])('accepts %s', (value) => {
        expect(isCivilDate(value)).toBe(true);
    });

    it.each([
        '2026-02-30',
        '2025-02-29',
        '2026-13-01',
        '2026-00-10',
        '2026-11-00',
        '2026-11-31',
        '2026-1-5',
        '2026/11/15',
        '20261115',
        '2026-11-15T00:00:00Z',
        ' 2026-11-15',
        'today',
        '',
        null,
        undefined,
        20261115,
    ])('refuses %s', (value) => {
        expect(isCivilDate(value)).toBe(false);
    });

    it('knows IANA zone names', () => {
        expect(isIanaTimeZone('Asia/Tokyo')).toBe(true);
        expect(isIanaTimeZone('UTC')).toBe(true);
        expect(isIanaTimeZone('Mars/Olympus')).toBe(false);
        expect(isIanaTimeZone('')).toBe(false);
        expect(isIanaTimeZone('x'.repeat(65))).toBe(false);
        expect(isIanaTimeZone(9)).toBe(false);
    });
});

describe('date arithmetic', () => {
    it('adds days across months, years and leap days', () => {
        expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
        expect(addDays('2026-11-15', 731)).toBe('2028-11-15');
    });

    it('counts whole days', () => {
        expect(diffDays('2026-11-15', '2026-11-15')).toBe(0);
        expect(diffDays('2026-11-15', '2027-11-16')).toBe(366);
        expect(diffDays('2026-11-15', '2026-11-14')).toBe(-1);
    });

    it('names the weekday', () => {
        expect(weekdayOf('2026-11-15')).toBe('Sun');
        expect(weekdayOf('2026-11-16')).toBe('Mon');
        expect(weekdayOf('2027-01-01')).toBe('Fri');
    });
});

describe('resolveMcpDate (strict)', () => {
    const today = '2026-11-15';

    it('defaults to today', () => {
        expect(resolveMcpDate({}, today)).toEqual({ ok: true, date: today });
    });

    it('resolves the day words', () => {
        expect(resolveMcpDate({ day: 'today' }, today)).toEqual({ ok: true, date: '2026-11-15' });
        expect(resolveMcpDate({ day: 'tomorrow' }, today)).toEqual({ ok: true, date: '2026-11-16' });
        expect(resolveMcpDate({ day: 'yesterday' }, today)).toEqual({ ok: true, date: '2026-11-14' });
        expect(resolveMcpDate({ day: 'tomorrow' }, '2026-12-31')).toEqual({ ok: true, date: '2027-01-01' });
    });

    it('accepts a real date as written', () => {
        expect(resolveMcpDate({ date: '2026-02-28' }, today)).toEqual({ ok: true, date: '2026-02-28' });
    });

    // The chat resolver returns today for all of these. A tool must refuse.
    it.each([
        '明日',
        '今日',
        'Tomorrow',
        'next monday',
        'day after tomorrow',
        'next week',
        '来週の月曜',
        'someday',
        '',
        7,
        null,
    ])('refuses the day word %s instead of falling back to today', (day) => {
        expect(resolveMcpDate({ day }, today)).toEqual({ ok: false });
    });

    it.each(['2026-02-30', '2026-13-01', '11/15', 'tomorrow', '', null, 20261115])(
        'refuses the date %s instead of falling back to today',
        (date) => {
            expect(resolveMcpDate({ date }, today)).toEqual({ ok: false });
        }
    );

    it('refuses day and date together', () => {
        expect(resolveMcpDate({ day: 'today', date: today }, today)).toEqual({ ok: false });
    });

    it('refuses a day word outside the allowed list', () => {
        expect(resolveMcpDate({ day: 'yesterday' }, today, ['today', 'tomorrow'])).toEqual({ ok: false });
        expect(resolveMcpDate({ day: 'tomorrow' }, today, ['today', 'tomorrow'])).toEqual({ ok: true, date: '2026-11-16' });
    });

    it('refuses when today itself is not a date', () => {
        expect(resolveMcpDate({}, 'now')).toEqual({ ok: false });
    });
});

describe('resolveMcpRange', () => {
    // 2026-11-15 is a Sunday: the last day of its ISO week.
    const sunday = '2026-11-15';

    it.each([
        ['today', '2026-11-15', '2026-11-15'],
        ['yesterday', '2026-11-14', '2026-11-14'],
        ['this_week', '2026-11-09', '2026-11-15'],
        ['last_week', '2026-11-02', '2026-11-08'],
        ['last_7_days', '2026-11-09', '2026-11-15'],
        ['last_30_days', '2026-10-17', '2026-11-15'],
        ['last_90_days', '2026-08-18', '2026-11-15'],
        ['this_month', '2026-11-01', '2026-11-30'],
        ['last_month', '2026-10-01', '2026-10-31'],
    ])('%s on Sunday 2026-11-15', (preset, from, to) => {
        expect(resolveMcpRange(preset, sunday)).toEqual({ from, to });
    });

    it('covers every preset', () => {
        for (const preset of MCP_RANGE_PRESETS) {
            const range = resolveMcpRange(preset, sunday);
            expect(range).not.toBeNull();
            expect(range!.from <= range!.to).toBe(true);
            expect(isCivilDate(range!.from) && isCivilDate(range!.to)).toBe(true);
        }
    });

    it('starts the week on Monday', () => {
        expect(resolveMcpRange('this_week', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
        expect(resolveMcpRange('last_week', '2026-11-16')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
        expect(resolveMcpRange('this_week', '2026-11-18')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    });

    it('handles a week that crosses the year boundary', () => {
        // 2027-01-01 is a Friday; its ISO week began on Monday 2026-12-28.
        expect(resolveMcpRange('this_week', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
        expect(resolveMcpRange('last_week', '2027-01-01')).toEqual({ from: '2026-12-21', to: '2026-12-27' });
        expect(resolveMcpRange('last_week', '2027-01-04')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    });

    it('handles months at the year boundary and leap February', () => {
        expect(resolveMcpRange('last_month', '2027-01-10')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
        expect(resolveMcpRange('this_month', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
        expect(resolveMcpRange('last_month', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    });

    it.each(['next_week', 'last_year', '先週', 'LAST_WEEK', '', null, 7])('refuses the unknown word %s', (preset) => {
        expect(resolveMcpRange(preset, sunday)).toBeNull();
    });
});
