import { describe, expect, it } from 'vitest';

import type { Section, Task } from '@/types';

import {
    computeNowNext,
    describeDuration,
    hasScheduleConflict,
    MIN_WINDOW_MINUTES,
} from './nowNext';

const TODAY = '2026-09-18';
const MIN = 60_000;

// 10:00 local on TODAY. scheduledStart is resolved as local time as well, so the
// test is timezone independent.
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

function snapshot(tasks: Task[], now = NOW) {
    return computeNowNext({ tasks, sections: SECTIONS, now, today: TODAY });
}

describe('computeNowNext – current action', () => {
    it('returns null when nothing is running', () => {
        expect(snapshot([makeTask(), makeTask({ status: 'done' })]).current).toBeNull();
    });

    it('reports the running task with elapsed and remaining time', () => {
        const running = makeTask({
            title: 'Emails',
            status: 'in_progress',
            startedAt: NOW - 12 * MIN,
            estimatedMinutes: 30,
        });
        const { current } = snapshot([running]);

        expect(current?.task.id).toBe(running.id);
        expect(current?.startAt).toBe(NOW - 12 * MIN);
        expect(current?.elapsedMs).toBe(12 * MIN);
        expect(current?.endAt).toBe(NOW + 18 * MIN);
        expect(current?.remainingMs).toBe(18 * MIN);
        expect(current?.concurrentCount).toBe(0);
    });

    it('subtracts minutes logged in earlier paused runs from the estimate', () => {
        const running = makeTask({
            status: 'in_progress',
            startedAt: NOW - 5 * MIN,
            estimatedMinutes: 30,
            actualMinutes: 20,
        });
        const { current } = snapshot([running]);
        // 30 - 20 = 10 minutes budget, 5 already used in this run.
        expect(current?.remainingMs).toBe(5 * MIN);
    });

    it('goes negative (overrun) once the plan is exhausted', () => {
        const running = makeTask({
            status: 'in_progress',
            startedAt: NOW - 45 * MIN,
            estimatedMinutes: 30,
        });
        expect(snapshot([running]).current?.remainingMs).toBe(-15 * MIN);
    });

    it('has no planned end when the task has no estimate', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW - 7 * MIN, estimatedMinutes: 0 });
        const { current } = snapshot([running]);
        expect(current?.endAt).toBeNull();
        expect(current?.remainingMs).toBeNull();
        expect(current?.elapsedMs).toBe(7 * MIN);
    });

    it('treats the most recently started timer as primary and counts the others', () => {
        const older = makeTask({ title: 'Deep work', status: 'in_progress', startedAt: NOW - 60 * MIN });
        const newer = makeTask({ title: 'Coffee', status: 'in_progress', startedAt: NOW - 2 * MIN });
        const third = makeTask({ status: 'in_progress', startedAt: NOW - 30 * MIN });
        const { current } = snapshot([older, newer, third]);
        expect(current?.task.id).toBe(newer.id);
        expect(current?.concurrentCount).toBe(2);
    });

    it('counts a timer started on another date (still running) as current', () => {
        const yesterday = makeTask({ date: '2026-09-17', status: 'in_progress', startedAt: NOW - 90 * MIN });
        expect(snapshot([yesterday]).current?.task.id).toBe(yesterday.id);
    });

    it('ignores in_progress rows without a startedAt (data anomaly)', () => {
        const broken = makeTask({ status: 'in_progress', startedAt: undefined });
        expect(snapshot([broken]).current).toBeNull();
    });

    it('never reports negative elapsed time when the clock is behind startedAt', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW + 2 * MIN });
        expect(snapshot([running]).current?.elapsedMs).toBe(0);
    });
});

