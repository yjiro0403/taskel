'use client';

import type { Dispatch, SetStateAction } from 'react';

import clsx from 'clsx';

import type { Section } from '@/types';

type TaskType = 'task' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface TaskDatePickerProps {
    activeType: TaskType;
    date: string;
    setDate: Dispatch<SetStateAction<string>>;
    currentDate: string;
    assignedDate: string;
    setAssignedDate: Dispatch<SetStateAction<string>>;
    assignedWeek: string;
    setAssignedWeek: Dispatch<SetStateAction<string>>;
    assignedMonth: string;
    setAssignedMonth: Dispatch<SetStateAction<string>>;
    assignedYear: string;
    setAssignedYear: Dispatch<SetStateAction<string>>;
    estimatedMinutes: number | string;
    setEstimatedMinutes: Dispatch<SetStateAction<number | string>>;
    actualMinutes: number | string;
    setActualMinutes: Dispatch<SetStateAction<number | string>>;
    sectionId: string;
    setSectionId: Dispatch<SetStateAction<string>>;
    scheduledStart: string;
    setScheduledStart: Dispatch<SetStateAction<string>>;
    displaySections: Section[];
    isTimeSectionInconsistent: boolean;
}

export function TaskDatePicker({
    activeType,
    date,
    setDate,
    currentDate,
    assignedDate,
    setAssignedDate,
    assignedWeek,
    setAssignedWeek,
    assignedMonth,
    setAssignedMonth,
    assignedYear,
    setAssignedYear,
    estimatedMinutes,
    setEstimatedMinutes,
    actualMinutes,
    setActualMinutes,
    sectionId,
    setSectionId,
    scheduledStart,
    setScheduledStart,
    displaySections,
    isTimeSectionInconsistent,
}: TaskDatePickerProps) {
    return (
        <>
            {activeType === 'task' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <div className="flex items-center gap-3">
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            disabled={!date}
                            className={clsx(
                                "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900",
                                !date && "bg-gray-100 text-gray-400"
                            )}
                        />
                        <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap cursor-pointer hover:text-gray-900 select-none">
                            <input
                                type="checkbox"
                                checked={!date}
                                onChange={(e) => {
                                    if (e.target.checked) setDate('');
                                    else setDate(currentDate);
                                }}
                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            Unscheduled
                        </label>
                    </div>
                </div>
            )}

            {activeType === 'daily' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                    <input
                        type="date"
                        value={assignedDate || currentDate}
                        onChange={(e) => setAssignedDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                    />
                </div>
            )}

            {activeType === 'weekly' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Week</label>
                    <input
                        type="week"
                        value={assignedWeek}
                        onChange={(e) => setAssignedWeek(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                    />
                </div>
            )}

            {activeType === 'monthly' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Month</label>
                    <input
                        type="month"
                        value={assignedMonth}
                        onChange={(e) => setAssignedMonth(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                    />
                </div>
            )}

            {activeType === 'yearly' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Target Year</label>
                    <input
                        type="number"
                        min="2020"
                        max="2030"
                        value={assignedYear}
                        onChange={(e) => setAssignedYear(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                    />
                </div>
            )}

            {activeType === 'task' && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Est. (min)</label>
                            <input
                                type="number"
                                min="1"
                                value={estimatedMinutes}
                                onChange={(e) => setEstimatedMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Act. (min)</label>
                            <input
                                type="number"
                                min="0"
                                value={actualMinutes}
                                onChange={(e) => setActualMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                        <select
                            value={sectionId}
                            onChange={(e) => {
                                setSectionId(e.target.value);
                                setScheduledStart('');
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white text-gray-900"
                        >
                            {displaySections.map((section, index) => {
                                const endTime = section.endTime || (index < displaySections.length - 1 ? displaySections[index + 1].startTime : '24:00');
                                return (
                                    <option key={section.id} value={section.id}>
                                        {section.name} ({section.startTime || '00:00'} - {endTime})
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled Start Time (Optional)</label>
                        <input
                            type="time"
                            value={scheduledStart}
                            onChange={(e) => setScheduledStart(e.target.value)}
                            className={clsx(
                                "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900",
                                isTimeSectionInconsistent ? "border-yellow-400 bg-yellow-50" : "border-gray-300"
                            )}
                        />
                        {isTimeSectionInconsistent && (
                            <p className="mt-1 text-xs text-yellow-700 font-medium">
                                ⚠️ 時間 ({scheduledStart}) は別のセクション範囲外です
                            </p>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
