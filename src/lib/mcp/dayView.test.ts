import { describe, expect, it, vi } from 'vitest';

import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';
import { createTaskSlice } from '@/store/slices/taskSlice';
import type { StoreState } from '@/store/types';
import type { Routine, Section, Task } from '@/types';

import { buildDayView, MCP_DAY_VIEW_LIMIT, type McpTaskItem } from './dayView';
import type { McpDaySnapshot } from './db';

vi.mock('@/lib/supabase/repositories/taskRepository', () => ({
    createTaskRecord: vi.fn(),
    updateTaskRecord: vi.fn(),
    replaceTaskRecord: vi.fn(),
    deleteTaskRecord: vi.fn(),
    bulkCreateTaskRecords: vi.fn(),
    bulkUpdateTaskOrderRecords: vi.fn(),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = uuid(900);
const MORNING = uuid(1);
const AFTERNOON = uuid(2);
const EVENING = uuid(3);

const SECTIONS: Section[] = [
    { id: MORNING, userId: USER, name: 'Morning', startTime: '06:00', order: 0 },
    { id: AFTERNOON, userId: USER, name: 'Afternoon', startTime: '13:00', order: 1 },
    { id: EVENING, userId: USER, name: 'Evening', startTime: '18:00', order: 2 },
];

function task(overrides: Partial<Task> & { id: string }): Task {
    return {
        userId: USER,
        title: 'Task',
        sectionId: MORNING,
        date: '2026-11-15',
        status: 'open',
        estimatedMinutes: 15,
        actualMinutes: 0,
        order: 1,
        ...overrides,
    };
}

function routine(overrides: Partial<Routine> & { id: string }): Routine {
    return {
        userId: USER,
        title: 'Routine',
        frequency: 'daily',
        startDate: '2026-01-01',
        nextRun: '2026-01-01',
        sectionId: MORNING,
        estimatedMinutes: 10,
        active: true,
        ...overrides,
    };
}

type Fixture = {
    tasks: Task[];
    routines: Routine[];
    sections?: Section[];
    /** Ids of tasks and routines that sit in a project shared with someone else. */
    shared?: string[];
};

/** What mcp_day_snapshot returns for these app rows on `date`. */
function toSnapshot(fixture: Fixture, date: string): McpDaySnapshot {
    const shared = new Set(fixture.shared ?? []);
    return {
        tasks: fixture.tasks
            .filter((entry) => entry.date === date)
            .map((entry) => ({
                id: entry.id,
                title: shared.has(entry.id) ? null : entry.title,
                status: entry.status,
                date: entry.date,
                scheduled_start: entry.scheduledStart ?? null,
                section_id: entry.sectionId || null,
                estimated_minutes: entry.estimatedMinutes,
                actual_minutes: entry.actualMinutes,
                routine_id: entry.routineId ?? null,
                order: entry.order,
                in_scope: !shared.has(entry.id),
            })),
        tasks_truncated: false,
        goals: [],
        routines: fixture.routines
            .filter((entry) => entry.active)
            .map((entry) => ({
                id: entry.id,
                title: shared.has(entry.id) ? null : entry.title,
                frequency: entry.frequency,
                days_of_week: entry.daysOfWeek ?? null,
                interval: entry.interval ?? null,
                start_date: entry.startDate,
                next_run: entry.nextRun,
                start_time: entry.startTime ?? null,
                section_id: entry.sectionId || null,
                estimated_minutes: entry.estimatedMinutes,
                in_scope: !shared.has(entry.id),
            })),
        sections: (fixture.sections ?? SECTIONS).map((entry) => ({
            id: entry.id,
            name: entry.name,
            start_time: entry.startTime ?? null,
            end_time: entry.endTime ?? null,
            order: entry.order,
        })),
    };
}

function view(fixture: Fixture, date: string) {
    return buildDayView({ snapshot: toSnapshot(fixture, date), date });
}

/** The app's own merged day view, from the real store slice. */
function storeMergedTasks(fixture: Fixture, date: string): Task[] {
    const state = { user: { uid: USER }, currentDate: date, showToast: vi.fn() } as unknown as StoreState;
    const set = ((partial: unknown) => {
        Object.assign(state, typeof partial === 'function' ? (partial as (s: StoreState) => object)(state) : partial);
    }) as never;
    const slice = createTaskSlice(set, () => state, {} as never);
    Object.assign(state, slice, { tasksLoaded: true, tasks: fixture.tasks, routines: fixture.routines });
    return slice.getMergedTasks(date);
}

function comparable(items: McpTaskItem[]) {
    return items
        .map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            date: item.date,
            scheduled_start: item.scheduled_start,
            section: item.section,
            estimated_minutes: item.estimated_minutes,
            actual_minutes: item.actual_minutes,
            is_routine: item.is_routine,
            is_virtual: item.is_virtual,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function fromStore(tasks: Task[], sections: Section[] = SECTIONS) {
    const names = new Map(sections.map((section) => [section.id, section.name]));
    return comparable(
        tasks.map((entry) => ({
            id: entry.id,
            title: entry.title,
            status: entry.status as McpTaskItem['status'],
            date: entry.date,
            scheduled_start: entry.scheduledStart ?? null,
            section: names.get(entry.sectionId) ?? null,
            estimated_minutes: entry.estimatedMinutes,
            actual_minutes: entry.actualMinutes,
            is_routine: Boolean(entry.routineId),
            is_virtual: Boolean(entry.isVirtual),
        }))
    );
}

const R_DAILY = uuid(101);
const R_WEEKLY = uuid(102);
const R_MONTHLY = uuid(103);
const R_CUSTOM = uuid(104);
const R_WEEKLY_NO_DAYS = uuid(105);

describe('buildDayView: routine occurrences', () => {
    const routines = [
        routine({ id: R_DAILY, title: 'Daily', startTime: '07:00' }),
        // 2026-11-16 is a Monday (1); 2026-11-18 a Wednesday (3).
        routine({ id: R_WEEKLY, title: 'Weekly', frequency: 'weekly', daysOfWeek: [1, 3] }),
        routine({ id: R_MONTHLY, title: 'Monthly', frequency: 'monthly', startDate: '2026-01-31', nextRun: '2026-01-31' }),
        routine({ id: R_CUSTOM, title: 'Every 3 days', frequency: 'custom', interval: 3, startDate: '2026-11-10', nextRun: '2026-11-10' }),
        // Started on Thursday 2026-01-01 with no days: repeats on Thursdays.
        routine({ id: R_WEEKLY_NO_DAYS, title: 'Thursdays', frequency: 'weekly' }),
    ];
    const titlesOn = (date: string) => view({ tasks: [], routines }, date).tasks.map((item) => item.title).sort();

    it('daily: every day from the start date', () => {
        expect(titlesOn('2026-11-15')).toContain('Daily');
        expect(view({ tasks: [], routines: [routine({ id: R_DAILY, startDate: '2026-11-16', nextRun: '2026-11-16' })] }, '2026-11-15').tasks).toEqual([]);
    });

    it('weekly: only the listed weekdays', () => {
        expect(titlesOn('2026-11-16')).toContain('Weekly');
        expect(titlesOn('2026-11-18')).toContain('Weekly');
        expect(titlesOn('2026-11-17')).not.toContain('Weekly');
        expect(titlesOn('2026-11-15')).not.toContain('Weekly');
    });

    it('weekly without days: the weekday of the start date', () => {
        expect(titlesOn('2026-11-19')).toContain('Thursdays');
        expect(titlesOn('2026-11-20')).not.toContain('Thursdays');
    });

    it('monthly: the start day, moved to the last day in a shorter month', () => {
        expect(titlesOn('2026-12-31')).toContain('Monthly');
        expect(titlesOn('2026-11-30')).toContain('Monthly');
        expect(titlesOn('2026-11-29')).not.toContain('Monthly');
        expect(titlesOn('2027-02-28')).toContain('Monthly');
        expect(titlesOn('2028-02-29')).toContain('Monthly');
        expect(titlesOn('2028-02-28')).not.toContain('Monthly');
    });

    it('custom: every N days from the start date', () => {
        expect(titlesOn('2026-11-10')).toContain('Every 3 days');
        expect(titlesOn('2026-11-13')).toContain('Every 3 days');
        expect(titlesOn('2026-11-16')).toContain('Every 3 days');
        expect(titlesOn('2026-11-15')).not.toContain('Every 3 days');
        expect(titlesOn('2026-11-09')).not.toContain('Every 3 days');
    });

    it('a virtual occurrence takes its fields from the routine and the deterministic id', () => {
        const [item] = view({ tasks: [], routines: [routines[0]] }, '2026-11-15').tasks;
        expect(item).toEqual({
            id: createVirtualRoutineTaskId(R_DAILY, '2026-11-15'),
            title: 'Daily',
            status: 'open',
            date: '2026-11-15',
            scheduled_start: '07:00',
            section: 'Morning',
            estimated_minutes: 10,
            actual_minutes: 0,
            is_routine: true,
            is_virtual: true,
        });
    });
});

describe('buildDayView: suppression', () => {
    const daily = routine({ id: R_DAILY, title: 'Daily' });
    const date = '2026-11-15';

    it('a stored row with the deterministic id replaces the occurrence', () => {
        const stored = task({ id: createVirtualRoutineTaskId(R_DAILY, date), title: 'Daily', status: 'done', actualMinutes: 12, routineId: R_DAILY });
        const result = view({ tasks: [stored], routines: [daily] }, date);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]).toMatchObject({ status: 'done', is_virtual: false, is_routine: true, actual_minutes: 12 });
    });

    it('a stored row with the routine id and the date replaces it, whatever its own id', () => {
        const stored = task({ id: uuid(50), title: 'Renamed occurrence', routineId: R_DAILY, status: 'in_progress' });
        const result = view({ tasks: [stored], routines: [daily] }, date);
        expect(result.tasks.map((item) => item.title)).toEqual(['Renamed occurrence']);
    });

    it('a stored row with the deterministic id suppresses even without a routine id', () => {
        const stored = task({ id: createVirtualRoutineTaskId(R_DAILY, date), title: 'Detached' });
        expect(view({ tasks: [stored], routines: [daily] }, date).tasks.map((item) => item.title)).toEqual(['Detached']);
    });

    it('a skipped tombstone hides the occurrence and is not listed itself', () => {
        const tombstone = task({ id: createVirtualRoutineTaskId(R_DAILY, date), title: 'Daily', status: 'skipped', routineId: R_DAILY });
        const result = view({ tasks: [tombstone], routines: [daily] }, date);
        expect(result.tasks).toEqual([]);
        expect(result.summary.total).toBe(0);
        expect(result.hidden_shared_count).toBe(0);
    });

    it('a skipped ordinary task is not listed', () => {
        const result = view({ tasks: [task({ id: uuid(51), status: 'skipped' }), task({ id: uuid(52), title: 'Kept' })], routines: [] }, date);
        expect(result.tasks.map((item) => item.title)).toEqual(['Kept']);
    });

    it('an inactive routine produces nothing', () => {
        expect(view({ tasks: [], routines: [routine({ id: R_DAILY, active: false })] }, date).tasks).toEqual([]);
    });
});

describe('buildDayView: shared-project rows are counted, never listed', () => {
    const date = '2026-11-15';

    it('counts an out-of-scope stored task and leaves it out of the list and the summary', () => {
        const result = view(
            {
                tasks: [task({ id: uuid(60), title: 'Mine' }), task({ id: uuid(61), title: 'SHARED-SECRET', estimatedMinutes: 99 })],
                routines: [],
                shared: [uuid(61)],
            },
            date
        );
        expect(result.tasks.map((item) => item.title)).toEqual(['Mine']);
        expect(result.hidden_shared_count).toBe(1);
        expect(result.summary).toMatchObject({ total: 1, estimated_minutes_total: 15 });
        expect(JSON.stringify(result)).not.toContain('SHARED-SECRET');
    });

    it('counts the occurrence of an out-of-scope routine', () => {
        const result = view({ tasks: [], routines: [routine({ id: R_DAILY, title: 'SHARED-ROUTINE' })], shared: [R_DAILY] }, date);
        expect(result.tasks).toEqual([]);
        expect(result.hidden_shared_count).toBe(1);
    });

    it('an out-of-scope stored row still suppresses its routine occurrence', () => {
        const stored = task({ id: uuid(62), routineId: R_DAILY, title: 'x' });
        const result = view({ tasks: [stored], routines: [routine({ id: R_DAILY, title: 'Daily' })], shared: [uuid(62)] }, date);
        expect(result.tasks).toEqual([]);
        expect(result.hidden_shared_count).toBe(1);
    });

    it('a skipped out-of-scope row is not counted', () => {
        const result = view({ tasks: [task({ id: uuid(63), status: 'skipped' })], routines: [], shared: [uuid(63)] }, date);
        expect(result.hidden_shared_count).toBe(0);
    });
});

describe('buildDayView: order, sections and limits', () => {
    const date = '2026-11-15';

    it('sorts by section start, then start time (untimed last), then order, then id', () => {
        const result = view(
            {
                tasks: [
                    task({ id: uuid(70), title: 'evening', sectionId: EVENING, order: 1 }),
                    task({ id: uuid(71), title: 'morning untimed b', sectionId: MORNING, order: 5 }),
                    task({ id: uuid(72), title: 'morning 09:00', sectionId: MORNING, scheduledStart: '09:00', order: 9 }),
                    task({ id: uuid(73), title: 'morning untimed a', sectionId: MORNING, order: 2 }),
                    task({ id: uuid(74), title: 'morning 06:30', sectionId: MORNING, scheduledStart: '06:30', order: 9 }),
                    task({ id: uuid(75), title: 'afternoon', sectionId: AFTERNOON, order: 1 }),
                    task({ id: uuid(77), title: 'no section', sectionId: '', order: 0 }),
                    task({ id: uuid(76), title: 'morning untimed a2', sectionId: MORNING, order: 2 }),
                ],
                routines: [],
            },
            date
        );
        expect(result.tasks.map((item) => item.title)).toEqual([
            'morning 06:30',
            'morning 09:00',
            'morning untimed a',
            'morning untimed a2',
            'morning untimed b',
            'afternoon',
            'evening',
            'no section',
        ]);
    });

    it('keeps a task that has no section (all-day tasks from schedule intake)', () => {
        const result = view({ tasks: [task({ id: uuid(80), title: 'All day', sectionId: '' })], routines: [] }, date);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0]).toMatchObject({ title: 'All day', section: null });
    });

    it('does not put done tasks first', () => {
        const result = view(
            {
                tasks: [
                    task({ id: uuid(81), title: 'open early', scheduledStart: '07:00' }),
                    task({ id: uuid(82), title: 'done late', scheduledStart: '08:00', status: 'done' }),
                ],
                routines: [],
            },
            date
        );
        expect(result.tasks.map((item) => item.title)).toEqual(['open early', 'done late']);
    });

    it('summarises every visible task', () => {
        const result = view(
            {
                tasks: [
                    task({ id: uuid(83), status: 'done', estimatedMinutes: 30, actualMinutes: 32 }),
                    task({ id: uuid(84), status: 'in_progress', estimatedMinutes: 20, actualMinutes: 5 }),
                    task({ id: uuid(85), status: 'open', estimatedMinutes: 15 }),
                ],
                routines: [routine({ id: R_DAILY, estimatedMinutes: 10 })],
            },
            date
        );
        expect(result.summary).toEqual({
            total: 4,
            open: 2,
            in_progress: 1,
            done: 1,
            estimated_minutes_total: 75,
            estimated_minutes_remaining: 45,
            actual_minutes_total: 37,
        });
    });

    it('caps the list at 100 and says so; the summary still counts all', () => {
        const tasks = Array.from({ length: MCP_DAY_VIEW_LIMIT + 5 }, (_, index) => task({ id: uuid(1000 + index), order: index }));
        const result = view({ tasks, routines: [] }, date);
        expect(result.tasks).toHaveLength(100);
        expect(result.truncated).toBe(true);
        expect(result.summary.total).toBe(105);
        expect(view({ tasks: tasks.slice(0, 100), routines: [] }, date).truncated).toBe(false);
    });

    it('reports truncation when the snapshot itself was cut', () => {
        const snapshot = { ...toSnapshot({ tasks: [task({ id: uuid(90) })], routines: [] }, date), tasks_truncated: true };
        expect(buildDayView({ snapshot, date }).truncated).toBe(true);
    });

    it('passes daily goals through with id, title and status only', () => {
        const snapshot = toSnapshot({ tasks: [], routines: [] }, date);
        snapshot.goals = [{ id: uuid(95), title: 'Goal', status: 'open' }];
        expect(buildDayView({ snapshot, date }).daily_goals).toEqual([{ id: uuid(95), title: 'Goal', status: 'open' }]);
    });

    it('exposes only the contract fields', () => {
        const result = view({ tasks: [task({ id: uuid(96), memo: 'MEMO-MARKER', tags: ['t'], projectId: uuid(97) })], routines: [] }, date);
        expect(Object.keys(result.tasks[0]).sort()).toEqual([
            'actual_minutes',
            'date',
            'estimated_minutes',
            'id',
            'is_routine',
            'is_virtual',
            'scheduled_start',
            'section',
            'status',
            'title',
        ]);
        expect(JSON.stringify(result)).not.toContain('MEMO-MARKER');
    });
});

