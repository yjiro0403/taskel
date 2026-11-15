import { describe, expect, it } from 'vitest';

import type { McpDaySnapshot } from './db';
import { chooseSectionId } from './sectionChoice';

type Sections = McpDaySnapshot['sections'];

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

// The sections every new account starts with (src/lib/supabase/data.ts).
const DEFAULTS: Sections = [
    { id: id(1), name: 'Morning', start_time: '06:00', end_time: null, order: 0 },
    { id: id(2), name: 'Lunch', start_time: '12:00', end_time: null, order: 1 },
    { id: id(3), name: 'Afternoon', start_time: '13:00', end_time: null, order: 2 },
    { id: id(4), name: 'Evening', start_time: '18:00', end_time: null, order: 3 },
    { id: id(5), name: 'Night', start_time: '21:00', end_time: null, order: 4 },
];

const base = { sections: DEFAULTS, date: '2026-11-15', today: '2026-11-15', nowTime: '14:20' };

describe('chooseSectionId', () => {
    describe('rule 1: a start time picks the section that covers it', () => {
        it.each([
            ['06:00', 1],
            ['11:59', 1],
            ['12:00', 2],
            ['12:59', 2],
            ['13:00', 3],
            ['17:59', 3],
            ['18:00', 4],
            ['21:00', 5],
            ['23:59', 5],
        ])('%s', (scheduledStart, expected) => {
            expect(chooseSectionId({ ...base, scheduledStart })).toBe(id(expected));
        });

        it('uses the start time even when the task is for another day', () => {
            expect(chooseSectionId({ ...base, date: '2026-11-20', scheduledStart: '19:30' })).toBe(id(4));
        });
    });

    describe('rule 2: no start time, for today: the section that covers now', () => {
        it('14:20 is Afternoon', () => {
            expect(chooseSectionId({ ...base, scheduledStart: null })).toBe(id(3));
        });

        it('22:10 is Night', () => {
            expect(chooseSectionId({ ...base, scheduledStart: null, nowTime: '22:10' })).toBe(id(5));
        });
    });

    describe('rule 3: the time falls in a gap', () => {
        it('03:00 with the default sections goes to the next section, Morning, never to the interval', () => {
            expect(chooseSectionId({ ...base, scheduledStart: '03:00' })).toBe(id(1));
            expect(chooseSectionId({ ...base, scheduledStart: null, nowTime: '03:00' })).toBe(id(1));
            expect(chooseSectionId({ ...base, scheduledStart: '00:00' })).toBe(id(1));
            expect(chooseSectionId({ ...base, scheduledStart: '05:59' })).toBe(id(1));
        });

        const gapped: Sections = [
            { id: id(1), name: 'AM', start_time: '08:00', end_time: '10:00', order: 0 },
            { id: id(2), name: 'PM', start_time: '14:00', end_time: '16:00', order: 1 },
        ];

        it('a gap between two sections goes to the next one', () => {
            expect(chooseSectionId({ ...base, sections: gapped, scheduledStart: '11:00' })).toBe(id(2));
        });

        it('a gap after the last section goes to the section that starts last', () => {
            expect(chooseSectionId({ ...base, sections: gapped, scheduledStart: '20:00' })).toBe(id(2));
        });

        it('always returns one of the given sections', () => {
            const ids = new Set(gapped.map((section) => section.id));
            for (let hour = 0; hour < 24; hour += 1) {
                const time = `${String(hour).padStart(2, '0')}:30`;
                expect(ids.has(chooseSectionId({ ...base, sections: gapped, scheduledStart: time }) as string)).toBe(true);
            }
        });
    });

    describe('rule 4: no start time, another day: the first section by order', () => {
        it('tomorrow', () => {
            expect(chooseSectionId({ ...base, date: '2026-11-16', scheduledStart: null })).toBe(id(1));
        });

        it('follows order, not start time or list position', () => {
            const reordered: Sections = [
                { id: id(1), name: 'Late', start_time: '20:00', end_time: null, order: 0 },
                { id: id(2), name: 'Early', start_time: '06:00', end_time: null, order: 1 },
            ];
            expect(chooseSectionId({ ...base, sections: [...reordered].reverse(), date: '2026-11-16', scheduledStart: null })).toBe(id(1));
        });
    });

    it('rule 5: a user without sections gets none', () => {
        expect(chooseSectionId({ ...base, sections: [], scheduledStart: '10:00' })).toBeNull();
        expect(chooseSectionId({ ...base, sections: [], scheduledStart: null })).toBeNull();
    });

    it('a single section takes everything', () => {
        const one: Sections = [{ id: id(7), name: 'All day', start_time: '09:00', end_time: null, order: 0 }];
        expect(chooseSectionId({ ...base, sections: one, scheduledStart: '02:00' })).toBe(id(7));
        expect(chooseSectionId({ ...base, sections: one, scheduledStart: '23:00' })).toBe(id(7));
    });
});
