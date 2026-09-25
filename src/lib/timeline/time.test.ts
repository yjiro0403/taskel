import { describe, expect, it } from 'vitest';

import type { Section } from '../../types';
import { computeVisibleRange, floorMinutes, hhmmToMinutes, minutesToHHMM, snapMinutes } from './time';

const morning: Section = {
    id: 's-morning',
    userId: 'u1',
    name: 'Morning',
    startTime: '09:00',
    endTime: '12:00',
    order: 0,
};

const afternoon: Section = {
    id: 's-afternoon',
    userId: 'u1',
    name: 'Afternoon',
    startTime: '13:00',
    endTime: '18:00',
    order: 1,
};

describe('timeline time helpers', () => {
    it('parses and formats HH:mm including 24:00', () => {
        expect(hhmmToMinutes('09:30')).toBe(570);
        expect(hhmmToMinutes('09:30:00')).toBe(570);
        expect(hhmmToMinutes('24:00')).toBe(1440);
        expect(minutesToHHMM(570)).toBe('09:30');
        expect(minutesToHHMM(1440)).toBe('24:00');
    });

    it('snaps to five-minute increments', () => {
        expect(snapMinutes(62)).toBe(60);
        expect(snapMinutes(63)).toBe(65);
    });

    it('hides empty overnight hours when the setting is on', () => {
        expect(computeVisibleRange({
            sections: [morning, afternoon],
            scheduledStarts: [],
            hideEmptyIntervals: true,
        })).toEqual({ startMin: 9 * 60, endMin: 18 * 60 });
    });

    it('extends the range to include scheduled tasks outside sections', () => {
        expect(computeVisibleRange({
            sections: [morning],
            scheduledStarts: [5 * 60],
            hideEmptyIntervals: true,
        }).startMin).toBe(5 * 60);
    });

    it('shows the full day when empty intervals are visible', () => {
        expect(computeVisibleRange({
            sections: [morning],
            scheduledStarts: [],
            hideEmptyIntervals: false,
        })).toEqual({ startMin: 0, endMin: 1440 });
    });
});

describe('floorMinutes', () => {
    it('floors to the create-slot grid', () => {
        expect(floorMinutes(9 * 60 + 14)).toBe(9 * 60);
        expect(floorMinutes(9 * 60 + 15)).toBe(9 * 60 + 15);
        expect(floorMinutes(9 * 60 + 44, 30)).toBe(9 * 60 + 30);
    });
});
