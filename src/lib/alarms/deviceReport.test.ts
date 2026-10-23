import { describe, expect, it } from 'vitest';

import { decideDeviceReport, hashDeviceSecret, isMissingRingingColumn, planAlarmPatch } from './deviceReport';

const now = new Date('2026-10-23T00:00:00.000Z');

describe('hashDeviceSecret', () => {
    it('returns a stable sha256 hex digest', () => {
        const hash = hashDeviceSecret('device-secret-value');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(hashDeviceSecret('device-secret-value')).toBe(hash);
        expect(hashDeviceSecret('other-secret-value')).not.toBe(hash);
    });
});

describe('decideDeviceReport', () => {
    const armed = { status: 'scheduled', ringingAt: null };

    it('marks a scheduled alarm ringing once', () => {
        expect(decideDeviceReport(armed, 'ring', now)).toEqual({ kind: 'ringing', changed: true });
        expect(decideDeviceReport({ ...armed, ringingAt: '2026-10-23T00:00:01.000Z' }, 'ring', now)).toEqual({
            kind: 'ringing',
            changed: false,
        });
    });

    it('tells the device to stop when the alarm is already dismissed', () => {
        expect(decideDeviceReport({ status: 'dismissed', ringingAt: null }, 'ring', now)).toEqual({
            kind: 'stop',
            changed: false,
        });
    });

    it('dismisses a ringing alarm and leaves an already-stopped one unchanged', () => {
        expect(decideDeviceReport({ status: 'scheduled', ringingAt: '2026-10-23T00:00:01.000Z' }, 'dismiss', now)).toEqual({
            kind: 'stop',
            changed: true,
        });
        expect(decideDeviceReport({ status: 'dismissed', ringingAt: null }, 'dismiss', now)).toEqual({
            kind: 'stop',
            changed: false,
        });
    });

    it('accepts a snooze a few minutes ahead and rejects a far fire time', () => {
        const fireAt = now.getTime() + 5 * 60 * 1000;
        expect(decideDeviceReport(armed, 'snooze', now, fireAt)).toEqual({
            kind: 'snooze',
            fireAt: new Date(fireAt).toISOString(),
        });
        expect(decideDeviceReport(armed, 'snooze', now, now.getTime() + 5 * 60 * 60 * 1000)).toEqual({
            kind: 'reject',
        });
        expect(decideDeviceReport({ status: 'dismissed', ringingAt: null }, 'snooze', now, fireAt)).toEqual({
            kind: 'stop',
            changed: false,
        });
    });
});

describe('isMissingRingingColumn', () => {
    it('recognizes a database that has not added ringing_at', () => {
        expect(isMissingRingingColumn({ code: '42703', message: 'column ringing_at does not exist' })).toBe(true);
        expect(isMissingRingingColumn({ code: '23514', message: 'check violation' })).toBe(false);
    });
});

describe('planAlarmPatch', () => {
    it('clears a ring when the alarm is dismissed, snoozed, or armed again', () => {
        expect(planAlarmPatch({ status: 'dismissed' }, 'scheduled')).toEqual({
            setRingingAt: 'clear',
            push: true,
        });
        expect(planAlarmPatch({ fireAt: 1 }, 'scheduled')).toEqual({ setRingingAt: 'clear', push: true });
        expect(planAlarmPatch({ status: 'scheduled' }, 'scheduled')).toEqual({
            setRingingAt: 'clear',
            push: true,
        });
    });

    it('marks ringing without pushing a cancel to phones', () => {
        expect(planAlarmPatch({ ringing: true }, 'scheduled')).toEqual({ setRingingAt: 'now', push: false });
        expect(planAlarmPatch({ ringing: true }, 'dismissed')).toEqual({ setRingingAt: 'leave', push: true });
    });

    it('still pushes ordinary label edits', () => {
        expect(planAlarmPatch({}, 'scheduled')).toEqual({ setRingingAt: 'leave', push: true });
    });
});
