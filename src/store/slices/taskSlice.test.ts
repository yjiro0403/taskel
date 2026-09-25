import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '../../types';
import type { StoreState } from '../types';
import { createTaskSlice } from './taskSlice';

vi.mock('../../lib/supabase/repositories/taskRepository', () => ({
    createTaskRecord: vi.fn(),
    updateTaskRecord: vi.fn(),
    replaceTaskRecord: vi.fn(),
    deleteTaskRecord: vi.fn(),
    bulkCreateTaskRecords: vi.fn(),
    bulkUpdateTaskOrderRecords: vi.fn(),
}));

import { createTaskRecord, deleteTaskRecord, replaceTaskRecord } from '../../lib/supabase/repositories/taskRepository';

const mockedCreate = vi.mocked(createTaskRecord);
const mockedReplace = vi.mocked(replaceTaskRecord);
const mockedDelete = vi.mocked(deleteTaskRecord);

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        userId: 'user-1',
        title: 'Saved task',
        sectionId: 'section-1',
        date: '2026-09-15',
        status: 'open',
        estimatedMinutes: 15,
        actualMinutes: 0,
        order: 1,
        ...overrides,
    };
}

function createHarness(overrides: Partial<StoreState> = {}) {
    const state = {
        user: { uid: 'user-1' },
        currentDate: '2026-09-15',
        showToast: vi.fn(),
        routines: [],
    } as unknown as StoreState;

    const set = ((partial: unknown) => {
        const next = typeof partial === 'function' ? (partial as (current: StoreState) => object)(state) : partial;
        Object.assign(state, next);
    }) as never;

    const get = () => state;
    const slice = createTaskSlice(set, get, {} as never);
    Object.assign(state, slice, { tasksLoaded: true, ...overrides });
    return { state, slice };
}

describe('taskSlice persistence ids and retries', () => {
    afterEach(() => {
        vi.clearAllMocks();
        mockedCreate.mockReset();
        mockedReplace.mockReset();
        mockedDelete.mockReset();
        vi.unstubAllGlobals();
    });

    it('does not append a duplicate or delete a persisted task when addTask is retried and fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const existing = task();
        const { state, slice } = createHarness({ tasks: [existing] } as Partial<StoreState>);
        mockedCreate.mockRejectedValueOnce(new Error('network'));

        const result = await slice.addTask(task({ title: 'Retry title' }));

        expect(result).toEqual({ ok: false });
        expect(state.tasks.filter((entry) => entry.id === 'task-1')).toHaveLength(1);
        expect(state.tasks[0]).toEqual(existing);
        expect(state.showToast).toHaveBeenCalled();
    });

    it('returns the detached UUID when a routine occurrence is date-moved', async () => {
        vi.stubGlobal('crypto', {
            ...crypto,
            randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        });
        mockedCreate.mockResolvedValue(undefined);
        mockedReplace.mockResolvedValue(undefined);
        mockedDelete.mockResolvedValue(undefined);

        const occurrence = task({
            id: 'materialized-1',
            routineId: 'routine-1',
            date: '2026-09-15',
            title: 'Morning run',
        });
        const { slice } = createHarness({ tasks: [occurrence] } as Partial<StoreState>);

        const result = await slice.updateTask('materialized-1', { date: '2026-09-16' });

        expect(result).toEqual({
            ok: true,
            persistedId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        });
        expect(result.ok && result.persistedId).not.toBe('materialized-1');
        expect(mockedCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                date: '2026-09-16',
            }),
            'user-1'
        );
    });

    it('returns the same id for a normal in-place update', async () => {
        const { slice } = createHarness({ tasks: [task()] } as Partial<StoreState>);
        const { updateTaskRecord } = await import('../../lib/supabase/repositories/taskRepository');
        vi.mocked(updateTaskRecord).mockResolvedValue(undefined);

        await expect(slice.updateTask('task-1', { title: 'Renamed' })).resolves.toEqual({
            ok: true,
            persistedId: 'task-1',
        });
    });
});

describe('timeline play through the real updateTask path', () => {
    afterEach(() => {
        vi.clearAllMocks();
        mockedCreate.mockReset();
        mockedReplace.mockReset();
        mockedDelete.mockReset();
    });

    it('persists the real start time together with the running status for a stored task', async () => {
        const { buildTimelinePlayUpdate } = await import('../../lib/timeline/actuals');
        const { updateTaskRecord } = await import('../../lib/supabase/repositories/taskRepository');
        vi.mocked(updateTaskRecord).mockResolvedValue(undefined);
        const planned = task({ scheduledStart: '17:00' });
        const { state, slice } = createHarness({ tasks: [planned] } as Partial<StoreState>);

        const now = new Date(2026, 8, 15, 15, 25);
        await slice.updateTask('task-1', buildTimelinePlayUpdate(planned, now, []));

        expect(state.tasks[0]).toEqual(expect.objectContaining({ status: 'in_progress', scheduledStart: '15:25', startedAt: now.getTime() }));
        expect(vi.mocked(updateTaskRecord)).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({ status: 'in_progress', scheduledStart: '15:25', startedAt: now.getTime() }),
            'user-1'
        );
    });

    it('materializes a routine occurrence with the real start time when it is started from the timeline', async () => {
        const { buildTimelinePlayUpdate } = await import('../../lib/timeline/actuals');
        const { createVirtualRoutineTaskId } = await import('../../lib/tasks/virtualTask');
        mockedReplace.mockResolvedValue(undefined);
        const routine = {
            id: 'routine-1',
            userId: 'user-1',
            title: '案件の返信',
            frequency: 'daily',
            startDate: '2026-09-01',
            nextRun: '2026-09-01',
            startTime: '17:00',
            sectionId: 'section-1',
            estimatedMinutes: 15,
            active: true,
        };
        // The week view starts occurrences on days other than the selected one.
        const { state, slice } = createHarness({ tasks: [], routines: [routine], currentDate: '2026-09-20' } as unknown as Partial<StoreState>);
        const virtualId = createVirtualRoutineTaskId('routine-1', '2026-09-15');
        const virtualTask = slice.getMergedTasks('2026-09-15').find((entry) => entry.id === virtualId);
        expect(virtualTask?.isVirtual).toBe(true);
        expect(virtualTask?.scheduledStart).toBe('17:00');

        const now = new Date(2026, 8, 15, 15, 25);
        const result = await slice.updateTask(virtualId, buildTimelinePlayUpdate(virtualTask!, now, []), { occurrenceDate: '2026-09-15' });
        expect(result).toEqual({ ok: true, persistedId: virtualId });

        expect(mockedReplace).toHaveBeenCalledWith(
            expect.objectContaining({ id: virtualId, status: 'in_progress', scheduledStart: '15:25', startedAt: now.getTime() }),
            'user-1'
        );
        const merged = slice.getMergedTasks('2026-09-15').filter((entry) => entry.title === '案件の返信');
        expect(merged).toHaveLength(1);
        // The local copy keeps isVirtual until the stored row replaces it; what matters is the real start time.
        expect(merged[0]).toEqual(expect.objectContaining({ id: virtualId, scheduledStart: '15:25', status: 'in_progress', startedAt: now.getTime() }));
        expect(state.tasks.some((entry) => entry.id === virtualId)).toBe(true);
    });
});
