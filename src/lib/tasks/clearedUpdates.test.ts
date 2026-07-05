import { describe, it, expect } from 'vitest';

import { withClearedNullables } from './clearedUpdates';

describe('withClearedNullables', () => {
    it('nullable フィールドの明示的 undefined は null に変換する', () => {
        const result = withClearedNullables({ assignedWeek: undefined, assignedMonth: undefined });
        expect(result.assignedWeek).toBeNull();
        expect(result.assignedMonth).toBeNull();
    });

    it('NOT NULL 列（date）の undefined は変換しない（NOT NULL 違反を防ぐ）', () => {
        const result = withClearedNullables({ date: undefined });
        // date は変換されず undefined のまま（＝更新から省略される）
        expect(result.date).toBeUndefined();
    });

    it('NOT NULL 列（title/sectionId/status/order）は変換しない', () => {
        const result = withClearedNullables({
            title: undefined,
            sectionId: undefined,
            status: undefined,
            order: undefined,
            estimatedMinutes: undefined,
            actualMinutes: undefined,
        });
        expect(result.title).toBeUndefined();
        expect(result.sectionId).toBeUndefined();
        expect(result.status).toBeUndefined();
        expect(result.order).toBeUndefined();
        expect(result.estimatedMinutes).toBeUndefined();
        expect(result.actualMinutes).toBeUndefined();
    });

    it('timestamp 列（completedAt/startedAt）は変換しない', () => {
        const result = withClearedNullables({ completedAt: undefined, startedAt: undefined });
        expect(result.completedAt).toBeUndefined();
        expect(result.startedAt).toBeUndefined();
    });

    it('値を持つフィールドはそのまま保持する', () => {
        const result = withClearedNullables({ assignedWeek: '2026-W28', status: 'done', date: '2026-07-06' });
        expect(result.assignedWeek).toBe('2026-W28');
        expect(result.status).toBe('done');
        expect(result.date).toBe('2026-07-06');
    });

    it('元の updates を変更しない（コピーを返す）', () => {
        const updates = { assignedWeek: undefined } as const;
        const result = withClearedNullables(updates);
        expect(updates.assignedWeek).toBeUndefined();
        expect(result.assignedWeek).toBeNull();
    });
});