describe('computeNowNext – next action (fixed-time)', () => {
    it('picks the earliest upcoming scheduled task and counts down to it', () => {
        const later = makeTask({ title: 'Lunch', scheduledStart: '12:00' });
        const bus = makeTask({ title: 'Bus', scheduledStart: '10:01', estimatedMinutes: 1 });
        const { next } = snapshot([later, bus]);

        expect(next?.kind).toBe('fixed');
        if (next?.kind !== 'fixed') throw new Error('expected fixed');
        expect(next.task.id).toBe(bus.id);
        expect(next.startAt).toBe(NOW + 1 * MIN);
        expect(next.untilMs).toBe(1 * MIN);
    });

    it('accepts Supabase "HH:mm:ss" start times', () => {
        const task = makeTask({ scheduledStart: '10:30:00' });
        const { next } = snapshot([task]);
        if (next?.kind !== 'fixed') throw new Error('expected fixed');
        expect(next.startAt).toBe(NOW + 30 * MIN);
    });

    it('keeps a task whose start has arrived as "due now" while its window lasts', () => {
        const meeting = makeTask({ title: 'Meeting', scheduledStart: '09:50', estimatedMinutes: 60 });
        const { next } = snapshot([meeting]);
        if (next?.kind !== 'fixed') throw new Error('expected fixed');
        expect(next.task.id).toBe(meeting.id);
        expect(next.untilMs).toBe(-10 * MIN);
    });

    it('still surfaces a due-now task while another task is running', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW - 20 * MIN });
        const bus = makeTask({ title: 'Bus', scheduledStart: '09:59', estimatedMinutes: 3 });
        const { current, next } = snapshot([running, bus]);
        expect(current?.task.id).toBe(running.id);
        if (next?.kind !== 'fixed') throw new Error('expected fixed');
        expect(next.task.id).toBe(bus.id);
        expect(next.untilMs).toBe(-1 * MIN);
    });

    it('drops a scheduled task once its window has fully passed', () => {
        const missed = makeTask({ scheduledStart: '09:00', estimatedMinutes: 30 }); // window ended 09:30
        const upcoming = makeTask({ scheduledStart: '11:00' });
        const { next } = snapshot([missed, upcoming]);
        if (next?.kind !== 'fixed') throw new Error('expected fixed');
        expect(next.task.id).toBe(upcoming.id);
    });

    it('gives a zero-minute task a minimum window so it is "now" during its minute', () => {
        const marker = makeTask({ scheduledStart: '09:59', estimatedMinutes: 0 });
        const inWindow = snapshot([marker], new Date(2026, 8, 18, 9, 59, 30).getTime());
        expect(inWindow.next?.task.id).toBe(marker.id);

        const afterWindow = snapshot([marker], NOW + MIN_WINDOW_MINUTES * MIN);
        expect(afterWindow.next).toBeNull();
    });

    it('ignores done, in_progress and other-date tasks', () => {
        const done = makeTask({ status: 'done', scheduledStart: '10:05' });
        const running = makeTask({ status: 'in_progress', startedAt: NOW, scheduledStart: '10:10' });
        const tomorrow = makeTask({ date: '2026-09-19', scheduledStart: '10:15' });
        const real = makeTask({ scheduledStart: '10:20' });
        const { next } = snapshot([done, running, tomorrow, real]);
        expect(next?.task.id).toBe(real.id);
    });

    it('ignores unparsable start times', () => {
        const broken = makeTask({ scheduledStart: 'soon' });
        expect(snapshot([broken]).next).toBeNull();
    });

    it('breaks ties on the same start time by manual order', () => {
        const second = makeTask({ scheduledStart: '10:30', order: 20 });
        const first = makeTask({ scheduledStart: '10:30', order: 10 });
        expect(snapshot([second, first]).next?.task.id).toBe(first.id);
    });
});

describe('computeNowNext – next action (queue fallback)', () => {
    it('falls back to the first open unscheduled task in list order', () => {
        const afternoon = makeTask({ sectionId: 'afternoon', order: 0 });
        const morningB = makeTask({ sectionId: 'morning', order: 2 });
        const morningA = makeTask({ sectionId: 'morning', order: 1 });
        const { next } = snapshot([afternoon, morningB, morningA]);
        expect(next).toEqual({ kind: 'queued', task: morningA });
    });

    it('skips done tasks, running tasks and past fixed-time tasks in the fallback', () => {
        const done = makeTask({ status: 'done', order: 0 });
        const running = makeTask({ status: 'in_progress', startedAt: NOW, order: 1 });
        const missed = makeTask({ scheduledStart: '08:00', estimatedMinutes: 15, order: 2 });
        const open = makeTask({ order: 3 });
        const { next } = snapshot([done, running, missed, open]);
        expect(next).toEqual({ kind: 'queued', task: open });
    });

    it('returns null when nothing is left to do today', () => {
        expect(snapshot([makeTask({ status: 'done' })]).next).toBeNull();
        expect(snapshot([]).next).toBeNull();
    });

    it('does not queue tasks from other dates', () => {
        const tomorrow = makeTask({ date: '2026-09-19' });
        expect(snapshot([tomorrow]).next).toBeNull();
    });
});

