'use client';

import YearlyView from '@/components/YearlyView';
import LeftSidebar from '@/components/LeftSidebar';
import RightSidebar from '@/components/RightSidebar';
import { FinanceScreenTotals } from '@/components/finance/FinanceScreenTotals';
import { yearRangeFromDate } from '@/lib/finance/dateRange';
import { useStore } from '@/store/useStore';
import DailyNoteModal from '@/components/DailyNoteModal';

export default function YearlyPage() {
    const toggleLeftSidebar = useStore((state) => state.toggleLeftSidebar);
    const range = yearRangeFromDate(new Date());

    return (
        <main className="flex h-screen bg-gray-50 overflow-hidden">
            <LeftSidebar />

            <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out">
                {/* Main Content */}
                <FinanceScreenTotals start={range.start} end={range.end} />
                <div className="flex-1 relative overflow-hidden">
                    <YearlyView toggleLeftSidebar={toggleLeftSidebar} />
                </div>
            </div>

            <RightSidebar />
            <DailyNoteModal />
        </main>
    );
}
