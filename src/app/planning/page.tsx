'use client';

import PlanningView from '@/components/PlanningView';
import LeftSidebar from '@/components/LeftSidebar';
import RightSidebar from '@/components/RightSidebar';
import { useStore } from '@/store/useStore';
import DailyNoteModal from '@/components/DailyNoteModal';

export default function PlanningPage() {
    const { toggleLeftSidebar } = useStore();

    return (
        <main className="flex h-screen bg-gray-50 overflow-hidden">
            <LeftSidebar />

            <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out">
                {/* Main Content */}
                <div className="flex-1 relative overflow-hidden">
                    {/* PlanningView manages its own content. 
                         We pass toggleLeftSidebar if it needs to pass it down.
                         Refactoring Note: PlanningView has to import useStore if it wants to pass it 
                         OR we pass it here. 
                         PlanningView created above doesn't take props yet.
                         But wait, I need to fix PlanningView to actually pass props if children need them.
                      */}
                    <PlanningView />
                </div>
            </div>

            <RightSidebar />
            <DailyNoteModal />
        </main>
    );
}
