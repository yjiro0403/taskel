'use client';

import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';
import CalendarView from '@/components/CalendarView';

export default function CalendarPage() {
    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <main className="min-h-screen bg-gray-50/50 p-4 sm:p-8 pt-4 md:pt-8">
                <div className="max-w-4xl mx-auto">
                    <CalendarView />
                </div>
            </main>
        </>
    );
}
