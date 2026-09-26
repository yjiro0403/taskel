'use client';

import MonthlyView from '@/components/MonthlyView';
import LeftSidebar from '@/components/LeftSidebar';
import { FinanceScreenTotals } from '@/components/finance/FinanceScreenTotals';
import { monthRangeFromDate } from '@/lib/finance/dateRange';
import { useStore } from '@/store/useStore';

export default function MonthlyPage() {
    const toggleLeftSidebar = useStore((state) => state.toggleLeftSidebar);
    const range = monthRangeFromDate(new Date());

    return (
        <div className="flex h-screen bg-white">
            <LeftSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <FinanceScreenTotals start={range.start} end={range.end} />
                <div className="min-h-0 flex-1">
                    <MonthlyView toggleLeftSidebar={toggleLeftSidebar} />
                </div>
            </div>
        </div>
    );
}
