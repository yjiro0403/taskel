import { describe, it, expect } from 'vitest';

import { routineOccursOn } from './routineUtils';
import type { Routine } from '@/types';

function makeRoutine(partial: Partial<Routine>): Routine {
    return {
        id: 'r1',
        userId: 'u1',
        title: 'test',
        frequency: 'daily',
        startDate: '2026-01-01',
        nextRun: '2026-01-01',
        sectionId: 's1',
        estimatedMinutes: 10,
        active: true,
        ...partial,
    };
}

describe('routineOccursOn', () => {
    describe('開始日ガード', () => {
        it('開始日より前は出現しない', () => {
            const r = makeRoutine({ frequency: 'daily', startDate: '2026-01-10' });
            expect(routineOccursOn(r, '2026-01-09')).toBe(false);
        });
        it('開始日当日は出現する', () => {
            const r = makeRoutine({ frequency: 'daily', startDate: '2026-01-10' });
            expect(routineOccursOn(r, '2026-01-10')).toBe(true);
        });
    });

    describe('daily', () => {
        it('開始日以降は毎日出現する', () => {
            const r = makeRoutine({ frequency: 'daily', startDate: '2026-01-01' });
            expect(routineOccursOn(r, '2026-03-15')).toBe(true);
        });
    });

    describe('weekly', () => {
        it('指定曜日のみ出現する（2026-07-06 は月曜）', () => {
            const r = makeRoutine({ frequency: 'weekly', daysOfWeek: [1], startDate: '2026-01-01' });
            expect(routineOccursOn(r, '2026-07-06')).toBe(true);
            expect(routineOccursOn(r, '2026-07-07')).toBe(false);
        });
        it('daysOfWeek 未指定なら開始日の曜日で判定', () => {
            const r = makeRoutine({ frequency: 'weekly', startDate: '2026-01-01' });
            expect(routineOccursOn(r, '2026-01-08')).toBe(true);
            expect(routineOccursOn(r, '2026-01-09')).toBe(false);
        });
    });

    describe('monthly（月末繰り上げ）', () => {
        it('31日開始でも31日が無い月は月末に出現する', () => {
            const r = makeRoutine({ frequency: 'monthly', startDate: '2026-01-31' });
            expect(routineOccursOn(r, '2026-02-28')).toBe(true);
            expect(routineOccursOn(r, '2026-02-27')).toBe(false);
        });
        it('31日開始で31日がある月は31日に出現する', () => {
            const r = makeRoutine({ frequency: 'monthly', startDate: '2026-01-31' });
            expect(routineOccursOn(r, '2026-03-31')).toBe(true);
            expect(routineOccursOn(r, '2026-03-30')).toBe(false);
        });
        it('30日開始で2月は末日(28)に出現する', () => {
            const r = makeRoutine({ frequency: 'monthly', startDate: '2026-01-30' });
            expect(routineOccursOn(r, '2026-02-28')).toBe(true);
        });
        it('通常の15日開始は各月15日に出現する', () => {
            const r = makeRoutine({ frequency: 'monthly', startDate: '2026-01-15' });
            expect(routineOccursOn(r, '2026-04-15')).toBe(true);
            expect(routineOccursOn(r, '2026-04-16')).toBe(false);
        });
    });

    describe('custom（N日ごと）', () => {
        it('interval=3 は3日ごとに出現する', () => {
            const r = makeRoutine({ frequency: 'custom', interval: 3, startDate: '2026-01-01' });
            expect(routineOccursOn(r, '2026-01-01')).toBe(true);
            expect(routineOccursOn(r, '2026-01-04')).toBe(true);
            expect(routineOccursOn(r, '2026-01-02')).toBe(false);
        });
        it('interval 未設定/0 は出現しない', () => {
            const r = makeRoutine({ frequency: 'custom', interval: 0, startDate: '2026-01-01' });
            expect(routineOccursOn(r, '2026-01-04')).toBe(false);
        });
    });
});
