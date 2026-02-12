'use client';

import { HelpCircle, Book } from 'lucide-react';

import { useTour } from '@/hooks/useTour';

export default function UserGuideButton({ onClick }: { onClick?: () => void }) {
    const { startTour } = useTour();

    const handleStartTour = () => {
        startTour();
        if (onClick) onClick();
    };

    return (
        <div className="space-y-2">
            <button
                onClick={handleStartTour}
                className="w-full flex items-center gap-3 text-gray-700 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors text-left"
            >
                <HelpCircle size={18} />
                <span>ツアーを開始</span>
            </button>
            <a
                href="/guide"
                className="w-full flex items-center gap-3 text-gray-700 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors text-left"
            >
                <Book size={18} />
                <span>ヘルプセンター</span>
            </a>
        </div>
    );
}
