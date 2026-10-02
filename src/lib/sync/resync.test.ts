import { describe, expect, it } from 'vitest';

import {
    FOREGROUND_RESYNC_MIN_HIDDEN_MS,
    RESYNC_MIN_INTERVAL_MS,
    RESYNC_WATERMARK_OVERLAP_MS,
    RESYNC_WINDOW_DAYS_AFTER,
    RESYNC_WINDOW_DAYS_BEFORE,
    createRealtimeHealth,
    mergeResyncedTasks,
    reconcileMissingTasks,
    replaceWithFullTaskList,
    resyncDateWindow,
    shiftDateString,
    shouldResyncOnVisible,
    taskWatermarkFrom,
    watermarkQueryBound,
} from './resync';

type Row = { id: string; date: string; title: string; updatedAt?: number };

const never = () => false;
const row = (id: string, overrides: Partial<Row> = {}): Row => ({
    id,
    date: '2026-10-02',
    title: id,
    ...overrides,
});

describe('taskWatermarkFrom（差分取得の起点）', () => {
    it('取得した行の最大 updated_at を ISO 文字列で返す', () => {
        const watermark = taskWatermarkFrom(
            [{ updatedAt: Date.parse('2026-10-01T09:00:00.000Z') }, { updatedAt: Date.parse('2026-10-02T03:30:00.000Z') }],
            null
        );
        expect(watermark).toBe('2026-10-02T03:30:00.000Z');
    });

    it('前回の起点より古い行しか無ければ起点を戻さない（単調増加）', () => {
        const previous = '2026-10-02T03:30:00.000Z';
        expect(taskWatermarkFrom([{ updatedAt: Date.parse('2026-09-01T00:00:00.000Z') }], previous)).toBe(previous);
        expect(taskWatermarkFrom([], previous)).toBe(previous);
    });

    it('行も前回の起点も無ければ null（= 次回は全件取得）', () => {
        expect(taskWatermarkFrom([], null)).toBeNull();
        expect(taskWatermarkFrom([{}, { updatedAt: Number.NaN }], null)).toBeNull();
    });

    it('壊れた前回値は無視する', () => {
        expect(taskWatermarkFrom([{ updatedAt: 1_000 }], 'not-a-date')).toBe(new Date(1_000).toISOString());
    });
});

describe('watermarkQueryBound', () => {
    it('重なり幅だけ手前の時刻を返す', () => {
        const watermark = '2026-10-02T03:30:00.000Z';
        expect(Date.parse(watermark) - Date.parse(watermarkQueryBound(watermark))).toBe(RESYNC_WATERMARK_OVERLAP_MS);
    });
});

describe('mergeResyncedTasks（差分の upsert）', () => {
    it('既存は差し替え、新規は追加し、無関係な行はそのまま残す', () => {
        const local = [row('a', { title: 'old a' }), row('b')];
        const merged = mergeResyncedTasks(local, [row('a', { title: 'new a' }), row('c')], never);
        expect(merged.map((task) => task.id)).toEqual(['a', 'b', 'c']);
        expect(merged.find((task) => task.id === 'a')?.title).toBe('new a');
    });

    it('書き込み飛行中（pending）のタスクはローカル版を保つ', () => {
        const local = [row('a', { title: 'optimistic' })];
        const merged = mergeResyncedTasks(local, [row('a', { title: 'server' }), row('p', { title: 'server p' })], (id) =>
            id === 'a' || id === 'p'
        );
        expect(merged).toEqual([row('a', { title: 'optimistic' })]);
    });

    it('差分が空なら同じ配列を返す（再レンダーを起こさない）', () => {
        const local = [row('a')];
        expect(mergeResyncedTasks(local, [], never)).toBe(local);
    });
});

describe('replaceWithFullTaskList（全件取り直し）', () => {
    it('サーバーの一覧へ置き換えつつ pending のローカル行は残す', () => {
        const local = [row('gone'), row('pending-1', { title: 'local' })];
        const replaced = replaceWithFullTaskList(local, [row('a'), row('pending-1', { title: 'server' })], (id) =>
            id === 'pending-1'
        );
        expect(replaced.map((task) => task.id).sort()).toEqual(['a', 'pending-1']);
        expect(replaced.find((task) => task.id === 'pending-1')?.title).toBe('local');
    });
});

describe('reconcileMissingTasks（切断中の削除を落とす）', () => {
    const window = { from: '2026-09-01', to: '2026-10-31' };

    it('窓内でサーバーに無い行だけを削除し、窓外と pending は残す', () => {
        const local = [
            row('kept', { date: '2026-10-02' }),
            row('deleted-elsewhere', { date: '2026-10-02' }),
            row('outside-window', { date: '2026-01-01' }),
            row('pending', { date: '2026-10-02' }),
        ];
        const result = reconcileMissingTasks(local, new Set(['kept']), window, (id) => id === 'pending');
        expect(result.removed).toBe(1);
        expect(result.tasks.map((task) => task.id)).toEqual(['kept', 'outside-window', 'pending']);
    });

    it('窓の境界日は含む', () => {
        const local = [row('from', { date: window.from }), row('to', { date: window.to })];
        expect(reconcileMissingTasks(local, new Set(), window, never).removed).toBe(2);
    });

    it('何も消えなければ同じ配列を返す', () => {
        const local = [row('a')];
        const result = reconcileMissingTasks(local, new Set(['a']), window, never);
        expect(result.removed).toBe(0);
        expect(result.tasks).toBe(local);
    });
});

