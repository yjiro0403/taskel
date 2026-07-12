import { describe, expect, it } from 'vitest';

import { buildTaskInsertPayload, buildTaskUpdatePayload } from './data';
import type { Task } from '../../types';

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
