import { isValidTimeZone, resolveWallTime } from '@/lib/schedule/time';
import type { EditableCandidateInput, ScheduleCandidate } from '@/lib/schedule/types';

const CALENDAR_ID_RE = /^[A-Za-z0-9_@.\-]{1,256}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isCalendarId(value: string): boolean {
    return value === 'primary' || CALENDAR_ID_RE.test(value);
}

export interface ManualValidation {
    ok: boolean;
    error: string | null;
    candidate: ScheduleCandidate | null;
    startUtc: Date | null;
    endUtc: Date | null;
}

/**
 * A person confirmed these fields in the review form.
 * Past events are allowed. An end that is not after the start is not.
 * The model is not the source of the calendar id.
 */
export function validateManualCandidate(input: EditableCandidateInput): ManualValidation {
    const title = input.title.replace(/\s+/g, ' ').trim();
    const timeZone = input.timeZone.trim() || 'Asia/Tokyo';
    if (!title || title.length > 200) {
        return { ok: false, error: 'missing_title', candidate: null, startUtc: null, endUtc: null };
    }
    if (!DATE_RE.test(input.date)) {
        return { ok: false, error: 'missing_date', candidate: null, startUtc: null, endUtc: null };
    }
    if (!isValidTimeZone(timeZone)) {
        return { ok: false, error: 'timezone_uncertain', candidate: null, startUtc: null, endUtc: null };
    }

    let startUtc: Date | null = null;
    let endUtc: Date | null = null;
    if (!input.allDay) {
        if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
            return { ok: false, error: 'missing_start', candidate: null, startUtc: null, endUtc: null };
        }
        const start = resolveWallTime(input.date, input.startTime, timeZone);
        const end = resolveWallTime(input.date, input.endTime, timeZone);
        if (!start.ok || !end.ok) {
            return { ok: false, error: 'dst_gap', candidate: null, startUtc: null, endUtc: null };
        }
        if (end.utc.getTime() <= start.utc.getTime()) {
            return { ok: false, error: 'end_not_after_start', candidate: null, startUtc: null, endUtc: null };
        }
        startUtc = start.utc;
        endUtc = end.utc;
    }

    const explicit = {
        year: true,
        month: true,
        day: true,
        startTime: !input.allDay,
        endTime: !input.allDay,
        title: true,
        timezone: true,
    };
    const candidate: ScheduleCandidate = {
        title,
        suggestedTitle: title,
        date: input.date,
        suggestedDate: input.date,
        startTime: input.allDay ? null : input.startTime,
        suggestedStartTime: input.allDay ? null : input.startTime,
        endTime: input.allDay ? null : input.endTime,
        suggestedEndTime: input.allDay ? null : input.endTime,
        timeZone,
        timeZoneSource: 'explicit',
        allDay: input.allDay,
        status: 'confirmed',
        explicit,
        sourceEvidence: '',
        uncertainties: [],
        weekdayLabel: null,
    };
    return { ok: true, error: null, candidate, startUtc, endUtc };
}
