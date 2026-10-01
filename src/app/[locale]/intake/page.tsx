'use client';

import { useEffect, useState } from 'react';

import LeftSidebar from '@/components/LeftSidebar';
import { ScheduleInbox } from '@/components/schedule/ScheduleInbox';

export default function IntakePage() {
    const [focusId, setFocusId] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setFocusId(params.get('id'));
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 pb-16">
            <LeftSidebar />
            <ScheduleInbox focusId={focusId} />
        </div>
    );
}
