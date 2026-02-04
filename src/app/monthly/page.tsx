'use client';

import MonthlyView from '@/components/MonthlyView';
import LeftSidebar from '@/components/LeftSidebar';
import { useStore } from '@/store/useStore';

export default function MonthlyPage() {
    const { toggleLeftSidebar } = useStore();

    return (
        <div className="flex h-screen bg-white">
            <LeftSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <MonthlyView toggleLeftSidebar={toggleLeftSidebar} />
            </div>
        </div>
    );
}
