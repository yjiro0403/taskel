import { describe, expect, it } from 'vitest';

import { hoursInputToMinutes, minutesToHoursInput, formatDurationMinutes, parseYenInput } from './format';

describe('analytics format helpers', () => {
    it('converts hour inputs to minutes', () => {
        expect(hoursInputToMinutes('60')).toBe(3600);
        expect(hoursInputToMinutes('1.5')).toBe(90);
        expect(hoursInputToMinutes('')).toBeNull();
        expect(hoursInputToMinutes('-1')).toBeNull();
    });

    it('renders minutes as compact hour inputs', () => {
        expect(minutesToHoursInput(3600)).toBe('60');
        expect(minutesToHoursInput(90)).toBe('1.5');
        expect(minutesToHoursInput(undefined)).toBe('');
    });

    it('formats durations in ja and en', () => {
        expect(formatDurationMinutes(125, 'ja')).toBe('2時間5分');
        expect(formatDurationMinutes(125, 'en')).toBe('2h 5m');
        expect(formatDurationMinutes(45, 'ja')).toBe('45分');
    });

    it('parses yen as a non-negative integer', () => {
        expect(parseYenInput('12,000')).toBe(12000);
        expect(parseYenInput('0')).toBe(0);
        expect(parseYenInput('12.5')).toBeNull();
        expect(parseYenInput('-1')).toBeNull();
    });
});
