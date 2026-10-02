import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
    buildTaskInsertPayload,
    buildTaskPageRanges,
    buildTaskUpdatePayload,
    fetchTaskIdsBetween,
    fetchTasks,
    fetchTasksUpdatedSince,
    TASK_FETCH_PAGE_SIZE,
} from './data';
import type { Task } from '../../types';
import type { Database } from '../../types/supabase';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        userId: USER_ID,
        title: 'Write tests',
        sectionId: '33333333-3333-4333-8333-333333333333',
        date: '2026-07-12',
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: 1,
        ...overrides,
    };
}

// scheduled_start は Postgres の time 列。空文字 '' は受け付けられず
// INSERT/UPDATE 全体が落ちるため、永続化境界で null に正規化されることを保証する。
describe('buildTaskInsertPayload: scheduled_start (time 列)', () => {
    it('空文字の scheduledStart は null に正規化する', () => {
        const payload = buildTaskInsertPayload(makeTask({ scheduledStart: '' }), USER_ID);
        expect(payload.scheduled_start).toBeNull();
    });

    it('有効な時刻はそのまま渡す', () => {
        const payload = buildTaskInsertPayload(makeTask({ scheduledStart: '11:30' }), USER_ID);
        expect(payload.scheduled_start).toBe('11:30');
    });

    it('undefined の scheduledStart は null に正規化する', () => {
        const payload = buildTaskInsertPayload(makeTask({ scheduledStart: undefined }), USER_ID);
        expect(payload.scheduled_start).toBeNull();
    });
});

describe('buildTaskUpdatePayload: scheduled_start (time 列)', () => {
    it('空文字の scheduledStart は null（クリア）に正規化する', () => {
        const payload = buildTaskUpdatePayload({ scheduledStart: '' });
        expect(payload.scheduled_start).toBeNull();
    });

    it('undefined の scheduledStart は省略（更新しない）', () => {
        const payload = buildTaskUpdatePayload({ title: 'Renamed' });
        expect(payload.scheduled_start).toBeUndefined();
    });

    it('有効な時刻はそのまま渡す', () => {
        const payload = buildTaskUpdatePayload({ scheduledStart: '09:15' });
        expect(payload.scheduled_start).toBe('09:15');
    });

    it('null（withClearedNullables 経由のクリア）は null のまま渡す', () => {
        const payload = buildTaskUpdatePayload({ scheduledStart: null } as unknown as Partial<Task>);
        expect(payload.scheduled_start).toBeNull();
    });
});

describe('buildTaskPageRanges', () => {
    it('4,508件を1,000件単位の5ページに分割する', () => {
        expect(buildTaskPageRanges(4_508)).toEqual([
            { from: 0, to: 999 },
            { from: 1_000, to: 1_999 },
            { from: 2_000, to: 2_999 },
            { from: 3_000, to: 3_999 },
            { from: 4_000, to: 4_999 },
        ]);
        expect(TASK_FETCH_PAGE_SIZE).toBe(1_000);
    });

    it('0件ではリクエスト範囲を作らない', () => {
        expect(buildTaskPageRanges(0)).toEqual([]);
    });
});

describe('fetchTasks pagination', () => {
    it('先頭ページのcountから残りのrangeを重複なく取得する', async () => {
        const requestedRanges: Array<{ from: number; to: number }> = [];
        const taskRow: Database['public']['Tables']['tasks']['Row'] = {
            id: '22222222-2222-4222-8222-222222222222',
            user_id: USER_ID,
            title: 'Loaded task',
            assignee_id: null,
            reporter_id: null,
            section_id: null,
            date: '2026-07-14',
            status: 'open',
            estimated_minutes: 30,
            actual_minutes: 0,
            started_at: null,
            completed_at: null,
            scheduled_start: null,
            external_link: null,
            parent_goal_id: null,
            project_id: null,
            milestone_id: null,
            routine_id: null,
            assigned_week: null,
            assigned_month: null,
            assigned_year: null,
            assigned_date: null,
            score: null,
            order: 0,
            memo: null,
            checklist: [],
            ai_tags: [],
            ai_status: null,
            ai_error: null,
            ai_completed_at: null,
            comment_count: 0,
            created_at: '2026-07-14T00:00:00.000Z',
            updated_at: '2026-07-14T00:00:00.000Z',
        };
        const firstPage = Array.from({ length: TASK_FETCH_PAGE_SIZE }, () => ({
            ...taskRow,
            task_tags: [],
            attachments: [],
        }));

        const fakeClient = {
            from: () => ({
                select: (_columns: string, options?: { count?: string }) => {
                    const query = {
                        order: () => query,
                        range: async (from: number, to: number) => {
                            requestedRanges.push({ from, to });
                            return {
                                data: from === 0 ? firstPage : [],
                                error: null,
                                count: options?.count === 'exact' ? 2_500 : null,
                            };
                        },
                    };
                    return query;
                },
            }),
        } as unknown as SupabaseClient<Database>;

        await fetchTasks(fakeClient, []);

        expect(requestedRanges).toEqual([
            { from: 0, to: 999 },
            { from: 1_000, to: 1_999 },
            { from: 2_000, to: 2_999 },
        ]);
    });
});

