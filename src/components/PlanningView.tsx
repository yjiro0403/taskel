'use client';

import { useState } from 'react';
import WeeklyView from './WeeklyView';
import MonthlyView from './MonthlyView';
import YearlyView from './YearlyView';
import clsx from 'clsx';
import { format, addWeeks, subWeeks, addMonths, subMonths, addYears, subYears, startOfWeek, getISOWeek, getISOWeekYear } from 'date-fns';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { useStore } from '@/store/useStore';

type Tab = 'weekly' | 'monthly' | 'yearly';

export default function PlanningView() {
    const { toggleLeftSidebar } = useStore();
    const [activeTab, setActiveTab] = useState<Tab>('weekly');
    const [currentDate, setCurrentDate] = useState(new Date());

    const handlePrev = () => {
        if (activeTab === 'weekly') setCurrentDate(d => subWeeks(d, 1));
        if (activeTab === 'monthly') setCurrentDate(d => subMonths(d, 1));
        if (activeTab === 'yearly') setCurrentDate(d => subYears(d, 1));
    };

    const handleNext = () => {
        if (activeTab === 'weekly') setCurrentDate(d => addWeeks(d, 1));
        if (activeTab === 'monthly') setCurrentDate(d => addMonths(d, 1));
        if (activeTab === 'yearly') setCurrentDate(d => addYears(d, 1));
    };

    const handleToday = () => setCurrentDate(new Date());

    const getHeaderLabel = () => {
        if (activeTab === 'weekly') {
            const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
            return `${format(weekStart, 'MMMM yyyy')} - Week ${getISOWeek(weekStart)}`;
        }
        if (activeTab === 'monthly') {
            return format(currentDate, 'MMMM yyyy');
        }
        if (activeTab === 'yearly') {
            return format(currentDate, 'yyyy');
        }
        return '';
    };

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] md:h-full bg-gray-50">
            {/* Unified Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between px-4 py-3 md:px-6 md:py-4 bg-white border-b border-gray-200 shrink-0 z-10 gap-3 md:gap-0">

                {/* Mobile Top Row: Menu + View Select + Sync? */}
                <div className="flex items-center justify-between w-full md:w-auto md:hidden">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleLeftSidebar}
                            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <Menu size={24} />
                        </button>

                        {/* Mobile View Selector */}
                        <div className="relative">
                            <select
                                value={activeTab}
                                onChange={(e) => setActiveTab(e.target.value as Tab)}
                                className="appearance-none bg-gray-100 border-0 text-gray-800 text-sm font-semibold rounded-lg pl-3 pr-8 py-1.5 focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                                <option value="yearly">Yearly</option>
                            </select>
                            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                            </div>
                        </div>
                    </div>

                    {/* Mobile Date Nav (Compact) */}
                    <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-0.5">
                        <button onClick={handlePrev} className="p-1.5 hover:bg-white rounded-md text-gray-600">
                            <ChevronLeft size={18} />
                        </button>
                        <button onClick={handleNext} className="p-1.5 hover:bg-white rounded-md text-gray-600">
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>

                {/* Mobile Date Title (Row 2) */}
                <div className="flex md:hidden items-center justify-center pb-1">
                    <h1 className="text-base font-bold text-gray-800" onClick={handleToday}>
                        {getHeaderLabel()}
                    </h1>
                </div>


                {/* Desktop Header Layout (Hidden on Mobile) */}
                <div className="hidden md:flex items-center gap-6">
                    <button
                        onClick={toggleLeftSidebar}
                        className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <Menu size={24} />
                    </button>

                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        {(['weekly', 'monthly', 'yearly'] as Tab[]).map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={clsx(
                                    "px-4 py-1.5 text-sm font-medium rounded-md transition-all capitalize",
                                    activeTab === tab
                                        ? "bg-white text-gray-900 shadow-sm"
                                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
                                )}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-gray-300 mx-2" />

                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold text-gray-800 min-w-[200px]">
                            {getHeaderLabel()}
                        </h1>
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                            <button onClick={handlePrev} className="p-1 hover:bg-white rounded-md transition-shadow shadow-sm">
                                <ChevronLeft size={20} className="text-gray-600" />
                            </button>
                            <button onClick={handleToday} className="px-3 py-1 text-sm font-medium text-gray-600 hover:bg-white rounded-md transition-shadow shadow-sm">
                                Today
                            </button>
                            <button onClick={handleNext} className="p-1 hover:bg-white rounded-md transition-shadow shadow-sm">
                                <ChevronRight size={20} className="text-gray-600" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'weekly' && <WeeklyView currentDate={currentDate} />}
                {activeTab === 'monthly' && <MonthlyView currentDate={currentDate} />}
                {activeTab === 'yearly' && <YearlyView currentDate={currentDate} />}
            </div>
        </div>
    );
}
