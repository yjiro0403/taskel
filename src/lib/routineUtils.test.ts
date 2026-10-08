import { describe, it, expect } from 'vitest';

import { computeNextRun, routineOccursOn } from './routineUtils';
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

describe('computeNextRun', () => {
    const asOf = '2026-10-02'; // Friday

    it('daily は開始日と今日のうち遅い方', () => {
        expect(computeNextRun({ frequency: 'daily', startDate: '2026-10-05' }, asOf)).toBe('2026-10-05');
        expect(computeNextRun({ frequency: 'daily', startDate: '2026-01-01' }, asOf)).toBe('2026-10-02');
        expect(computeNextRun({ frequency: 'daily', startDate: '2026-10-02' }, asOf)).toBe('2026-10-02');
    });

    it('weekly は開始日以降の指定曜日（0=日 … 1=月）', () => {
        // 月曜のみ。開始日 2026-10-05 自体が月曜なのでその日。
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [1], startDate: '2026-10-05' },
            asOf,
        )).toBe('2026-10-05');
        // 水曜のみ。開始日は月曜なので次の水曜。
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [3], startDate: '2026-10-05' },
            asOf,
        )).toBe('2026-10-07');
        // 金曜のみ。開始日より前の金曜（当日）には戻らない。
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [5], startDate: '2026-10-05' },
            asOf,
        )).toBe('2026-10-09');
        // 今日が指定曜日なら今日。
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [5], startDate: '2026-10-01' },
            asOf,
        )).toBe('2026-10-02');
    });

    it('保存済み next_run が過去でも、次の指定曜日を返す', () => {
        // 2026-01-13 は火曜。月曜指定の次回は 2026-10-05。
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [1], startDate: '2026-01-13' },
            asOf,
        )).toBe('2026-10-05');
    });

    it('daysOfWeek が空なら開始日の曜日で繰り返す', () => {
        expect(computeNextRun(
            { frequency: 'weekly', daysOfWeek: [], startDate: '2026-01-13' },
            asOf,
        )).toBe('2026-10-06');
    });

    it('monthly は月末繰り上げと同じ日を選ぶ', () => {
        expect(computeNextRun({ frequency: 'monthly', startDate: '2026-01-31' }, '2026-02-01')).toBe('2026-02-28');
        expect(computeNextRun({ frequency: 'monthly', startDate: '2024-01-31' }, '2024-02-01')).toBe('2024-02-29');
        expect(computeNextRun({ frequency: 'monthly', startDate: '2026-01-15' }, '2026-04-16')).toBe('2026-05-15');
        expect(computeNextRun({ frequency: 'monthly', startDate: '2026-01-31' }, '2026-02-28')).toBe('2026-02-28');
    });

    it('custom は interval 日ごとで、不正な interval でも日付を返す', () => {
        expect(computeNextRun(
            { frequency: 'custom', interval: 3, startDate: '2026-01-01' },
            '2026-01-02',
        )).toBe('2026-01-04');
        expect(computeNextRun(
            { frequency: 'custom', interval: 3, startDate: '2026-01-01' },
            '2026-01-04',
        )).toBe('2026-01-04');
        expect(computeNextRun(
            { frequency: 'custom', interval: 0, startDate: '2026-01-01' },
            '2026-01-04',
        )).toBe('2026-01-04');
    });

    it('不正な日付でも空文字や null にはしない', () => {
        expect(computeNextRun({ frequency: 'daily', startDate: '' }, asOf)).toBe(asOf);
        expect(computeNextRun({ frequency: 'weekly', daysOfWeek: [1] }, 'not-a-date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
