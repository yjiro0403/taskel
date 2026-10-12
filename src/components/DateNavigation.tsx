'use client';

import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/useStore';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, FileText } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { FinancePeriodSummary } from '@/components/finance/FinancePeriodSummary';
import { clearPendingGoogleCalendarSync, formatLocalDate, getLocalDayRange } from '@/lib/calendarService';
import { dayRange } from '@/lib/finance/dateRange';

export default function DateNavigation() {
    const { currentDate, setCurrentDate, hydrateCurrentDateFromStorage, toggleDailyNoteModal } = useStore(useShallow((state) => ({
        currentDate: state.currentDate,
        setCurrentDate: state.setCurrentDate,
        hydrateCurrentDateFromStorage: state.hydrateCurrentDateFromStorage,
        toggleDailyNoteModal: state.toggleDailyNoteModal,
    })));

    // After mount (and full reload), restore selected date from sessionStorage without SSR mismatch.
    useEffect(() => {
        hydrateCurrentDateFromStorage();
    }, [hydrateCurrentDateFromStorage]);

    const handlePrevDay = () => {
        const date = getLocalDayRange(currentDate).start;
        setCurrentDate(formatLocalDate(addDays(date, -1)));
    };

    const handleNextDay = () => {
        const date = getLocalDayRange(currentDate).start;
        setCurrentDate(formatLocalDate(addDays(date, 1)));
    };

    const handleToday = () => {
        // A stuck calendar-import day must not write itself back over this click.
        clearPendingGoogleCalendarSync();
        setCurrentDate(formatLocalDate());
    };

    const displayDate = getLocalDayRange(currentDate).start;
    const isToday = currentDate === formatLocalDate();
    const financeRange = dayRange(currentDate);

    return (
        <div className="flex items-center justify-between bg-white p-4 mb-4 rounded-lg shadow-sm border border-gray-200 gap-3 flex-wrap">
            <div className="flex min-w-0 max-w-full items-center gap-1 sm:gap-4">
                <button
                    type="button"
                    aria-label="Previous day"
                    onClick={handlePrevDay}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>

                <div className="flex items-center gap-2">
                    <CalendarIcon size={20} className="text-blue-600" />
                    <span
                        data-testid="current-date-display"
                        className="text-base sm:text-lg font-bold text-gray-800 whitespace-nowrap"
                    >
                        {format(displayDate, 'yyyy-MM-dd')}
                    </span>
                    <span className="hidden sm:inline text-sm text-gray-500 font-medium">
                        ({format(displayDate, 'EEE')})
                    </span>
                    <button
                        type="button"
                        onClick={toggleDailyNoteModal}
                        className="ml-2 p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="Daily Note"
                    >
                        <FileText size={18} />
                    </button>
                </div>

                <button
                    type="button"
                    aria-label="Next day"
                    onClick={handleNextDay}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            <FinancePeriodSummary start={financeRange.start} end={financeRange.end} />

            {!isToday && (
                <button
                    type="button"
                    onClick={handleToday}
                    className="px-3 py-1 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                >
                    Back to Today
                </button>
            )}
        </div>
    );
}
