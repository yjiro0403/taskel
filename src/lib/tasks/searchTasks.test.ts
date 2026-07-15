import { describe, expect, it } from 'vitest';

import type { Task } from '@/types';
import { searchTasks } from './searchTasks';

function makeTask(partial: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
    return {
        userId: 'user-1',
        sectionId: 'section-1',
        date: '2026-07-01',
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: 0,
        ...partial,
    };
}

const tasks: Task[] = [
    makeTask({
        id: '1',
        title: '企画書を書く',
        memo: 'クライアントA向け。成果は売上10%改善',
        date: '2026-07-01',
        status: 'done',
    }),
    makeTask({
        id: '2',
        title: 'MTG: 週次レビュー',
        memo: '進捗確認のみ',
        date: '2026-07-05',
        status: 'skipped',
    }),
    makeTask({
        id: '3',
        title: 'バックログの整理',
        memo: '未着手のアイデアを棚卸し',
        date: '',
        status: 'open',
    }),
    makeTask({
        id: '4',
        title: 'コードレビュー',
        memo: 'PR #42 の成果を確認',
        date: '2026-06-15',
        status: 'done',
    }),
];

describe('searchTasks', () => {
    it('returns empty when query and date range are empty', () => {
        expect(searchTasks(tasks, { query: '' })).toEqual([]);
        expect(searchTasks(tasks, { query: '   ' })).toEqual([]);
    });

    it('matches title (case-insensitive)', () => {
        const results = searchTasks(tasks, { query: 'mtg' });
        expect(results.map((r) => r.task.id)).toEqual(['2']);
        expect(results[0].matchedIn).toContain('title');
    });

    it('matches memo and returns a snippet', () => {
        const results = searchTasks(tasks, { query: '売上' });
        expect(results).toHaveLength(1);
        expect(results[0].task.id).toBe('1');
        expect(results[0].matchedIn).toContain('memo');
        expect(results[0].memoSnippet).toContain('売上');
    });

    it('supports multi-word AND across title and memo', () => {
        const results = searchTasks(tasks, { query: '企画 成果' });
        expect(results.map((r) => r.task.id)).toEqual(['1']);
    });

    it('requires all tokens (AND)', () => {
        const results = searchTasks(tasks, { query: '企画 存在しない語' });
        expect(results).toHaveLength(0);
    });

    it('includes done / skipped / undated tasks', () => {
        const byMemo = searchTasks(tasks, { query: '成果' });
        expect(byMemo.map((r) => r.task.id).sort()).toEqual(['1', '4']);

        const undated = searchTasks(tasks, { query: 'バックログ' });
        expect(undated.map((r) => r.task.id)).toEqual(['3']);

        const skipped = searchTasks(tasks, { query: '週次' });
        expect(skipped[0].task.status).toBe('skipped');
    });

    it('filters by date range and excludes undated by default', () => {
        const results = searchTasks(tasks, {
            query: '',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
        });
        expect(results.map((r) => r.task.id).sort()).toEqual(['1', '2']);
    });

    it('includes undated when includeUndated is true with date range', () => {
        const results = searchTasks(tasks, {
            query: '整理',
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
            includeUndated: true,
        });
        expect(results.map((r) => r.task.id)).toEqual(['3']);
    });

    it('sorts dated results newest first, undated last', () => {
        const multi = searchTasks(tasks, {
            query: '',
            dateFrom: '2026-01-01',
            dateTo: '2026-12-31',
            includeUndated: true,
        });
        expect(multi.map((r) => r.task.id)).toEqual(['2', '1', '4', '3']);
    });

    it('respects limit', () => {
        const results = searchTasks(tasks, {
            query: '',
            dateFrom: '2020-01-01',
            dateTo: '2030-01-01',
            includeUndated: true,
            limit: 2,
        });
        expect(results).toHaveLength(2);
    });
});
