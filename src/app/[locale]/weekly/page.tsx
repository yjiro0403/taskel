'use client';
import WeeklyView from '@/components/WeeklyView';
import LeftSidebar from '@/components/LeftSidebar';

export default function WeeklyPage() {
    return (
        <main className="h-screen w-full bg-white">
            <WeeklyView />
            <LeftSidebar />
        </main>
    );
}
