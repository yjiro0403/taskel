import { describe, expect, it } from 'vitest';

import { buildGoogleEventWrite } from '@/lib/schedule/googleCalendarWrite';
import { contentHashForText, googleEventIdForIntake, isGoogleEventId } from '@/lib/schedule/idempotency';
import { validateManualCandidate } from '@/lib/schedule/manual';
import { stripJpegMetadata, stripPngMetadata } from '@/lib/schedule/metadata';
import { normalizeScheduleItem } from '@/lib/schedule/normalize';
import { decideSchedulePolicy } from '@/lib/schedule/policy';
import { resolveWallTime } from '@/lib/schedule/time';
import type { ExplicitFields, ScheduleCandidate } from '@/lib/schedule/types';

const NOW = new Date('2026-10-01T00:00:00+09:00');

const ALL_EXPLICIT: ExplicitFields = {
    year: true,
    month: true,
    day: true,
    startTime: true,
    endTime: true,
    title: true,
    timezone: true,
};

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
    return {
        title: '企画会議',
        suggestedTitle: '企画会議',
        date: '2026-10-02',
        suggestedDate: '2026-10-02',
        startTime: '15:00',
        suggestedStartTime: '15:00',
        endTime: '16:00',
        suggestedEndTime: '16:00',
        timeZone: 'Asia/Tokyo',
        timeZoneSource: 'explicit',
        allDay: false,
        status: 'confirmed',
        explicit: ALL_EXPLICIT,
        sourceEvidence: '2026年10月2日（金）15:00-16:00 企画会議',
        uncertainties: [],
        weekdayLabel: '金曜',
        ...overrides,
    };
}

describe('resolveWallTime', () => {
    it('converts a Tokyo wall time to UTC', () => {
        const resolved = resolveWallTime('2026-10-02', '15:00', 'Asia/Tokyo');
        expect(resolved.ok).toBe(true);
        if (resolved.ok) {
            expect(resolved.utc.toISOString()).toBe('2026-10-02T06:00:00.000Z');
            expect(resolved.wall.weekday).toBe(5);
        }
    });

    it('rejects a spring-forward gap', () => {
        const resolved = resolveWallTime('2026-03-08', '02:30', 'America/New_York');
        expect(resolved.ok).toBe(false);
        if (!resolved.ok) {
            expect(resolved.reason).toBe('gap');
        }
    });
});

describe('decideSchedulePolicy', () => {
    it('auto-registers one explicit future event when the setting is on', () => {
        const decision = decideSchedulePolicy([candidate()], {
            now: NOW,
            autoRegisterEnabled: true,
        });
        expect(decision.autoRegister).toBe(true);
        expect(decision.eligibleForAuto).toBe(true);
        expect(decision.reasons).toEqual([]);
    });

    it('keeps an eligible event in review while auto-register is off', () => {
        const decision = decideSchedulePolicy([candidate()], {
            now: NOW,
            autoRegisterEnabled: false,
        });
        expect(decision.eligibleForAuto).toBe(true);
        expect(decision.autoRegister).toBe(false);
        expect(decision.reasons).toEqual(['auto_register_off']);
    });

    it('does not auto-register two candidates', () => {
        const decision = decideSchedulePolicy([
            candidate(),
            candidate({ title: '別件', suggestedTitle: '別件', startTime: '18:00', endTime: '19:00' }),
        ], { now: NOW, autoRegisterEnabled: true });
        expect(decision.autoRegister).toBe(false);
        expect(decision.reasons).toContain('multiple_items');
    });

    it('does not treat a relative phrase as a confirmed date', () => {
        const decision = decideSchedulePolicy([
            candidate({ sourceEvidence: '明日の15:00-16:00 企画会議' }),
        ], { now: NOW, autoRegisterEnabled: true });
        expect(decision.autoRegister).toBe(false);
        expect(decision.reasons).toContain('relative_expression');
    });

    it('sends a changed plan to review', () => {
        const decision = decideSchedulePolicy([candidate()], {
            now: NOW,
            autoRegisterEnabled: true,
            sourceText: '火曜で。やっぱり木曜に変更',
        });
        expect(decision.reasons).toContain('conversation_change');
        expect(decision.autoRegister).toBe(false);
    });

    it('does not use a notification timestamp as the event time', () => {
        const decision = decideSchedulePolicy([
            candidate({ uncertainties: ['通知バーの時刻は予定ではない'] }),
        ], { now: NOW, autoRegisterEnabled: true });
        expect(decision.reasons).toContain('notification_time');
        expect(decision.autoRegister).toBe(false);
    });

    it('requires an explicit year, end, and a matching weekday', () => {
        const missingYear = normalizeScheduleItem({
            title: '企画会議',
            date: '2026-10-02',
            startTime: '15:00',
            endTime: '16:00',
            status: 'confirmed',
            explicit: { ...ALL_EXPLICIT, year: false },
            sourceEvidence: '10月2日 15:00-16:00',
            weekdayLabel: '金曜',
        });
        expect(missingYear.date).toBeNull();
        expect(missingYear.suggestedDate).toBe('2026-10-02');
        const yearDecision = decideSchedulePolicy([missingYear], { now: NOW, autoRegisterEnabled: true });
        expect(yearDecision.reasons).toContain('missing_year');

        const noEnd = candidate({
            endTime: null,
            suggestedEndTime: null,
            explicit: { ...ALL_EXPLICIT, endTime: false },
        });
        expect(decideSchedulePolicy([noEnd], { now: NOW, autoRegisterEnabled: true }).reasons)
            .toContain('missing_end');

        const mismatch = candidate({ weekdayLabel: '火曜' });
        expect(decideSchedulePolicy([mismatch], { now: NOW, autoRegisterEnabled: true }).reasons)
            .toContain('weekday_mismatch');
    });

    it('rejects a past date, an all-day event, and an end that is not after the start', () => {
        expect(decideSchedulePolicy([
            candidate({ date: '2026-09-01', suggestedDate: '2026-09-01', weekdayLabel: null }),
        ], { now: NOW, autoRegisterEnabled: true }).reasons).toContain('past_date');

        expect(decideSchedulePolicy([
            candidate({ allDay: true, startTime: null, endTime: null }),
        ], { now: NOW, autoRegisterEnabled: true }).reasons).toContain('all_day');

        expect(decideSchedulePolicy([
            candidate({ endTime: '15:00', suggestedEndTime: '15:00' }),
        ], { now: NOW, autoRegisterEnabled: true }).reasons).toContain('end_not_after_start');
    });

    it('does not auto-register a default Tokyo zone when another place is mentioned', () => {
        const decision = decideSchedulePolicy([
            candidate({
                timeZoneSource: 'default',
                explicit: { ...ALL_EXPLICIT, timezone: false },
                sourceEvidence: '2026-10-02 15:00-16:00 in New York 企画会議',
                weekdayLabel: '金曜',
            }),
        ], { now: NOW, autoRegisterEnabled: true });
        expect(decision.reasons).toContain('timezone_uncertain');
    });

    it('sends a DST gap to review', () => {
        const decision = decideSchedulePolicy([
            candidate({
                date: '2026-03-08',
                suggestedDate: '2026-03-08',
                startTime: '02:30',
                endTime: '03:30',
                timeZone: 'America/New_York',
                weekdayLabel: null,
                sourceEvidence: '2026-03-08 02:30-03:30 planning',
            }),
        ], { now: new Date('2026-03-01T00:00:00Z'), autoRegisterEnabled: true });
        expect(decision.autoRegister).toBe(false);
        expect(decision.reasons).toContain('dst_gap');
    });
});

