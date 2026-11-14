/**
 * Calendar dates for the MCP tools.
 *
 * Everything here is strict: an input that is not one of the listed words or a
 * real `YYYY-MM-DD` date is refused. (The chat feature's `resolveDate` returns
 * today for anything it cannot read; a tool that did that would silently
 * answer about the wrong day.)
 *
 * "Today" is the calendar date in the token's time zone. All arithmetic is on
 * civil dates at UTC noon, so the server's own time zone and daylight saving
 * never move a date.
 */

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MCP_DAY_WORDS = ['today', 'tomorrow', 'yesterday'] as const;
export type McpDayWord = (typeof MCP_DAY_WORDS)[number];

export const MCP_RANGE_PRESETS = [
    'today',
    'yesterday',
    'this_week',
    'last_week',
    'last_7_days',
    'last_30_days',
    'last_90_days',
    'this_month',
    'last_month',
] as const;
export type McpRangePreset = (typeof MCP_RANGE_PRESETS)[number];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type McpWeekday = (typeof WEEKDAYS)[number];

const DAY_OFFSETS: Record<McpDayWord, number> = { today: 0, tomorrow: 1, yesterday: -1 };

function toUtcNoon(date: string): Date {
    return new Date(`${date}T12:00:00Z`);
}

function fromUtc(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function pad(value: number, width = 2): string {
    return String(value).padStart(width, '0');
}

/** True for a real calendar date written as `YYYY-MM-DD` (2026-02-30 is not one). */
export function isCivilDate(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }
    const match = CIVIL_DATE.exec(value);
    if (!match) {
        return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1) {
        return false;
    }
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIanaTimeZone(value: unknown): value is string {
    if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
        return false;
    }
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

/** The calendar date at `now` in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** The wall-clock time `HH:mm` at `now` in the given IANA time zone. */
export function timeInTimeZone(timeZone: string, now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
    return `${pick('hour')}:${pick('minute')}`;
}

/** The calendar date of a timestamp in the given time zone, or null when it cannot be read. */
export function dateOfTimestamp(timestamp: string | null | undefined, timeZone: string): string | null {
    if (!timestamp) {
        return null;
    }
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : todayInTimeZone(timeZone, parsed);
}

export function addDays(date: string, days: number): string {
    const value = toUtcNoon(date);
    value.setUTCDate(value.getUTCDate() + days);
    return fromUtc(value);
}

/** Whole days from `earlier` to `later` (negative when `later` is before). */
export function diffDays(earlier: string, later: string): number {
    return Math.round((toUtcNoon(later).getTime() - toUtcNoon(earlier).getTime()) / 86_400_000);
}

export function weekdayOf(date: string): McpWeekday {
    return WEEKDAYS[toUtcNoon(date).getUTCDay()];
}

export type McpDateResult = { ok: true; date: string } | { ok: false };

/**
 * Resolves the `day` / `date` pair of a tool call.
 *
 *   - neither given: today
 *   - `day`: one of `allowedDays`, relative to `today`
 *   - `date`: a real `YYYY-MM-DD` date
 *   - both given, an unknown word, or anything else: refused
 */
export function resolveMcpDate(
    input: { day?: unknown; date?: unknown },
    today: string,
    allowedDays: readonly McpDayWord[] = MCP_DAY_WORDS
): McpDateResult {
    const hasDay = input.day !== undefined;
    const hasDate = input.date !== undefined;

    if (!isCivilDate(today) || (hasDay && hasDate)) {
        return { ok: false };
    }
    if (hasDate) {
        return isCivilDate(input.date) ? { ok: true, date: input.date } : { ok: false };
    }
    if (hasDay) {
        const word = input.day;
        if (typeof word !== 'string' || !(allowedDays as readonly string[]).includes(word)) {
            return { ok: false };
        }
        return { ok: true, date: addDays(today, DAY_OFFSETS[word as McpDayWord]) };
    }
    return { ok: true, date: today };
}

export type McpDateRange = { from: string; to: string };

/** Monday of the ISO week that holds `date`. */
function mondayOf(date: string): string {
    const weekday = toUtcNoon(date).getUTCDay();
    return addDays(date, -((weekday + 6) % 7));
}

function monthRange(year: number, month: number): McpDateRange {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
        from: `${pad(year, 4)}-${pad(month)}-01`,
        to: `${pad(year, 4)}-${pad(month)}-${pad(last)}`,
    };
}

/**
 * Resolves a range word relative to `today`. Weeks are ISO weeks, Monday to
 * Sunday; `this_week` and `this_month` cover the whole week or month.
 * `last_N_days` ends today and holds N days. An unknown word returns null.
 */
export function resolveMcpRange(preset: unknown, today: string): McpDateRange | null {
    if (!isCivilDate(today) || typeof preset !== 'string') {
        return null;
    }

    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));

    switch (preset as McpRangePreset) {
        case 'today':
            return { from: today, to: today };
        case 'yesterday': {
            const day = addDays(today, -1);
            return { from: day, to: day };
        }
        case 'this_week': {
            const monday = mondayOf(today);
            return { from: monday, to: addDays(monday, 6) };
        }
        case 'last_week': {
            const monday = addDays(mondayOf(today), -7);
            return { from: monday, to: addDays(monday, 6) };
        }
        case 'last_7_days':
            return { from: addDays(today, -6), to: today };
        case 'last_30_days':
            return { from: addDays(today, -29), to: today };
        case 'last_90_days':
            return { from: addDays(today, -89), to: today };
        case 'this_month':
            return monthRange(year, month);
        case 'last_month':
            return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1);
        default:
            return null;
    }
}