// 追いつき同期（復帰 / 再接続時の差分取得）が投げるクエリの形を固定する。
describe('fetchTasksUpdatedSince（差分取得）', () => {
    const baseRow = {
        id: '22222222-2222-4222-8222-222222222222',
        user_id: USER_ID,
        title: 'Changed on the web',
        assignee_id: null,
        reporter_id: null,
        section_id: null,
        date: '2026-10-02',
        status: 'open' as const,
        estimated_minutes: 30,
        actual_minutes: 0,
        started_at: null,
        completed_at: null,
        scheduled_start: null,
        external_link: null,
        parent_goal_id: null,
        project_id: null,
        milestone_id: null,
        routine_id: null,
        assigned_week: null,
        assigned_month: null,
        assigned_year: null,
        assigned_date: null,
        score: null,
        order: 0,
        memo: null,
        checklist: [],
        ai_tags: [],
        ai_status: null,
        ai_error: null,
        ai_completed_at: null,
        comment_count: 0,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-02T01:00:00.000Z',
        task_tags: [],
        attachments: [],
    };

    function makeClient(rows: unknown[]) {
        const calls: Array<{ method: string; args: unknown[] }> = [];
        const query = {
            select: (...args: unknown[]) => {
                calls.push({ method: 'select', args });
                return query;
            },
            gte: (...args: unknown[]) => {
                calls.push({ method: 'gte', args });
                return query;
            },
            order: (...args: unknown[]) => {
                calls.push({ method: 'order', args });
                return query;
            },
            range: async (...args: unknown[]) => {
                calls.push({ method: 'range', args });
                return { data: rows, error: null };
            },
        };
        const client = { from: () => query } as unknown as SupabaseClient<Database>;
        return { client, calls };
    }

    it('updated_at >= since で 1 ページだけ取り、ページに収まれば complete', async () => {
        const { client, calls } = makeClient([baseRow]);
        const result = await fetchTasksUpdatedSince(client, '2026-10-02T00:58:00.000Z', []);

        expect(calls.find((call) => call.method === 'gte')?.args).toEqual(['updated_at', '2026-10-02T00:58:00.000Z']);
        expect(calls.find((call) => call.method === 'range')?.args).toEqual([0, TASK_FETCH_PAGE_SIZE - 1]);
        expect(result.complete).toBe(true);
        expect(result.tasks).toHaveLength(1);
        expect(result.tasks[0].title).toBe('Changed on the web');
        expect(result.tasks[0].updatedAt).toBe(Date.parse('2026-10-02T01:00:00.000Z'));
    });

    it('ページが満杯なら complete: false（呼び出し側が全件取得へ切り替える）', async () => {
        const { client } = makeClient(Array.from({ length: TASK_FETCH_PAGE_SIZE }, () => baseRow));
        const result = await fetchTasksUpdatedSince(client, '2026-10-02T00:00:00.000Z', []);
        expect(result.complete).toBe(false);
        expect(result.tasks).toHaveLength(TASK_FETCH_PAGE_SIZE);
    });
});

describe('fetchTaskIdsBetween（削除照合用の ID 一覧）', () => {
    function makeClient(total: number) {
        const requestedRanges: Array<{ from: number; to: number }> = [];
        const filters: Array<{ method: string; args: unknown[] }> = [];
        const client = {
            from: () => {
                const query = {
                    select: (_columns: string, options?: { count?: string }) => {
                        const builder = {
                            gte: (...args: unknown[]) => {
                                filters.push({ method: 'gte', args });
                                return builder;
                            },
                            lte: (...args: unknown[]) => {
                                filters.push({ method: 'lte', args });
                                return builder;
                            },
                            order: () => builder,
                            range: async (from: number, to: number) => {
                                requestedRanges.push({ from, to });
                                const ids = [];
                                for (let index = from; index <= Math.min(to, total - 1); index += 1) {
                                    ids.push(`id-${index}`);
                                }
                                return {
                                    data: ids.map((id) => ({ id })),
                                    error: null,
                                    count: options?.count === 'exact' ? total : null,
                                };
                            },
                        };
                        return builder;
                    },
                };
                return query;
            },
        } as unknown as SupabaseClient<Database>;
        return { client, requestedRanges, filters };
    }

    it('date の範囲で絞り、1 ページに収まれば 1 リクエストで返す', async () => {
        const { client, requestedRanges, filters } = makeClient(3);
        const ids = await fetchTaskIdsBetween(client, '2026-09-01', '2026-10-31');
        expect(ids).toEqual(['id-0', 'id-1', 'id-2']);
        expect(requestedRanges).toEqual([{ from: 0, to: TASK_FETCH_PAGE_SIZE - 1 }]);
        expect(filters).toEqual([
            { method: 'gte', args: ['date', '2026-09-01'] },
            { method: 'lte', args: ['date', '2026-10-31'] },
        ]);
    });

    it('1 ページを超えたら count から残りを欠落なく取る', async () => {
        const total = TASK_FETCH_PAGE_SIZE * 2 + 5;
        const { client, requestedRanges } = makeClient(total);
        const ids = await fetchTaskIdsBetween(client, '2026-09-01', '2026-10-31');
        expect(ids).toHaveLength(total);
        expect(new Set(ids).size).toBe(total);
        expect(requestedRanges).toEqual([
            { from: 0, to: 999 },
            { from: 1_000, to: 1_999 },
            { from: 2_000, to: 2_999 },
        ]);
    });
});
