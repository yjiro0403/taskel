import { describe, expect, it } from 'vitest';

import type { FinanceEntry } from '../finance/types';
import type { Project, Task } from '../../types';
import {
    aggregateByProject,
    aggregateByTag,
    aggregateFinanceByCategory,
    aggregateFinanceByProject,
    computeVariance,
    tasksForTag,
} from './aggregate';
import { UNCATEGORIZED_ID, UNCATEGORIZED_TAG } from './types';

function task(partial: Partial<Task> & Pick<Task, 'id'>): Task {
    return {
        userId: 'u1',
        title: partial.title ?? partial.id,
        sectionId: 's1',
        date: '2026-09-19',
        status: 'done',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: 0,
        ...partial,
    };
}

const projects: Project[] = [
    {
        id: 'p-a',
        userId: 'u1',
        title: 'Project A',
        description: '',
        ownerId: 'u1',
        memberIds: ['u1'],
        status: 'active',
        expectedMinutes: 3600,
        createdAt: 1,
        updatedAt: 1,
    },
    {
        id: 'p-b',
        userId: 'u1',
        title: 'Project B',
        description: '',
        ownerId: 'u1',
        memberIds: ['u1'],
        status: 'active',
        expectedMinutes: 3000,
        createdAt: 1,
        updatedAt: 1,
    },
];

describe('analytics aggregation', () => {
    it('sums actual minutes per project and keeps zero-time projects', () => {
        const rows = aggregateByProject(
            [
                task({ id: 't1', projectId: 'p-a', actualMinutes: 90 }),
                task({ id: 't2', projectId: 'p-a', actualMinutes: 30, status: 'open' }),
                task({ id: 't3', actualMinutes: 15 }),
            ],
            projects
        );

        expect(rows.find((row) => row.id === 'p-a')).toMatchObject({ minutes: 120, taskCount: 2, completedCount: 1 });
        expect(rows.find((row) => row.id === 'p-b')).toMatchObject({ minutes: 0, taskCount: 0 });
        expect(rows.find((row) => row.id === UNCATEGORIZED_ID)).toMatchObject({ minutes: 15, taskCount: 1 });
    });

    it('splits tag time and supports untagged drill-down', () => {
        const tasks = [
            task({ id: 't1', tags: ['meeting'], actualMinutes: 60 }),
            task({ id: 't2', tags: ['meeting', 'client'], actualMinutes: 30 }),
            task({ id: 't3', actualMinutes: 10 }),
        ];
        const rows = aggregateByTag(tasks);
        expect(rows.find((row) => row.id === 'meeting')).toMatchObject({ minutes: 90, taskCount: 2 });
        expect(tasksForTag(tasks, UNCATEGORIZED_TAG).map((item) => item.id)).toEqual(['t3']);
    });

    it('marks a project over expected time', () => {
        expect(computeVariance(3700, 3600)).toMatchObject({ over: true, remaining: -100 });
        expect(computeVariance(100, 3600)).toMatchObject({ over: false, remaining: 3500 });
        expect(computeVariance(10, undefined)).toBeNull();
    });

    it('joins finance entries to projects through task ids', () => {
        const tasks = [
            task({ id: 't1', projectId: 'p-a' }),
            task({ id: 't2', projectId: 'p-b' }),
        ];
        const entries: FinanceEntry[] = [
            {
                id: 'e1',
                userId: 'u1',
                taskId: 't1',
                taskTitleSnapshot: 'Dinner',
                occurredOn: '2026-09-19',
                entryType: 'expense',
                amountYen: 8000,
                categoryId: 'c-food',
                categoryLabelSnapshot: '交際費',
                memo: null,
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'e2',
                userId: 'u1',
                taskId: null,
                taskTitleSnapshot: 'Deleted',
                occurredOn: '2026-09-19',
                entryType: 'expense',
                amountYen: 1200,
                categoryId: 'c-ticket',
                categoryLabelSnapshot: 'チケット代',
                memo: null,
                createdAt: '',
                updatedAt: '',
            },
        ];

        const byProject = aggregateFinanceByProject(entries, tasks, projects);
        expect(byProject.find((row) => row.id === 'p-a')?.expenseYen).toBe(8000);
        expect(byProject.find((row) => row.id === UNCATEGORIZED_ID)?.expenseYen).toBe(1200);

        const byCategory = aggregateFinanceByCategory(entries);
        expect(byCategory.map((row) => row.label)).toEqual(['交際費', 'チケット代']);
    });
});
