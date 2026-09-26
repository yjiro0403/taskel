'use client';

import { useStore } from '@/store/useStore';

import { FinancePeriodSummary } from './FinancePeriodSummary';

interface FinanceScreenTotalsProps {
    start: string;
    end: string;
}

/** Period total for screens that are not the planning header (standalone week/month/year). */
export function FinanceScreenTotals({ start, end }: FinanceScreenTotalsProps) {
    const financeEnabled = useStore((state) => state.financeEnabled);
    if (!financeEnabled) {
        return null;
    }

    return (
        <div className="flex shrink-0 justify-end px-4 pt-3">
            <FinancePeriodSummary start={start} end={end} />
        </div>
    );
}
