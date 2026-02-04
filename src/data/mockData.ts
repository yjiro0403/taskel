import { Task, Section } from '@/types';

export const mockSections: Section[] = [
    { id: 'section-1', userId: 'user-1', name: 'Morning (Start ~ 9:00)', order: 0 },
    { id: 'section-2', userId: 'user-1', name: 'Work (9:00 ~ 12:00)', order: 1 },
    { id: 'section-3', userId: 'user-1', name: 'Afternoon (13:00 ~ 18:00)', order: 2 },
];

export const mockTasks: Task[] = [
    {
        id: 'task-1',
        userId: 'user-1',
        title: 'Check emails',
        sectionId: 'section-1',
        date: '2024-01-01',
        status: 'done',
        estimatedMinutes: 15,
        actualMinutes: 10,
        order: 0,
        completedAt: 1704067200000, // Fixed timestamp
    },
    {
        id: 'task-2',
        userId: 'user-1',
        title: 'Morning Meeting',
        sectionId: 'section-1',
        date: '2024-01-01',
        status: 'in_progress',
        estimatedMinutes: 30,
        actualMinutes: 5,
        startedAt: 1704070800000, // Fixed timestamp
        order: 1,
    },
    {
        id: 'task-3',
        userId: 'user-1',
        title: 'Write Report',
        sectionId: 'section-2',
        date: '2024-01-01',
        status: 'open',
        estimatedMinutes: 60,
        actualMinutes: 0,
        order: 0,
    },
];
