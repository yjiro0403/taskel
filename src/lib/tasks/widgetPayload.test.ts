import { describe, expect, it } from 'vitest';

import type { Section, Task } from '@/types';

import { buildWidgetPayload, WIDGET_SCHEDULE_LIMIT, WIDGET_UPCOMING_LIMIT, widgetPayloadKey } from './widgetPayload';

const TODAY = '2026-09-18';
const MIN = 60_000;
const NOW = new Date(2026, 8, 18, 10, 0, 0, 0).getTime();

const SECTIONS: Section[] = [
    { id: 'morning', userId: 'u1', name: 'Morning', startTime: '06:00', order: 0 },
    { id: 'afternoon', userId: 'u1', name: 'Afternoon', startTime: '13:00', order: 1 },
];

let counter = 0;
function makeTask(overrides: Partial<Task> = {}): Task {
    counter += 1;
    return {
        id: `task-${counter}`,
        userId: 'u1',
        title: `Task ${counter}`,
        sectionId: 'morning',
        date: TODAY,
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: counter,
        ...overrides,
    };
}

function build(tasks: Task[], now = NOW) {
    return buildWidgetPayload({ tasks, sections: SECTIONS, now, today: TODAY });
}

describe('buildWidgetPayload', () => {
    it('describes the running task with its planned end and concurrency', () => {
        const running = makeTask({ title: 'Emails', status: 'in_progress', startedAt: NOW - 12 * MIN, estimatedMinutes: 30 });
        const other = makeTask({ status: 'in_progress', startedAt: NOW - 60 * MIN });
        const payload = build([running, other]);

        expect(payload.generatedAt).toBe(NOW);
        expect(payload.today).toBe(TODAY);
        expect(payload.current).toEqual({
            title: 'Emails',
            startAt: NOW - 12 * MIN,
            endAt: NOW + 18 * MIN,
            concurrentCount: 1,
        });
    });

    it('sends a null end for a running task without an estimate', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW - 5 * MIN, estimatedMinutes: 0 });
        expect(build([running]).current?.endAt).toBeNull();
    });

    it('ships every remaining fixed-time task in start order, windows included', () => {
        const lunch = makeTask({ title: 'Lunch', scheduledStart: '12:00', estimatedMinutes: 45 });
        const bus = makeTask({ title: 'Bus', scheduledStart: '10:01', estimatedMinutes: 1 });
        const missed = makeTask({ title: 'Missed', scheduledStart: '09:00', estimatedMinutes: 30 });
        const payload = build([lunch, bus, missed]);

        expect(payload.upcoming).toEqual([
            { title: 'Bus', startAt: NOW + 1 * MIN, endAt: NOW + 2 * MIN },
            { title: 'Lunch', startAt: NOW + 120 * MIN, endAt: NOW + 165 * MIN },
        ]);
    });

    it('caps the upcoming list', () => {
        const tasks = Array.from({ length: WIDGET_UPCOMING_LIMIT + 5 }, (_, i) =>
            makeTask({ scheduledStart: `${String(10 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` })
        );
        expect(build(tasks).upcoming).toHaveLength(WIDGET_UPCOMING_LIMIT);
    });

    it('always includes the queue fallback, even while fixed-time tasks remain', () => {
        const bus = makeTask({ scheduledStart: '10:30' });
        const chore = makeTask({ title: 'Laundry', order: 1 });
        const later = makeTask({ title: 'Later', order: 2 });
        const payload = build([later, bus, chore]);

        // The widget needs the fallback once the bus window has passed and the app is closed.
        expect(payload.upcoming).toHaveLength(1);
        expect(payload.queued).toEqual({ title: 'Laundry' });
    });

    it('is empty for an empty day', () => {
        expect(build([])).toEqual({
            generatedAt: NOW,
            today: TODAY,
            current: null,
            upcoming: [],
            queued: null,
            schedule: [],
        });
    });
});

describe('widgetPayloadKey', () => {
    it('ignores generatedAt but reflects every other field', () => {
        const bus = makeTask({ title: 'Bus', scheduledStart: '10:30' });
        const a = build([bus], NOW);
        const b = build([bus], NOW + 5_000);
        expect(widgetPayloadKey(a)).toBe(widgetPayloadKey(b));

        const started = build([{ ...bus, status: 'in_progress', startedAt: NOW }], NOW);
        expect(widgetPayloadKey(started)).not.toBe(widgetPayloadKey(a));
    });
});

describe('buildWidgetPayload schedule (home-screen schedule widget)', () => {
    const build = (tasks: Task[]) => buildWidgetPayload({ tasks, sections: SECTIONS, now: NOW, today: TODAY });

    it('lists remaining fixed-time tasks earliest first, with the task id for row taps', () => {
        const later = makeTask({ title: 'Later', scheduledStart: '14:00', estimatedMinutes: 30 });
        const soon = makeTask({ title: 'Soon', scheduledStart: '10:30', estimatedMinutes: 15 });
        const { schedule } = build([later, soon]);

        expect(schedule.map((row) => row.title)).toEqual(['Soon', 'Later']);
        expect(schedule[0]).toEqual({
            id: soon.id,
            title: 'Soon',
            startAt: NOW + 30 * MIN,
            endAt: NOW + 45 * MIN,
            status: 'open',
        });
    });

    it('keeps a running task even when its planned window has passed', () => {
        const running = makeTask({
            title: 'Running',
            status: 'in_progress',
            startedAt: NOW - 90 * MIN,
            scheduledStart: '08:00',
            estimatedMinutes: 30,
        });
        const { schedule } = build([running]);
        expect(schedule).toHaveLength(1);
        expect(schedule[0].status).toBe('in_progress');
    });

    it('leaves out ended, done, skipped and untimed tasks', () => {
        const ended = makeTask({ title: 'Ended', scheduledStart: '08:00', estimatedMinutes: 30 });
        const done = makeTask({ title: 'Done', status: 'done', scheduledStart: '11:00' });
        const skipped = makeTask({ title: 'Skipped', status: 'skipped', scheduledStart: '11:30' });
        const untimed = makeTask({ title: 'Untimed' });
        const kept = makeTask({ title: 'Kept', scheduledStart: '12:00' });

        expect(build([ended, done, skipped, untimed, kept]).schedule.map((row) => row.title)).toEqual(['Kept']);
    });

    it('caps the list at WIDGET_SCHEDULE_LIMIT rows', () => {
        const tasks = Array.from({ length: WIDGET_SCHEDULE_LIMIT + 5 }, (_, index) =>
            makeTask({ scheduledStart: `${String(11 + Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}` })
        );
        expect(build(tasks).schedule).toHaveLength(WIDGET_SCHEDULE_LIMIT);
    });

    it('changes the payload key when only the schedule changes', () => {
        const base = build([makeTask({ title: 'A', scheduledStart: '11:00' })]);
        const changed = build([makeTask({ title: 'B', scheduledStart: '11:00' })]);
        expect(widgetPayloadKey(base)).not.toBe(widgetPayloadKey(changed));
    });
});
