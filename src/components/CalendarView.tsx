'use client';

import { useState } from 'react';
import Calendar from 'react-calendar';
import { useStore } from '@/store/useStore';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import 'react-calendar/dist/Calendar.css'; // Import default styles
import { ChevronLeft } from 'lucide-react';

// Custom styling wrapper if needed
import '@/app/calendar.css';

export default function CalendarView() {
    const { tasks, setCurrentDate, getMergedTasks } = useStore();
    const router = useRouter();
    const [value, setValue] = useState<any>(new Date());

    const handleDayClick = (value: Date) => {
        const dateStr = format(value, 'yyyy-MM-dd');
        setCurrentDate(dateStr);
        router.push('/tasks');
    };

    // Helper to get task summary for a date
    const getTileContent = ({ date, view }: { date: Date; view: string }) => {
        if (view !== 'month') return null;

        const dateStr = format(date, 'yyyy-MM-dd');
        const dayTasks = getMergedTasks(dateStr);

        if (dayTasks.length === 0) return null;

        const totalEst = dayTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
        const totalAct = dayTasks.reduce((sum, t) => sum + (t.actualMinutes || 0), 0);
        const isDone = dayTasks.every(t => t.status === 'done');

        return (
            <div className="flex flex-col items-center mt-1">
                <div className="flex gap-0.5 justify-center mb-0.5">
                    {dayTasks.slice(0, 3).map((t, i) => (
                        <div
                            key={i}
                            className={`w-1 h-1 rounded-full ${t.status === 'done' ? 'bg-green-500' :
                                t.status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-300'
                                }`}
                        />
                    ))}
                    {dayTasks.length > 3 && <span className="text-[10px] leading-none text-gray-400">+</span>}
                </div>
                <div className="text-[10px] text-gray-500 leading-none scale-90">
                    {Math.round(totalAct / 60)}h / {Math.round(totalEst / 60)}h
                </div>
            </div>
        );
    };

    return (
        <div className="p-4 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-800">Calendar</h2>
                <button
                    onClick={() => router.push('/tasks')}
                    className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                >
                    <ChevronLeft size={16} /> Back to List
                </button>
            </div>

            <div className="calendar-wrapper flex justify-center">
                <Calendar
                    onChange={setValue}
                    value={value}
                    onClickDay={handleDayClick}
                    tileContent={getTileContent}
                    className="border-none text-sm w-full max-w-lg"
                    tileClassName="h-24 align-top pt-2 hover:bg-gray-50 rounded-lg transition-colors border border-gray-50"
                    onActiveStartDateChange={() => {
                        // No need for pre-generation anymore!
                    }}
                />
            </div>
        </div>
    );
}
