import type { Meta, StoryObj } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';

import jaMessages from '@/messages/ja.json';
import type { FinanceCategory, FinanceDraftRow, FinanceEntry } from '@/lib/finance/types';
import { useStore } from '@/store/useStore';

import { FinanceBreakdownModal } from './FinanceBreakdownModal';
import { FinanceRowsEditor } from './FinanceRowsEditor';

const categories: FinanceCategory[] = [
    {
        id: 'category-food',
        userId: 'user-1',
        label: '飲み会代',
        normalizedLabel: '飲み会代',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
    },
    {
        id: 'category-transit',
        userId: 'user-1',
        label: '移動費',
        normalizedLabel: '移動費',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
    },
    {
        id: 'category-repayment',
        userId: 'user-1',
        label: '立替精算',
        normalizedLabel: '立替精算',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
    },
];

const initialRows: FinanceDraftRow[] = [
    {
        clientId: 'row-expense',
        entryType: 'expense',
        categoryLabel: '飲み会代',
        amountInput: '20000',
        memo: '3人分をカードで立替',
    },
    {
        clientId: 'row-income',
        entryType: 'income',
        categoryLabel: '立替精算',
        amountInput: '10000',
        memo: '友人から受取',
    },
];

const breakdownEntries: FinanceEntry[] = [
    {
        id: 'entry-1',
        userId: 'user-1',
        taskId: 'task-1',
        taskTitleSnapshot: '友人と飲み会',
        occurredOn: '2026-09-15',
        entryType: 'expense',
        amountYen: 20000,
        categoryId: 'category-food',
        categoryLabelSnapshot: '飲み会代',
        memo: '3人分をカードで立替',
        createdAt: '2026-09-15T10:00:00.000Z',
        updatedAt: '2026-09-15T10:00:00.000Z',
    },
    {
        id: 'entry-2',
        userId: 'user-1',
        taskId: 'task-1',
        taskTitleSnapshot: '友人と飲み会',
        occurredOn: '2026-09-15',
        entryType: 'income',
        amountYen: 10000,
        categoryId: 'category-repayment',
        categoryLabelSnapshot: '立替精算',
        memo: '友人から受取',
        createdAt: '2026-09-15T10:05:00.000Z',
        updatedAt: '2026-09-15T10:05:00.000Z',
    },
    {
        id: 'entry-3',
        userId: 'user-1',
        taskId: 'task-2',
        taskTitleSnapshot: '会場へ移動',
        occurredOn: '2026-09-15',
        entryType: 'expense',
        amountYen: 1000,
        categoryId: 'category-transit',
        categoryLabelSnapshot: '移動費',
        memo: null,
        createdAt: '2026-09-15T09:00:00.000Z',
        updatedAt: '2026-09-15T09:00:00.000Z',
    },
];

const meta = {
    title: 'Finance/Money tracking',
    parameters: {
        layout: 'fullscreen',
    },
    decorators: [
        (Story) => (
            <NextIntlClientProvider locale="ja" messages={jaMessages}>
                <Story />
            </NextIntlClientProvider>
        ),
    ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function RowsEditorPreview() {
    const [rows, setRows] = useState(initialRows);
    return (
        <main className="min-h-screen bg-gray-100 p-4 sm:p-8">
            <div className="mx-auto max-w-2xl rounded-xl bg-white p-4 shadow-sm">
                <FinanceRowsEditor
                    rows={rows}
                    categories={categories}
                    occurrenceDate="2026-09-15"
                    onChange={setRows}
                />
            </div>
        </main>
    );
}

function BreakdownPreview() {
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        const previousLoader = useStore.getState().loadFinanceBreakdown;
        useStore.setState({
            loadFinanceBreakdown: async () => breakdownEntries,
        });
        return () => {
            useStore.setState({ loadFinanceBreakdown: previousLoader });
        };
    }, []);

    return (
        <main className="min-h-screen bg-gray-100 p-8">
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white"
            >
                収支の内訳を開く
            </button>
            <FinanceBreakdownModal
                isOpen={isOpen}
                start="2026-09-15"
                end="2026-09-16"
                onClose={() => setIsOpen(false)}
            />
        </main>
    );
}

export const RowsEditor: Story = {
    render: () => <RowsEditorPreview />,
};

export const Breakdown: Story = {
    render: () => <BreakdownPreview />,
};
