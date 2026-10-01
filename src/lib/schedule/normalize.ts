import { SCHEDULE_TIME_ZONE } from '@/lib/schedule/constants';
import { isValidTimeZone } from '@/lib/schedule/time';
import type { ExplicitFields, ScheduleCandidate } from '@/lib/schedule/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface RawExplicitFields {
    year?: boolean;
    month?: boolean;
    day?: boolean;
    startTime?: boolean;
    endTime?: boolean;
    title?: boolean;
    timezone?: boolean;
}

export interface RawScheduleItem {
    title?: string | null;
    date?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    timezone?: string | null;
    allDay?: boolean;
    status?: 'confirmed' | 'candidate' | 'unknown' | null;
    explicit?: RawExplicitFields | null;
    sourceEvidence?: string | null;
    uncertainties?: string[] | null;
    weekdayLabel?: string | null;
}

function cleanText(value: string | null | undefined, max: number): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, max);
}

function flags(raw: RawExplicitFields | null | undefined): ExplicitFields {
    return {
        year: raw?.year === true,
        month: raw?.month === true,
        day: raw?.day === true,
        startTime: raw?.startTime === true,
        endTime: raw?.endTime === true,
        title: raw?.title === true,
        timezone: raw?.timezone === true,
    };
}

function asDate(value: string | null | undefined): string | null {
    const text = cleanText(value, 10);
    return text && DATE_RE.test(text) ? text : null;
}

function asTime(value: string | null | undefined): string | null {
    const text = cleanText(value, 5);
    return text && TIME_RE.test(text) ? text : null;
}

/**
 * Keep only fields the model marked as written in the source.
 * A guessed year, end, or title is preserved as a suggestion and is not a fact.
 */
export function normalizeScheduleItem(raw: RawScheduleItem): ScheduleCandidate {
    const explicit = flags(raw.explicit);
    const suggestedTitle = cleanText(raw.title, 200);
    const suggestedDate = asDate(raw.date);
    const suggestedStartTime = asTime(raw.startTime);
    const suggestedEndTime = asTime(raw.endTime);
    const requestedZone = cleanText(raw.timezone, 80);
    const zoneIsKnown = Boolean(requestedZone && isValidTimeZone(requestedZone));
    const timeZone = explicit.timezone && zoneIsKnown && requestedZone
        ? requestedZone
        : SCHEDULE_TIME_ZONE;
    const date = explicit.year && explicit.month && explicit.day ? suggestedDate : null;

    return {
        title: explicit.title ? suggestedTitle : null,
        suggestedTitle,
        date,
        suggestedDate,
        startTime: explicit.startTime ? suggestedStartTime : null,
        suggestedStartTime,
        endTime: explicit.endTime ? suggestedEndTime : null,
        suggestedEndTime,
        timeZone,
        timeZoneSource: explicit.timezone && zoneIsKnown ? 'explicit' : 'default',
        allDay: raw.allDay === true,
        status: raw.status === 'confirmed' || raw.status === 'candidate' || raw.status === 'unknown'
            ? raw.status
            : 'unknown',
        explicit,
        sourceEvidence: cleanText(raw.sourceEvidence, 500) ?? '',
        uncertainties: (raw.uncertainties ?? [])
            .map((item) => cleanText(item, 200))
            .filter((item): item is string => Boolean(item))
            .slice(0, 12),
        weekdayLabel: cleanText(raw.weekdayLabel, 40),
    };
}

export function normalizeScheduleItems(items: RawScheduleItem[] | null | undefined): ScheduleCandidate[] {
    return (items ?? []).slice(0, 12).map((item) => normalizeScheduleItem(item));
}
