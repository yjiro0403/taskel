import type { Meta, StoryObj } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';

import jaMessages from '@/messages/ja.json';
import enMessages from '@/messages/en.json';
import { useStore } from '@/store/useStore';
import type { Section, Task } from '@/types';

import NowNextWidget from './NowNextWidget';

const MIN = 60_000;

const sections: Section[] = [
    { id: 'morning', userId: 'user-1', name: '午前', startTime: '06:00', order: 0 },
    { id: 'afternoon', userId: 'user-1', name: '午後', startTime: '13:00', order: 1 },
];

function localDate(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localTime(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let counter = 0;
function task(now: number, overrides: Partial<Task>): Task {
    counter += 1;
    return {
        id: `story-task-${counter}`,
        userId: 'user-1',
        title: `タスク ${counter}`,
        sectionId: 'morning',
        date: localDate(now),
        status: 'open',
        estimatedMinutes: 30,
        actualMinutes: 0,
        order: counter,
        ...overrides,
    };
}

type Scenario = (now: number) => Task[];

const scenarios: Record<string, Scenario> = {
    /** Running task with 18 min left; bus in 3 min → red, seconds ticking, conflict hint. */
    busSoon: (now) => [
        task(now, { title: 'メールの返信をまとめて片付ける', status: 'in_progress', startedAt: now - 12 * MIN, estimatedMinutes: 30 }),
        task(now, { title: 'バスに乗る（駅前 3 番のりば）', scheduledStart: localTime(now + 3 * MIN), estimatedMinutes: 1 }),
        task(now, { title: '昼食', scheduledStart: localTime(now + 120 * MIN), estimatedMinutes: 45 }),
    ],
    /** Overrun current task, next in 40 min → calm. Two more timers running. */
    overrun: (now) => [
        task(now, { title: '設計レビュー', status: 'in_progress', startedAt: now - 45 * MIN, estimatedMinutes: 30 }),
        task(now, { title: 'ログ調査', status: 'in_progress', startedAt: now - 90 * MIN, estimatedMinutes: 60 }),
        task(now, { title: 'コーヒー', status: 'in_progress', startedAt: now - 100 * MIN, estimatedMinutes: 5 }),
        task(now, { title: '1on1', scheduledStart: localTime(now + 40 * MIN), estimatedMinutes: 30 }),
    ],
    /** Nothing running; a scheduled task whose start time has arrived → "今すぐ". */
    dueNow: (now) => [
        task(now, { title: '薬を飲む', scheduledStart: localTime(now - 2 * MIN), estimatedMinutes: 5 }),
        task(now, { title: '買い物', order: 50 }),
    ],
    /** No estimate on the running task; no fixed-time task left → queue fallback. */
    queued: (now) => [
        task(now, { title: '資料づくり', status: 'in_progress', startedAt: now - 7 * MIN, estimatedMinutes: 0 }),
        task(now, { title: '洗濯物を取り込む', order: 1 }),
        task(now, { title: '夕食の準備', sectionId: 'afternoon', order: 2 }),
    ],
    /** Empty day. */
    empty: () => [],
};

function Preview({ scenario, locale }: { scenario: keyof typeof scenarios; locale: 'ja' | 'en' }) {
    // Seed the store before the widget subscribes (lazy initializer runs once per mount).
    useState(() => {
        counter = 0;
        useStore.setState({ tasks: scenarios[scenario](Date.now()), sections, tasksLoaded: true });
        return null;
    });

    useEffect(() => {
        return () => {
            useStore.setState({ tasks: [], sections: [], tasksLoaded: false });
        };
    }, []);

    return (
        <NextIntlClientProvider locale={locale} messages={locale === 'ja' ? jaMessages : enMessages}>
            <main className="min-h-screen bg-gray-50 p-4 sm:p-8">
                <div className="mx-auto max-w-3xl">
                    <NowNextWidget />
                </div>
            </main>
        </NextIntlClientProvider>
    );
}

const meta = {
    title: 'Tasks/Now Next Widget',
    parameters: {
        layout: 'fullscreen',
    },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BusInThreeMinutes: Story = {
    render: () => <Preview scenario="busSoon" locale="ja" />,
};

export const OverrunWithConcurrentTimers: Story = {
    render: () => <Preview scenario="overrun" locale="ja" />,
};

export const DueNow: Story = {
    render: () => <Preview scenario="dueNow" locale="ja" />,
};

export const QueueFallbackNoEstimate: Story = {
    render: () => <Preview scenario="queued" locale="ja" />,
};

export const EmptyDay: Story = {
    render: () => <Preview scenario="empty" locale="ja" />,
};

export const EnglishBusInThreeMinutes: Story = {
    render: () => <Preview scenario="busSoon" locale="en" />,
};
