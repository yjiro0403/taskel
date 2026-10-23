import type { Alarm } from '@/types';

/** An alarm is ringing only while it is still armed and a device has reported sound. */
export function isRingingAlarm(alarm: Alarm): boolean {
    return alarm.status === 'scheduled' && typeof alarm.ringingAt === 'number';
}

export function listRingingAlarms(alarms: Alarm[]): Alarm[] {
    return alarms
        .filter(isRingingAlarm)
        .slice()
        .sort((a, b) => (a.ringingAt ?? 0) - (b.ringingAt ?? 0) || a.fireAt - b.fireAt);
}
