import { createHash } from 'crypto';

import type { AlarmStatus } from '@/types';

/** Header the Android app sends. The secret is not a Supabase session. */
export const DEVICE_SECRET_HEADER = 'x-taskel-device-secret';

export type DeviceAlarmAction = 'ring' | 'dismiss' | 'snooze';

export interface DeviceAlarmSnapshot {
    status: string;
    ringingAt: string | null;
}

export type DeviceReportDecision =
    | { kind: 'ringing'; changed: boolean }
    | { kind: 'stop'; changed: boolean }
    | { kind: 'snooze'; fireAt: string }
    | { kind: 'reject' };

const SNOOZE_PAST_TOLERANCE_MS = 5 * 60 * 1000;
const SNOOZE_MAX_AHEAD_MS = 3 * 60 * 60 * 1000;

export function hashDeviceSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

/** True when this database has not applied the ringing_at column yet. */
export function isMissingRingingColumn(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const record = error as { code?: string; message?: string };
    return record.code === '42703' || (record.message ?? '').includes('ringing_at');
}

/**
 * Decide what a device report may change.
 * A missing alarm is the caller's problem (it should tell the device to stop).
 * "reject" means the body is not a snooze we can store; the device keeps its
 * local snooze and the WebView write-back remains the fallback.
 */
export function decideDeviceReport(
    alarm: DeviceAlarmSnapshot,
    action: DeviceAlarmAction,
    now: Date,
    snoozeFireAt?: number
): DeviceReportDecision {
    if (action === 'ring') {
        if (alarm.status !== 'scheduled') {
            return { kind: 'stop', changed: false };
        }
        if (alarm.ringingAt) {
            return { kind: 'ringing', changed: false };
        }
        return { kind: 'ringing', changed: true };
    }

    if (action === 'dismiss') {
        const changed = alarm.status !== 'dismissed' || alarm.ringingAt !== null;
        return { kind: 'stop', changed };
    }

    if (alarm.status !== 'scheduled') {
        return { kind: 'stop', changed: false };
    }
    if (snoozeFireAt === undefined || !isReasonableSnooze(snoozeFireAt, now.getTime())) {
        return { kind: 'reject' };
    }
    return { kind: 'snooze', fireAt: new Date(snoozeFireAt).toISOString() };
}

function isReasonableSnooze(fireAt: number, now: number): boolean {
    const delta = fireAt - now;
    return delta >= -SNOOZE_PAST_TOLERANCE_MS && delta <= SNOOZE_MAX_AHEAD_MS;
}

export interface AlarmPatchInput {
    fireAt?: number;
    status?: AlarmStatus;
    ringing?: boolean;
}

export interface AlarmPatchPlan {
    /** "now" marks the alarm ringing. "clear" ends a ring. "leave" keeps the column. */
    setRingingAt: 'now' | 'clear' | 'leave';
    /** Scheduled-label edits still push. A ring mark alone must not cancel phones. */
    push: boolean;
}

export function planAlarmPatch(input: AlarmPatchInput, currentStatus: string): AlarmPatchPlan {
    const turnsOff = input.status === 'dismissed' || input.status === 'fired';
    const reschedules = input.fireAt !== undefined;
    const rearms = input.status === 'scheduled';
    if (turnsOff || reschedules || rearms) {
        return { setRingingAt: 'clear', push: true };
    }
    if (input.ringing === true && currentStatus === 'scheduled') {
        return { setRingingAt: 'now', push: false };
    }
    return { setRingingAt: 'leave', push: true };
}
