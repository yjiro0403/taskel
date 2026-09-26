'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { financeRangeKey } from '@/lib/finance/cache';
import { formatSignedYen } from '@/lib/finance/format';
import { useStore } from '@/store/useStore';
import { FinanceBreakdownModal } from './FinanceBreakdownModal';

interface FinancePeriodSummaryProps {
    start: string;
    end: string;
}

export function FinancePeriodSummary({ start, end }: FinancePeriodSummaryProps) {
    const t = useTranslations('Finance');
    const locale = useLocale();
    const financeEnabled = useStore((state) => state.financeEnabled);
    const ensureFinanceSummary = useStore((state) => state.ensureFinanceSummary);
    const summaryRevision = useStore((state) => state.financeSummaryRevision);
    const summary = useStore((state) => state.financeSummaryCache[financeRangeKey(start, end)]);
    const loading = useStore((state) => state.financeSummaryLoading[financeRangeKey(start, end)]);
    const error = useStore((state) => state.financeSummaryError[financeRangeKey(start, end)]);
    const [breakdownOpen, setBreakdownOpen] = useState(false);

    // summaryRevision changes after a task's income/expense is saved. The date
    // range does not, so without this dependency the header would keep the old total.
    useEffect(() => {
        if (!financeEnabled) {
            return;
        }
        void ensureFinanceSummary(start, end);
    }, [financeEnabled, start, end, summaryRevision, ensureFinanceSummary]);

    if (!financeEnabled) {
        return null;
    }

    const summaryAriaLabel = loading && !summary
        ? t('summaryLoading')
        : error && !summary
            ? t('summaryRetryAria')
            : t('summaryAria', {
                expense: formatSignedYen(summary?.expenseTotal ?? 0, 'expense', locale),
                income: formatSignedYen(summary?.incomeTotal ?? 0, 'income', locale),
            });

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    if (error) {
                        void ensureFinanceSummary(start, end);
                    }
                    setBreakdownOpen(true);
                }}
                className="flex max-w-full flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label={summaryAriaLabel}
            >
                {loading && !summary ? (
                    <span className="text-xs text-gray-500">{t('summaryLoading')}</span>
                ) : error && !summary ? (
                    <span className="text-xs text-red-600">{t('summaryError')}</span>
                ) : (
                    <>
                        <span className="text-xs font-medium text-gray-700">
                            {t('expense')} {formatSignedYen(summary?.expenseTotal ?? 0, 'expense', locale)}
                        </span>
                        <span className="text-gray-300" aria-hidden="true">
                            |
                        </span>
                        <span className="text-xs font-medium text-gray-700">
                            {t('income')} {formatSignedYen(summary?.incomeTotal ?? 0, 'income', locale)}
                        </span>
                    </>
                )}
            </button>
            <FinanceBreakdownModal
                isOpen={breakdownOpen}
                start={start}
                end={end}
                onClose={() => setBreakdownOpen(false)}
            />
        </>
    );
}
