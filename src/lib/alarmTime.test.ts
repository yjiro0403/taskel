import { describe, expect, it } from 'vitest';

import { normalizeTimeOfDay, taskStartToMillis } from './alarmTime';

describe('normalizeTimeOfDay', () => {
    it('input[type=time] の HH:mm をそのまま返す', () => {
        expect(normalizeTimeOfDay('18:30')).toBe('18:30');
    });

    it('Supabase の time が返す HH:mm:ss を HH:mm へ落とす', () => {
        expect(normalizeTimeOfDay('18:30:00')).toBe('18:30');
    });

    it('1桁表記をゼロ埋めする', () => {
        expect(normalizeTimeOfDay('8:5')).toBe('08:05');
    });

    it('範囲外・不正な入力は null', () => {
        expect(normalizeTimeOfDay('24:00')).toBeNull();
        expect(normalizeTimeOfDay('18:60')).toBeNull();
        expect(normalizeTimeOfDay('1830')).toBeNull();
        expect(normalizeTimeOfDay('')).toBeNull();
        expect(normalizeTimeOfDay('aa:bb')).toBeNull();
    });
});

describe('taskStartToMillis', () => {
    it('HH:mm と HH:mm:ss で同じ時刻になる（相対アラームUIが出ない不具合の再発防止）', () => {
        const fromInput = taskStartToMillis('2026-09-15', '18:30');
        const fromDatabase = taskStartToMillis('2026-09-15', '18:30:00');

        expect(fromInput).not.toBeNull();
        expect(fromDatabase).not.toBeNull();
        expect(fromDatabase).toBe(fromInput);
    });

    it('ローカル時刻として解釈する', () => {
        const ms = taskStartToMillis('2026-09-15', '18:30:00');
        const d = new Date(ms as number);
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(8); // 0-indexed
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(18);
        expect(d.getMinutes()).toBe(30);
    });

    it('date か scheduledStart が欠けていれば null', () => {
        expect(taskStartToMillis(undefined, '18:30')).toBeNull();
        expect(taskStartToMillis('2026-09-15', undefined)).toBeNull();
        expect(taskStartToMillis('', '')).toBeNull();
    });

    it('解釈できない時刻は null', () => {
        expect(taskStartToMillis('2026-09-15', 'invalid')).toBeNull();
    });
});