describe('hasScheduleConflict', () => {
    it('flags a next fixed start that lands before the current task is planned to end', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW - 10 * MIN, estimatedMinutes: 60 }); // ends 10:50
        const bus = makeTask({ scheduledStart: '10:30', estimatedMinutes: 1 });
        expect(hasScheduleConflict(snapshot([running, bus]))).toBe(true);
    });

    it('is quiet when the next start is after the planned end, already due, unplanned, or queued', () => {
        const running = makeTask({ status: 'in_progress', startedAt: NOW - 10 * MIN, estimatedMinutes: 30 }); // ends 10:20
        expect(hasScheduleConflict(snapshot([running, makeTask({ scheduledStart: '10:30' })]))).toBe(false);

        const dueNow = makeTask({ scheduledStart: '09:55', estimatedMinutes: 30 });
        expect(hasScheduleConflict(snapshot([running, dueNow]))).toBe(false);

        const noEstimate = makeTask({ status: 'in_progress', startedAt: NOW, estimatedMinutes: 0 });
        expect(hasScheduleConflict(snapshot([noEstimate, makeTask({ scheduledStart: '10:05' })]))).toBe(false);

        expect(hasScheduleConflict(snapshot([running, makeTask()]))).toBe(false);
        expect(hasScheduleConflict(snapshot([]))).toBe(false);
    });
});

describe('describeDuration', () => {
    it('ticks seconds below ten minutes', () => {
        expect(describeDuration(3 * MIN + 20_000, { roundUp: false })).toEqual({ mode: 'ms', minutes: 3, seconds: 20 });
        expect(describeDuration(45_000, { roundUp: false })).toEqual({ mode: 's', seconds: 45 });
        expect(describeDuration(0, { roundUp: true })).toEqual({ mode: 's', seconds: 0 });
    });

    it('rounds up for countdowns and down for elapsed readings', () => {
        expect(describeDuration(500, { roundUp: true })).toEqual({ mode: 's', seconds: 1 });
        expect(describeDuration(500, { roundUp: false })).toEqual({ mode: 's', seconds: 0 });
        expect(describeDuration(11 * MIN + 30_000, { roundUp: true })).toEqual({ mode: 'm', minutes: 12 });
        expect(describeDuration(11 * MIN + 30_000, { roundUp: false })).toEqual({ mode: 'm', minutes: 11 });
    });

    it('uses minutes only between ten minutes and an hour', () => {
        expect(describeDuration(10 * MIN, { roundUp: true })).toEqual({ mode: 'm', minutes: 10 });
        expect(describeDuration(59 * MIN, { roundUp: false })).toEqual({ mode: 'm', minutes: 59 });
    });

    it('uses hours and minutes from one hour up', () => {
        expect(describeDuration(60 * MIN, { roundUp: false })).toEqual({ mode: 'h', hours: 1 });
        expect(describeDuration(72 * MIN, { roundUp: false })).toEqual({ mode: 'hm', hours: 1, minutes: 12 });
        expect(describeDuration(59 * MIN + 30_000, { roundUp: true })).toEqual({ mode: 'h', hours: 1 });
    });

    it('ignores the sign and tolerates bad input', () => {
        expect(describeDuration(-15 * MIN, { roundUp: false })).toEqual({ mode: 'm', minutes: 15 });
        expect(describeDuration(Number.NaN, { roundUp: true })).toEqual({ mode: 's', seconds: 0 });
    });
});
