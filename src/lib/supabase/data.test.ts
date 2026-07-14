import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
    buildTaskInsertPayload,
    buildTaskPageRanges,
    buildTaskUpdatePayload,
    fetchTasks,
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
