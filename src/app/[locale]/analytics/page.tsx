'use client';

import { useStore } from '@/store/useStore';
import { useState, useMemo } from 'react';
import { BarChart, CheckCircle, Clock, Filter, Calendar, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import {
    startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
    isWithinInterval, format, subWeeks, subMonths, subYears, addWeeks, addMonths, addYears,
    eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isSameDay, isSameWeek, isSameMonth
} from 'date-fns';
import clsx from 'clsx';
import { AuthProvider } from '@/components/AuthProvider';
import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';
// import { ChevronDown, ChevronRight } from 'lucide-react'; // Removing duplicate import line if existing

type TimeRange = 'week' | 'month' | 'year' | 'all';
type GroupBy = 'tag' | 'project';

export default function AnalyticsPage() {
    const { tasks, projects, tags } = useStore();
    const [timeRange, setTimeRange] = useState<TimeRange>('week');
    const [selectedProject, setSelectedProject] = useState<string>('all');
    const [selectedTag, setSelectedTag] = useState<string>('all');
    const [isTaskListOpen, setIsTaskListOpen] = useState(false);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [metric, setMetric] = useState<'minutes' | 'count'>('minutes'); // New State

    // Navigation Handlers
    const handlePrev = () => {
        if (timeRange === 'week') setCurrentDate(d => subWeeks(d, 1));
        else if (timeRange === 'month') setCurrentDate(d => subMonths(d, 1));
        else if (timeRange === 'year') setCurrentDate(d => subYears(d, 1));
    };

    const handleNext = () => {
        if (timeRange === 'week') setCurrentDate(d => addWeeks(d, 1));
        else if (timeRange === 'month') setCurrentDate(d => addMonths(d, 1));
        else if (timeRange === 'year') setCurrentDate(d => addYears(d, 1));
    };

    // Derived Data
    const stats = useMemo(() => {
        // Use currentDate instead of new Date()
        let start = new Date(0); // Beginning of time
        let end = new Date(); // Now

        if (timeRange === 'week') {
            start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday start
            end = endOfWeek(currentDate, { weekStartsOn: 1 });
        } else if (timeRange === 'month') {
            start = startOfMonth(currentDate);
            end = endOfMonth(currentDate);
        } else if (timeRange === 'year') {
            start = startOfYear(currentDate);
            end = endOfYear(currentDate);
        }

        // 1. Filter Tasks by Date & Criteria
        const filtered = tasks.filter(t => {
            const tDate = new Date(`${t.date}T00:00:00`);
            // Date Filter
            if (timeRange !== 'all') {
                if (!isWithinInterval(tDate, { start, end })) return false;
            }
            // Project Filter
            if (selectedProject !== 'all' && t.projectId !== selectedProject) return false;
            // Tag Filter
            if (selectedTag !== 'all') {
                if (!t.tags || !t.tags.includes(selectedTag)) return false;
            }
            return true;
        });

        // 2. Aggregate
        const totalTasks = filtered.length;
        const completedTasks = filtered.filter(t => t.status === 'done');
        const completionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

        // Fix: Math.round to ensure integers for total minutes
        const totalTime = Math.round(completedTasks.reduce((sum, t) => sum + Number(t.actualMinutes || 0), 0));

        // Grouping for Charts (by Tag)
        const tagStats: Record<string, { count: number; minutes: number }> = {};

        filtered.forEach(t => {
            const tTags = t.tags && t.tags.length > 0 ? t.tags : ['Uncategorized'];
            tTags.forEach(tag => {
                if (!tagStats[tag]) tagStats[tag] = { count: 0, minutes: 0 };
                tagStats[tag].count += 1;
                if (t.status === 'done') tagStats[tag].minutes += Number(t.actualMinutes || 0);
            });
        });

        // 3. Trend Data
        let trendData: { label: string; value: number }[] = [];
        if (timeRange === 'week') {
            const days = eachDayOfInterval({ start, end });
            trendData = days.map(day => {
                const dayTasks = filtered.filter(t => isSameDay(new Date(`${t.date}T00:00:00`), day));
                // Metric Logic: Minutes or Count
                const val = dayTasks.reduce((acc, t) => {
                    if (t.status !== 'done') return acc;
                    return acc + (metric === 'minutes' ? Number(t.actualMinutes || 0) : 1);
                }, 0);
                return { label: format(day, 'EEE'), value: val };
            });
        } else if (timeRange === 'month') {
            const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
            trendData = weeks.map(weekStart => {
                // Approximate week check
                const weekTasks = filtered.filter(t => isSameWeek(new Date(`${t.date}T00:00:00`), weekStart, { weekStartsOn: 1 }));
                const val = weekTasks.reduce((acc, t) => {
                    if (t.status !== 'done') return acc;
                    return acc + (metric === 'minutes' ? Number(t.actualMinutes || 0) : 1);
                }, 0);
                return { label: format(weekStart, 'd MMM'), value: val };
            });
        } else if (timeRange === 'year') {
            const months = eachMonthOfInterval({ start, end });
            trendData = months.map(monthStart => {
                const monthTasks = filtered.filter(t => isSameMonth(new Date(`${t.date}T00:00:00`), monthStart));
                const val = monthTasks.reduce((acc, t) => {
                    if (t.status !== 'done') return acc;
                    return acc + (metric === 'minutes' ? Number(t.actualMinutes || 0) : 1);
                }, 0);
                return { label: format(monthStart, 'MMM'), value: val };
            });
        }

        return {
            filtered,
            totalTasks,
            completedCount: completedTasks.length,
            completionRate,
            totalTime,
            tagStats,
            trendData,
            startStr: format(start, 'yyyy-MM-dd'),
            endStr: format(end, 'yyyy-MM-dd')
        };
    }, [tasks, timeRange, selectedProject, selectedTag, currentDate, metric]); // Added metric dependency

    // Format helper
    const formatLabel = () => {
        if (timeRange === 'week') return `Week of ${format(currentDate, 'MMM d')}`;
        if (timeRange === 'month') return format(currentDate, 'MMMM yyyy');
        if (timeRange === 'year') return format(currentDate, 'yyyy');
        return 'All Time';
    };

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <div className="min-h-screen bg-gray-50 text-gray-900 pb-20 pt-4 md:pt-0">
                <div className="max-w-6xl mx-auto px-4 py-8 md:px-8 space-y-8">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <BarChart className="text-blue-600" />
                        Analytics
                    </h1>

                    {/* Controls & Nav */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                        <div className="flex gap-4 items-center flex-wrap">
                            {/* TimeRange Buttons */}
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                {(['week', 'month', 'year', 'all'] as const).map(r => (
                                    <button
                                        key={r}
                                        onClick={() => {
                                            setTimeRange(r);
                                            setCurrentDate(new Date()); // Reset date when time range changes
                                        }}
                                        className={clsx(
                                            "px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                                            timeRange === r ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                        )}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>

                            {/* Date Nav (only if not 'all') */}
                            {timeRange !== 'all' && (
                                <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-1 border border-gray-200">
                                    <button onClick={handlePrev} className="p-1 hover:bg-gray-200 rounded"><ChevronLeft size={20} /></button>
                                    <span className="text-sm font-medium px-2 min-w-[120px] text-center">{formatLabel()}</span>
                                    <button onClick={handleNext} className="p-1 hover:bg-gray-200 rounded"><ChevronRight size={20} /></button>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 flex-wrap">
                            {/* Selects */}
                            <select
                                value={selectedProject}
                                onChange={e => setSelectedProject(e.target.value)}
                                className="bg-gray-50 border border-gray-200 text-sm rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="all">All Projects</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                            </select>

                            <select
                                value={selectedTag}
                                onChange={e => setSelectedTag(e.target.value)}
                                className="bg-gray-50 border border-gray-200 text-sm rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="all">All Tags</option>
                                {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Total Tasks</div>
                            <div className="text-3xl font-bold text-gray-900">{stats.totalTasks}</div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Completed</div>
                            <div className="text-3xl font-bold text-green-600">{stats.completedCount}</div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Completion Rate</div>
                            <div className="text-3xl font-bold text-blue-600">{stats.completionRate}%</div>
                        </div>
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Total Time</div>
                            <div className="text-3xl font-bold text-orange-600 truncate" title={`${stats.totalTime} mins`}>
                                {Math.floor(stats.totalTime / 60)}<span className="text-sm text-gray-400 font-normal ml-1">h</span>
                                {stats.totalTime % 60}<span className="text-sm text-gray-400 font-normal ml-1">m</span>
                            </div>
                        </div>
                    </div>

                    {/* Trend Chart (Visible for Week/Month) */}
                    {timeRange !== 'all' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <BarChart size={18} className="text-blue-500" />
                                    Progress Trend ({timeRange === 'week' ? 'Daily' : timeRange === 'month' ? 'Weekly' : 'Monthly'})
                                </h3>
                                {/* Metric Toggle */}
                                <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-medium">
                                    <button
                                        onClick={() => setMetric('minutes')}
                                        className={clsx(
                                            "px-3 py-1 rounded transition-colors",
                                            metric === 'minutes' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                        )}
                                    >
                                        Time
                                    </button>
                                    <button
                                        onClick={() => setMetric('count')}
                                        className={clsx(
                                            "px-3 py-1 rounded transition-colors",
                                            metric === 'count' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                                        )}
                                    >
                                        Tasks
                                    </button>
                                </div>
                            </div>

                            <div className="h-64 flex gap-4">
                                {/* Y-Axis */}
                                <div className="flex flex-col justify-between text-xs text-gray-400 pb-6 text-right font-mono w-12 flex-shrink-0">
                                    {(() => {
                                        const maxData = Math.max(...stats.trendData.map(d => d.value), 0);
                                        // Dynamic Scale
                                        let maxVal = 0;
                                        if (metric === 'minutes') {
                                            maxVal = Math.ceil(Math.max(maxData, 60) / 60) * 60; // Nearest hour
                                        } else {
                                            maxVal = Math.max(Math.ceil(maxData), 5); // Minimum 5 tasks
                                        }

                                        return [1, 0.75, 0.5, 0.25, 0].map(pct => {
                                            const val = maxVal * pct;
                                            let label = '';
                                            if (val === 0) label = '0';
                                            else if (metric === 'minutes') {
                                                label = val >= 60 ? `${(val / 60).toFixed(1)}h` : `${Math.round(val)}m`;
                                            } else {
                                                label = val % 1 === 0 ? String(val) : val.toFixed(1); // Handle decimal scale if any
                                            }
                                            return (
                                                <span key={pct} className="leading-none">{label}</span>
                                            );
                                        });
                                    })()}
                                </div>

                                {/* Chart Area */}
                                <div className="flex-1 flex items-end gap-2 border-l border-b border-gray-100 pl-2 pb-0 relative">
                                    {stats.trendData.map((d, i) => {
                                        const maxData = Math.max(...stats.trendData.map(x => x.value), 0);
                                        let maxVal = 0;
                                        if (metric === 'minutes') {
                                            maxVal = Math.ceil(Math.max(maxData, 60) / 60) * 60;
                                        } else {
                                            maxVal = Math.max(Math.ceil(maxData), 5);
                                        }

                                        const height = (d.value / maxVal) * 100;

                                        return (
                                            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                                                {/* Value Label */}
                                                <div style={{ marginBottom: '4px', opacity: d.value > 0 ? 1 : 0 }} className="text-[10px] sm:text-xs text-gray-600 font-medium transition-opacity">
                                                    {metric === 'minutes'
                                                        ? (d.value >= 60 ? `${(d.value / 60).toFixed(1)}h` : `${Math.round(d.value)}m`)
                                                        : d.value
                                                    }
                                                </div>

                                                {/* Bar */}
                                                <div
                                                    className="w-full bg-blue-100 rounded-t-sm relative overflow-hidden group-hover:bg-blue-200 transition-colors"
                                                    style={{ height: `${height}%`, minHeight: d.value > 0 ? '4px' : '0' }}
                                                >
                                                    <div className="w-full bg-blue-500 h-full"></div>
                                                </div>

                                                {/* X Label */}
                                                <div className="mt-2 text-[10px] sm:text-xs text-gray-400 rotate-0 truncate w-full text-center leading-none">
                                                    {d.label}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Tag Breakdown Chart */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-gray-800 mb-6">Tasks by Tag</h3>
                            <div className="space-y-4">
                                {Object.entries(stats.tagStats)
                                    .sort(([, a], [, b]) => b.count - a.count)
                                    .map(([tag, data]) => (
                                        <div key={tag}>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="font-medium text-gray-700">{tag}</span>
                                                <span className="text-gray-500">{data.count} tasks</span>
                                            </div>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                                                    style={{ width: `${(data.count / stats.totalTasks) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        {/* Recent Completed Tasks */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <CheckCircle size={18} className="text-green-500" />
                                Completed Tasks ({timeRange})
                            </h3>
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                {stats.filtered
                                    .filter(t => t.status === 'done')
                                    .sort((a, b) => b.date.localeCompare(a.date)) // Latest first
                                    .map(task => (
                                        <div key={task.id} className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors">
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="font-medium text-gray-900 line-clamp-1">{task.title}</div>
                                                <div className="text-xs text-gray-400 whitespace-nowrap">{task.date}</div>
                                            </div>
                                            <div className="flex items-center gap-4 text-xs text-gray-500">
                                                {task.actualMinutes > 0 && (
                                                    <div className="flex items-center gap-1">
                                                        <Clock size={12} />
                                                        {Number(task.actualMinutes).toFixed(2)} min
                                                    </div>
                                                )}
                                                {task.tags && task.tags.length > 0 && (
                                                    <div className="flex gap-1">
                                                        {task.tags.map(tag => (
                                                            <span key={tag} className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                                                #{tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                {stats.filtered.filter(t => t.status === 'done').length === 0 && (
                                    <div className="text-center text-gray-400 py-8">No completed tasks found.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Total Tasks List Accordion */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <button
                            onClick={() => setIsTaskListOpen(!isTaskListOpen)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                        >
                            <span className="font-bold text-gray-800 flex items-center gap-2">
                                <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{stats.totalTasks}</span>
                                Total Tasks List ({timeRange})
                            </span>
                            {isTaskListOpen ? <ChevronDown size={20} className="text-gray-500" /> : <ChevronRight size={20} className="text-gray-500" />}
                        </button>

                        {isTaskListOpen && (
                            <div className="p-0 border-t border-gray-100">
                                <div className="max-h-[500px] overflow-y-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-2">Date</th>
                                                <th className="px-4 py-2">Title</th>
                                                <th className="px-4 py-2">Status</th>
                                                <th className="px-4 py-2">Time</th>
                                                <th className="px-4 py-2">Section</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {stats.filtered
                                                .sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order)
                                                .map(task => (
                                                    <tr key={task.id} className="hover:bg-gray-50/50">
                                                        <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{task.date}</td>
                                                        <td className="px-4 py-2 text-gray-900 font-medium">{task.title}</td>
                                                        <td className="px-4 py-2">
                                                            <span className={clsx(
                                                                "px-2 py-0.5 rounded-full text-xs capitalize",
                                                                task.status === 'done' ? "bg-green-100 text-green-700" :
                                                                    task.status === 'in_progress' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                                                            )}>
                                                                {task.status.replace('_', ' ')}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-gray-500">
                                                            {task.status === 'done' ? Number(task.actualMinutes).toFixed(2) : task.estimatedMinutes} min
                                                        </td>
                                                        <td className="px-4 py-2 text-gray-400 text-xs">
                                                            {task.sectionId}
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
