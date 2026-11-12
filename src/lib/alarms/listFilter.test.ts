import { describe, expect, it } from 'vitest';

import { alarmListFilter, STALE_ALARM_GRACE_MS } from './listFilter';

describe('alarmListFilter', () => {
    const now = new Date('2026-11-12T03:00:00.000Z');
    const cutoff = new Date(now.getTime() - STALE_ALARM_GRACE_MS).toISOString();

    it('keeps future alarms, recent scheduled ones, and ringing ones', () => {
        expect(alarmListFilter(now)).toBe(
            `fire_at.gte.${now.toISOString()},and(status.eq.scheduled,or(fire_at.gte.${cutoff},ringing_at.not.is.null))`
        );
    });

    it('uses a 24 hour grace for scheduled alarms that already passed', () => {
        expect(cutoff).toBe('2026-11-11T03:00:00.000Z');
    });

    it('drops the ringing clause for databases without ringing_at', () => {
        expect(alarmListFilter(now, { ringingColumn: false })).toBe(
            `fire_at.gte.${now.toISOString()},and(status.eq.scheduled,fire_at.gte.${cutoff})`
        );
    });
});