describe('manual confirmation', () => {
    it('accepts a past event a person edited and rejects an end that is not later', () => {
        const past = validateManualCandidate({
            title: '振り返り',
            date: '2026-09-01',
            startTime: '10:00',
            endTime: '11:00',
            timeZone: 'Asia/Tokyo',
            allDay: false,
        });
        expect(past.ok).toBe(true);

        const backwards = validateManualCandidate({
            title: '振り返り',
            date: '2026-10-02',
            startTime: '16:00',
            endTime: '15:00',
            timeZone: 'Asia/Tokyo',
            allDay: false,
        });
        expect(backwards.ok).toBe(false);
        expect(backwards.error).toBe('end_not_after_start');
    });
});

describe('idempotency and metadata', () => {
    it('builds a stable Google event id and the same body for the same intake', () => {
        const id = googleEventIdForIntake('intake-1');
        expect(id).toBe(googleEventIdForIntake('intake-1'));
        expect(isGoogleEventId(id)).toBe(true);
        expect(googleEventIdForIntake('intake-2')).not.toBe(id);

        const event = buildGoogleEventWrite('intake-1', candidate());
        expect(event).toMatchObject({
            id,
            summary: '企画会議',
            start: { dateTime: '2026-10-02T15:00:00', timeZone: 'Asia/Tokyo' },
            end: { dateTime: '2026-10-02T16:00:00', timeZone: 'Asia/Tokyo' },
        });
    });

    it('hashes normalized text the same way when only whitespace differs', () => {
        expect(contentHashForText('  明日  15時 ')).toBe(contentHashForText('明日 15時'));
    });

    it('removes JPEG EXIF and PNG text chunks', () => {
        const jpeg = new Uint8Array([
            0xff, 0xd8,
            0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
            0xff, 0xd9,
        ]);
        const stripped = stripJpegMetadata(jpeg);
        expect(stripped[0]).toBe(0xff);
        expect(stripped[1]).toBe(0xd8);
        expect(stripped).not.toContain(0xe1);
        expect(stripped.at(-2)).toBe(0xff);
        expect(stripped.at(-1)).toBe(0xd9);

        const png = new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10,
            0, 0, 0, 4, 116, 69, 88, 116, 1, 2, 3, 4, 0, 0, 0, 0,
            0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0,
        ]);
        const pngOut = stripPngMetadata(png);
        const type = String.fromCharCode(...pngOut.slice(12, 16));
        expect(type).toBe('IEND');
    });
});