describe('resyncDateWindow / shiftDateString', () => {
    it('ローカル日付のまま日数をずらす（月末・年末をまたぐ）', () => {
        expect(shiftDateString('2026-01-01', -1)).toBe('2025-12-31');
        expect(shiftDateString('2026-02-28', 1)).toBe('2026-03-01');
        expect(() => shiftDateString('2026/01/01', 1)).toThrow();
    });

    it('今日と表示日付の両方を含む範囲にする', () => {
        const window = resyncDateWindow('2026-10-02', '2026-12-15');
        expect(window.from).toBe(shiftDateString('2026-10-02', -RESYNC_WINDOW_DAYS_BEFORE));
        expect(window.to).toBe(shiftDateString('2026-12-15', RESYNC_WINDOW_DAYS_AFTER));

        const past = resyncDateWindow('2026-10-02', '2026-03-01');
        expect(past.from).toBe(shiftDateString('2026-03-01', -RESYNC_WINDOW_DAYS_BEFORE));
        expect(past.to).toBe(shiftDateString('2026-10-02', RESYNC_WINDOW_DAYS_AFTER));
    });

    it('表示日付が壊れていれば今日だけを基準にする', () => {
        const window = resyncDateWindow('2026-10-02', 'garbage');
        expect(window).toEqual(resyncDateWindow('2026-10-02', undefined));
    });
});

describe('shouldResyncOnVisible（復帰時に取りに行くか）', () => {
    const base = { hiddenForMs: 0, interrupted: false, sinceLastResyncMs: 60_000 };

    it('短い離脱で接続も切れていなければ取りに行かない', () => {
        expect(shouldResyncOnVisible({ ...base, hiddenForMs: FOREGROUND_RESYNC_MIN_HIDDEN_MS - 1 })).toBe(false);
    });

    it('一定時間以上の離脱なら取りに行く', () => {
        expect(shouldResyncOnVisible({ ...base, hiddenForMs: FOREGROUND_RESYNC_MIN_HIDDEN_MS })).toBe(true);
        expect(shouldResyncOnVisible({ ...base, hiddenForMs: Number.POSITIVE_INFINITY })).toBe(true);
    });

    it('Realtime が切れていたなら離脱時間に関係なく取りに行く', () => {
        expect(shouldResyncOnVisible({ ...base, interrupted: true })).toBe(true);
    });

    it('直前に同期したばかりなら見送る', () => {
        expect(
            shouldResyncOnVisible({
                hiddenForMs: Number.POSITIVE_INFINITY,
                interrupted: true,
                sinceLastResyncMs: RESYNC_MIN_INTERVAL_MS - 1,
            })
        ).toBe(false);
    });
});

describe('createRealtimeHealth（切断→再購読の検出）', () => {
    it('初回の SUBSCRIBED は subscribed、切断後の SUBSCRIBED は recovered', () => {
        const health = createRealtimeHealth();
        expect(health.report('tasks', 'SUBSCRIBED')).toBe('subscribed');
        expect(health.interrupted).toBe(false);
        expect(health.report('tasks', 'CHANNEL_ERROR')).toBe('interrupted');
        expect(health.interrupted).toBe(true);
        expect(health.report('tasks', 'SUBSCRIBED')).toBe('recovered');
    });

    it('サーバーに閉じられて張り直したチャンネルも recovered として扱う', () => {
        const health = createRealtimeHealth();
        health.report('tasks', 'SUBSCRIBED');
        health.report('tasks', 'CLOSED');
        expect(health.report('tasks', 'SUBSCRIBED')).toBe('recovered');
    });

    it('settle は全チャンネルが購読中に戻ったときだけ interrupted を下ろす', () => {
        const health = createRealtimeHealth();
        health.report('tasks', 'SUBSCRIBED');
        health.report('tags', 'SUBSCRIBED');
        health.report('tasks', 'TIMED_OUT');
        expect(health.settle()).toBe(false);
        expect(health.interrupted).toBe(true);
        health.report('tasks', 'SUBSCRIBED');
        expect(health.settle()).toBe(true);
        expect(health.interrupted).toBe(false);
    });

    it('forget したキーは次回初回扱いになり、落ちたまま残らない', () => {
        const health = createRealtimeHealth();
        health.report('tasks:projects', 'SUBSCRIBED');
        health.report('tasks:projects', 'CHANNEL_ERROR');
        health.forget('tasks:projects');
        expect(health.allSubscribed()).toBe(true);
        expect(health.report('tasks:projects', 'SUBSCRIBED')).toBe('subscribed');
    });
});
