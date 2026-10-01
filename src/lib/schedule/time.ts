import { SCHEDULE_TIME_ZONE } from '@/lib/schedule/constants';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

export interface WallTime {
    date: string;
    time: string;
    weekday: number;
}

export type ResolveResult =
    | { ok: true; utc: Date; wall: WallTime }
    | { ok: false; reason: 'invalid' | 'gap' | 'overlap' };

export function isValidTimeZone(timeZone: string): boolean {
    if (!timeZone || timeZone.length > 80) {
        return false;
    }
    try {
        Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

function partMap(instant: Date, timeZone: string): Record<string, string> {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
    });
    const map: Record<string, string> = {};
    for (const part of dtf.formatToParts(instant)) {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    }
    return map;
}

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

/** Offset of `timeZone` at `instant`, in milliseconds (zone clock minus UTC). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
    const map = partMap(instant, timeZone);
    let hour = Number(map.hour);
    let day = Number(map.day);
    if (hour === 24) {
        hour = 0;
        day += 1;
    }
    const asUtc = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        day,
        hour,
        Number(map.minute),
        Number(map.second),
    );
    return asUtc - instant.getTime();
}

export function formatWall(instant: Date, timeZone: string): WallTime {
    const map = partMap(instant, timeZone);
    let hour = Number(map.hour);
    if (hour === 24) {
        hour = 0;
    }
    const weekday = WEEKDAY_INDEX[map.weekday] ?? 0;
    return {
        date: `${map.year}-${map.month}-${map.day}`,
        time: `${String(hour).padStart(2, '0')}:${map.minute}`,
        weekday,
    };
}

/**
 * Convert a wall-clock time in an IANA zone to a UTC instant.
 * A spring-forward gap or a fall-back overlap is not a confirmed time.
 */
export function resolveWallTime(date: string, time: string, timeZone: string): ResolveResult {
    const dateMatch = DATE_RE.exec(date);
    const timeMatch = TIME_RE.exec(time);
    if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) {
        return { ok: false, reason: 'invalid' };
    }
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
        return { ok: false, reason: 'invalid' };
    }

    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const offsetAtGuess = timeZoneOffsetMs(utcGuess, timeZone);
    const instant = new Date(utcGuess.getTime() - offsetAtGuess);
    const offsetAtInstant = timeZoneOffsetMs(instant, timeZone);
    const adjusted = offsetAtGuess === offsetAtInstant
        ? instant
        : new Date(utcGuess.getTime() - offsetAtInstant);
    const wall = formatWall(adjusted, timeZone);
    if (wall.date !== date || wall.time !== time) {
        return { ok: false, reason: 'gap' };
    }
    if (offsetAtGuess !== offsetAtInstant) {
        return { ok: false, reason: 'overlap' };
    }
    return { ok: true, utc: adjusted, wall };
}

export function weekdayOfDate(date: string, timeZone: string): number | null {
    const resolved = resolveWallTime(date, '12:00', timeZone);
    if (!resolved.ok) {
        return null;
    }
    return resolved.wall.weekday;
}

const WEEKDAY_PATTERNS: Array<[RegExp, number]> = [
    [/sunday|日曜|日曜日|（日）|\(日\)/i, 0],
    [/monday|月曜|月曜日|（月）|\(月\)/i, 1],
    [/tuesday|火曜|火曜日|（火）|\(火\)/i, 2],
    [/wednesday|水曜|水曜日|（水）|\(水\)/i, 3],
    [/thursday|木曜|木曜日|（木）|\(木\)/i, 4],
    [/friday|金曜|金曜日|（金）|\(金\)/i, 5],
    [/saturday|土曜|土曜日|（土）|\(土\)/i, 6],
];

export function parseWeekdayLabel(label: string | null | undefined): number | null {
    if (!label) {
        return null;
    }
    const text = label.trim();
    if (!text) {
        return null;
    }
    for (const [pattern, index] of WEEKDAY_PATTERNS) {
        if (pattern.test(text)) {
            return index;
        }
    }
    const bare = /^(日|月|火|水|木|金|土)$/.exec(text);
    if (!bare) {
        return null;
    }
    return '日月火水木金土'.indexOf(bare[1]);
}

export function addDaysToDate(date: string, days: number): string | null {
    const match = DATE_RE.exec(date);
    if (!match) {
        return null;
    }
    const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
    const year = utc.getUTCFullYear();
    const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const day = String(utc.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function addMinutesToTime(time: string, minutes: number): string | null {
    const match = TIME_RE.exec(time);
    if (!match || minutes < 0 || minutes >= 24 * 60) {
        return null;
    }
    const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
    if (total < 0 || total >= 24 * 60) {
        return null;
    }
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function durationMinutes(start: Date, end: Date): number {
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

export function defaultTimeZone(): string {
    return SCHEDULE_TIME_ZONE;
}
