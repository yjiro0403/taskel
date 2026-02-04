'use client';

import { useStore } from '@/store/useStore';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, FileText } from 'lucide-react';
import { addDays, format, parseISO, isSameDay } from 'date-fns';

export default function DateNavigation() {
    const { currentDate, setCurrentDate, toggleDailyNoteModal } = useStore();

    const handlePrevDay = () => {
        const date = parseISO(currentDate);
        const prevDay = addDays(date, -1);
        setCurrentDate(format(prevDay, 'yyyy-MM-dd'));
    };

    const handleNextDay = () => {
        const date = parseISO(currentDate);
        const nextDay = addDays(date, 1);
        setCurrentDate(format(nextDay, 'yyyy-MM-dd'));
    };

    const handleToday = () => {
        setCurrentDate(format(new Date(), 'yyyy-MM-dd'));
    };

    const displayDate = parseISO(currentDate);
    const isToday = isSameDay(displayDate, new Date());

    return (
        <div className="flex items-center justify-between bg-white p-4 mb-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center gap-4">
                <button
                    onClick={handlePrevDay}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>

                <div className="flex items-center gap-2">
                    <CalendarIcon size={20} className="text-blue-600" />
                    <span className="text-lg font-bold text-gray-800">
                        {format(displayDate, 'yyyy-MM-dd')}
                    </span>
                    <span className="text-sm text-gray-500 font-medium">
                        ({format(displayDate, 'EEE')})
                    </span>
                    <button
                        onClick={toggleDailyNoteModal}
                        className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="Daily Note"
                    >
                        <FileText size={18} />
                    </button>
                </div>

                <button
                    onClick={handleNextDay}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            {!isToday && (
                <button
                    onClick={handleToday}
                    className="px-3 py-1 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                >
                    Back to Today
                </button>
            )}
        </div>
    );
}
