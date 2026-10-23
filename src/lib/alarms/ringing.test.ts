import { describe, expect, it } from 'vitest';

import type { Alarm } from '@/types';

import { isRingingAlarm, listRingingAlarms } from './ringing';

function alarm(partial: Partial<Alarm> & Pick<Alarm, 'id' | 'status'>): Alarm {
    return {
        userId: 'user',
        fireAt: 0,
        snoozeMinutes: 5,
        createdAt: 0,
        updatedAt: 0,
        ...partial,
    };
}

describe('ringing alarms', () => {
    it('includes only scheduled alarms a device has reported', () => {
        const ringing = alarm({ id: 'ring', status: 'scheduled', ringingAt: 20, label: 'Standup' });
        const armed = alarm({ id: 'armed', status: 'scheduled', fireAt: 50 });
        const stopped = alarm({ id: 'stopped', status: 'dismissed', ringingAt: 10 });

        expect(isRingingAlarm(ringing)).toBe(true);
        expect(isRingingAlarm(armed)).toBe(false);
        expect(isRingingAlarm(stopped)).toBe(false);
        expect(listRingingAlarms([armed, stopped, ringing]).map((entry) => entry.id)).toEqual(['ring']);
    });

    it('orders simultaneous rings by when they started', () => {
        const later = alarm({ id: 'later', status: 'scheduled', ringingAt: 30, fireAt: 1 });
        const earlier = alarm({ id: 'earlier', status: 'scheduled', ringingAt: 10, fireAt: 2 });
        expect(listRingingAlarms([later, earlier]).map((entry) => entry.id)).toEqual(['earlier', 'later']);
    });
});
