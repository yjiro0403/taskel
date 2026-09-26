'use client';

import LeftSidebar from '@/components/LeftSidebar';
import WeeklyView from '@/components/WeeklyView';
import { FinanceScreenTotals } from '@/components/finance/FinanceScreenTotals';
import { isoWeekRangeFromDate } from '@/lib/finance/dateRange';

export default function WeeklyPage() {
    const range = isoWeekRangeFromDate(new Date());

    return (
        <main className="flex h-screen w-full flex-col bg-white">
            <FinanceScreenTotals start={range.start} end={range.end} />
            <div className="min-h-0 flex-1">
                <WeeklyView />
            </div>
            <LeftSidebar />
        </main>
    );
}