describe('buildDayView: parity with the app store (getMergedTasks)', () => {
    const dayOf = (date: string) => createVirtualRoutineTaskId(R_DAILY, date);

    const fixture: Fixture = {
        tasks: [
            task({ id: uuid(200), title: 'Plain open', scheduledStart: '10:00', order: 2 }),
            task({ id: uuid(201), title: 'Plain done', status: 'done', actualMinutes: 20, sectionId: AFTERNOON }),
            task({ id: uuid(202), title: 'In progress', status: 'in_progress', sectionId: EVENING, actualMinutes: 3 }),
            task({ id: uuid(203), title: 'Deleted', status: 'skipped' }),
            task({ id: uuid(204), title: 'No section', sectionId: '' }),
            task({ id: uuid(205), title: 'Other day', date: '2026-11-16' }),
            // Materialised occurrence of the daily routine on the 15th.
            task({ id: dayOf('2026-11-15'), title: 'Daily', status: 'done', routineId: R_DAILY, actualMinutes: 9 }),
            // Tombstone of the weekly routine on Monday the 16th.
            task({ id: createVirtualRoutineTaskId(R_WEEKLY, '2026-11-16'), title: 'Weekly', status: 'skipped', routineId: R_WEEKLY, date: '2026-11-16' }),
            // Occurrence of the custom routine detached to its own id on the 13th.
            task({ id: uuid(206), title: 'Custom, edited', routineId: R_CUSTOM, date: '2026-11-13', scheduledStart: '15:25' }),
        ],
        routines: [
            routine({ id: R_DAILY, title: 'Daily', startTime: '07:00' }),
            routine({ id: R_WEEKLY, title: 'Weekly', frequency: 'weekly', daysOfWeek: [1, 3], sectionId: AFTERNOON, startTime: '14:00' }),
            routine({ id: R_MONTHLY, title: 'Monthly', frequency: 'monthly', startDate: '2026-01-31', nextRun: '2026-01-31', sectionId: EVENING }),
            routine({ id: R_CUSTOM, title: 'Every 3 days', frequency: 'custom', interval: 3, startDate: '2026-11-10', nextRun: '2026-11-10' }),
            routine({ id: R_WEEKLY_NO_DAYS, title: 'Thursdays', frequency: 'weekly', sectionId: '' }),
            routine({ id: uuid(106), title: 'Inactive', active: false }),
            routine({ id: uuid(107), title: 'Starts later', startDate: '2026-11-17', nextRun: '2026-11-17' }),
        ],
    };

    const dates = [
        '2026-11-09',
        '2026-11-10',
        '2026-11-12',
        '2026-11-13',
        '2026-11-14',
        '2026-11-15',
        '2026-11-16',
        '2026-11-17',
        '2026-11-18',
        '2026-11-19',
        '2026-11-30',
        '2026-12-31',
        '2027-02-28',
        '2025-12-31',
    ];

    it.each(dates)('lists the same items as the store on %s', (date) => {
        const expected = fromStore(storeMergedTasks(fixture, date));
        const actual = comparable(view(fixture, date).tasks);
        expect(actual).toEqual(expected);
    });

    it('the fixtures exercise virtual, stored, suppressed and skipped items', () => {
        const all = dates.flatMap((date) => view(fixture, date).tasks);
        expect(all.some((item) => item.is_virtual)).toBe(true);
        expect(all.some((item) => !item.is_virtual && item.is_routine)).toBe(true);
        expect(all.some((item) => item.section === null)).toBe(true);
        expect(all.some((item) => item.title === 'Deleted')).toBe(false);
        // The 16th: the weekly occurrence is tombstoned, the daily one is virtual.
        expect(view(fixture, '2026-11-16').tasks.map((item) => item.title).sort()).toEqual(['Daily', 'Every 3 days', 'Other day']);
    });

    it('gives a new virtual occurrence the same order as the store', () => {
        // Not part of the contract, but the tie-break of the sort depends on it.
        const store = storeMergedTasks(fixture, '2026-11-19');
        const fromView = view(fixture, '2026-11-19').tasks.map((item) => item.id);
        const storeOrder = [...store]
            .filter((entry) => entry.sectionId === MORNING && !entry.scheduledStart)
            .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
            .map((entry) => entry.id);
        expect(fromView.filter((id) => storeOrder.includes(id))).toEqual(storeOrder);
    });

    it('differs from the store only by hiding shared-project rows', () => {
        const shared = [uuid(200), R_MONTHLY];
        const date = '2026-11-30';
        const withShared = view({ ...fixture, tasks: [...fixture.tasks, task({ id: uuid(210), title: 'On the 30th', date })], shared: [...shared, uuid(210)] }, date);
        const store = fromStore(storeMergedTasks({ ...fixture, tasks: [...fixture.tasks, task({ id: uuid(210), title: 'On the 30th', date })] }, date));
        const hiddenIds = new Set([uuid(210), createVirtualRoutineTaskId(R_MONTHLY, date)]);
        expect(comparable(withShared.tasks)).toEqual(store.filter((item) => !hiddenIds.has(item.id)));
        expect(withShared.hidden_shared_count).toBe(2);
    });
});
