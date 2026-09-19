'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    BarChart,
    CheckCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock,
    JapaneseYen,
    Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import {
    eachDayOfInterval,
    eachMonthOfInterval,
    eachWeekOfInterval,
    format,
    isSameDay,
    isSameMonth,
    isSameWeek,
    parseISO,
} from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';

import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';
import {
    aggregateByProject,
    aggregateByTag,
    aggregateFinanceByCategory,
    aggregateFinanceByProject,
    computeVariance,
    tasksForProject,
    tasksForTag,
} from '@/lib/analytics/aggregate';
import { formatDurationMinutes, hoursInputToMinutes, minutesToHoursInput, parseYenInput } from '@/lib/analytics/format';
import { periodKeyFromDate, rangeForTimeRange, shiftPeriodDate } from '@/lib/analytics/period';
import type { AnalyticsPeriodType, AnalyticsTimeRange } from '@/lib/analytics/types';
import { UNCATEGORIZED_ID, UNCATEGORIZED_TAG } from '@/lib/analytics/types';
import { formatYen } from '@/lib/finance/format';
import type { FinanceEntry } from '@/lib/finance/types';
import { useStore } from '@/store/useStore';
import type { Project, Task } from '@/types';

type Breakdown =
    | { kind: 'project'; id: string }
    | { kind: 'tag'; id: string }
    | null;

export default function AnalyticsDashboard() {
    const t = useTranslations('Analytics');
    const locale = useLocale();
    const {
        tasks,
        projects,
        tags,
        financeEnabled,
        loadFinanceBreakdown,
        loadFinanceCategories,
        loadPeriodAnalytics,
        savePeriodPlan,
        saveCategoryBudget,
        removeCategoryBudget,
        periodPlan,
        categoryBudgets,
        updateProject,
        showToast,
    } = useStore();

    const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('week');
    const [selectedProject, setSelectedProject] = useState('all');
    const [selectedTag, setSelectedTag] = useState('all');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [metric, setMetric] = useState<'minutes' | 'count'>('minutes');
    const [isTaskListOpen, setIsTaskListOpen] = useState(false);
    const [breakdown, setBreakdown] = useState<Breakdown>(null);
    const [financeEntries, setFinanceEntries] = useState<FinanceEntry[]>([]);
    const [expectedDrafts, setExpectedDrafts] = useState<Record<string, string>>({});
    const [categoryBudgetDrafts, setCategoryBudgetDrafts] = useState<Record<string, string>>({});

    const periodType: AnalyticsPeriodType | null = timeRange === 'all' ? null : timeRange;
    const periodKey = periodType ? periodKeyFromDate(currentDate, periodType) : null;
    const range = useMemo(() => rangeForTimeRange(timeRange, currentDate), [timeRange, currentDate]);

    useEffect(() => {
        if (!periodType || !periodKey) return;
        void loadPeriodAnalytics(periodType, periodKey);
    }, [loadPeriodAnalytics, periodType, periodKey]);

    useEffect(() => {
        if (!financeEnabled || !range) {
            return;
        }
        void loadFinanceCategories();
        let cancelled = false;
        loadFinanceBreakdown(range.start, range.end)
            .then((rows) => {
                if (!cancelled) setFinanceEntries(rows);
            })
            .catch(() => {
                if (!cancelled) setFinanceEntries([]);
            });
        return () => {
            cancelled = true;
        };
    }, [financeEnabled, range, loadFinanceBreakdown, loadFinanceCategories]);

    const filteredTasks = useMemo(() => {
        return tasks.filter((task) => {
            if (!task.date) return false;
            const taskDate = new Date(`${task.date}T00:00:00`);
            if (Number.isNaN(taskDate.getTime())) return false;
            if (range && (task.date < range.start || task.date >= range.end)) return false;
            if (selectedProject !== 'all' && task.projectId !== selectedProject) return false;
            if (selectedTag !== 'all' && !task.tags?.includes(selectedTag)) return false;
            return true;
        });
    }, [tasks, range, selectedProject, selectedTag]);

    const completedTasks = filteredTasks.filter((task) => task.status === 'done');
    const totalTime = completedTasks.reduce((sum, task) => sum + Number(task.actualMinutes || 0), 0);
    const completionRate = filteredTasks.length > 0
        ? Math.round((completedTasks.length / filteredTasks.length) * 100)
        : 0;

    const projectRows = useMemo(
        () => aggregateByProject(filteredTasks, projects),
        [filteredTasks, projects]
    );
    const tagRows = useMemo(() => aggregateByTag(filteredTasks), [filteredTasks]);

    const financeByCategory = useMemo(
        () => aggregateFinanceByCategory(financeEntries),
        [financeEntries]
    );
    const financeByProject = useMemo(
        () => aggregateFinanceByProject(financeEntries, tasks, projects),
        [financeEntries, tasks, projects]
    );
    const expenseTotal = financeEntries
        .filter((entry) => entry.entryType === 'expense')
        .reduce((sum, entry) => sum + entry.amountYen, 0);

    const trendData = useMemo(() => {
        if (!range) return [];
        const start = parseISO(range.start);
        const end = new Date(parseISO(range.end).getTime() - 1);
        if (timeRange === 'week') {
            return eachDayOfInterval({ start, end }).map((day) => {
                const dayTasks = filteredTasks.filter((task) => isSameDay(parseISO(task.date), day) && task.status === 'done');
                const value = dayTasks.reduce(
                    (acc, task) => acc + (metric === 'minutes' ? Number(task.actualMinutes || 0) : 1),
                    0
                );
                return { label: format(day, 'EEE'), value };
            });
        }
        if (timeRange === 'month') {
            return eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((weekStart) => {
                const weekTasks = filteredTasks.filter(
                    (task) => isSameWeek(parseISO(task.date), weekStart, { weekStartsOn: 1 }) && task.status === 'done'
                );
                const value = weekTasks.reduce(
                    (acc, task) => acc + (metric === 'minutes' ? Number(task.actualMinutes || 0) : 1),
                    0
                );
                return { label: format(weekStart, 'd MMM'), value };
            });
        }
        return eachMonthOfInterval({ start, end }).map((monthStart) => {
            const monthTasks = filteredTasks.filter(
                (task) => isSameMonth(parseISO(task.date), monthStart) && task.status === 'done'
            );
            const value = monthTasks.reduce(
                (acc, task) => acc + (metric === 'minutes' ? Number(task.actualMinutes || 0) : 1),
                0
            );
            return { label: format(monthStart, 'MMM'), value };
        });
    }, [filteredTasks, metric, range, timeRange]);

    const formatLabel = () => {
        if (timeRange === 'week') return `${format(currentDate, 'MMM d')} · ${periodKey}`;
        if (timeRange === 'month') return format(currentDate, 'MMMM yyyy');
        if (timeRange === 'year') return format(currentDate, 'yyyy');
        return t('all');
    };

    const bucketLabel = (id: string, label: string, kind: 'project' | 'tag') => {
        if (kind === 'project' && (id === UNCATEGORIZED_ID || !label)) return t('uncategorized');
        if (kind === 'tag' && (id === UNCATEGORIZED_TAG || !label)) return t('untagged');
        return label;
    };

    const breakdownTasks: Task[] = breakdown
        ? breakdown.kind === 'project'
            ? tasksForProject(filteredTasks, breakdown.id)
            : tasksForTag(filteredTasks, breakdown.id)
        : [];
    const breakdownRows = breakdown
        ? breakdown.kind === 'project'
            ? aggregateByTag(breakdownTasks)
            : aggregateByProject(breakdownTasks, projects)
        : [];
    const breakdownTitle = breakdown
        ? breakdown.kind === 'project'
            ? bucketLabel(breakdown.id, projects.find((project) => project.id === breakdown.id)?.title ?? '', 'project')
            : bucketLabel(breakdown.id, breakdown.id, 'tag')
        : '';

    const overallBudget = periodPlan?.overallBudgetYen ?? null;
    const budgetVariance = overallBudget != null ? computeVariance(expenseTotal, overallBudget) : null;

    const handleSaveExpected = async (project: Project) => {
        const minutes = hoursInputToMinutes(expectedDrafts[project.id] ?? minutesToHoursInput(project.expectedMinutes));
        try {
            await updateProject(project.id, { expectedMinutes: minutes ?? undefined });
            showToast(t('planSaved'), 'success');
        } catch {
            showToast(t('saveHoursError'), 'error');
        }
    };

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <div className="min-h-screen bg-gray-50 text-gray-900 pb-20 pt-4 md:pt-0">
                <div className="max-w-6xl mx-auto px-4 py-8 md:px-8 space-y-8">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <BarChart className="text-blue-600" />
                        {t('title')}
                    </h1>

                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                        <div className="flex gap-4 items-center flex-wrap">
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                {(['week', 'month', 'year', 'all'] as const).map((rangeKey) => (
                                    <button
                                        key={rangeKey}
                                        type="button"
                                        onClick={() => {
                                            setTimeRange(rangeKey);
                                            setCurrentDate(new Date());
                                            setBreakdown(null);
                                        }}
                                        className={clsx(
                                            'px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer',
                                            timeRange === rangeKey ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                                        )}
                                    >
                                        {t(rangeKey)}
                                    </button>
                                ))}
                            </div>
                            {timeRange !== 'all' && (
                                <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-gray-200">
                                    <button type="button" aria-label={t('prev')} onClick={() => setCurrentDate((date) => shiftPeriodDate(date, timeRange, -1))} className="p-1 hover:bg-gray-100 rounded cursor-pointer">
                                        <ChevronLeft size={20} />
                                    </button>
                                    <span className="text-sm font-medium px-2 min-w-[140px] text-center text-gray-900">{formatLabel()}</span>
                                    <button type="button" aria-label={t('next')} onClick={() => setCurrentDate((date) => shiftPeriodDate(date, timeRange, 1))} className="p-1 hover:bg-gray-100 rounded cursor-pointer">
                                        <ChevronRight size={20} />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <select
                                value={selectedProject}
                                onChange={(event) => setSelectedProject(event.target.value)}
                                className="bg-white border border-gray-200 text-sm rounded-lg p-2 text-gray-900 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="all">{t('allProjects')}</option>
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>{project.title}</option>
                                ))}
                            </select>
                            <select
                                value={selectedTag}
                                onChange={(event) => setSelectedTag(event.target.value)}
                                className="bg-white border border-gray-200 text-sm rounded-lg p-2 text-gray-900 focus:ring-blue-500 focus:border-blue-500"
                            >
                                <option value="all">{t('allTags')}</option>
                                {tags.map((tag) => (
                                    <option key={tag.id} value={tag.name}>{tag.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Kpi label={t('kpiTasks')} value={String(filteredTasks.length)} />
                        <Kpi label={t('kpiCompleted')} value={String(completedTasks.length)} accent="text-green-600" />
                        <Kpi label={t('kpiRate')} value={`${completionRate}%`} accent="text-blue-600" />
                        <Kpi label={t('kpiTime')} value={formatDurationMinutes(totalTime, locale)} accent="text-orange-600" />
                    </div>

                    {financeEnabled && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Kpi label={t('kpiExpense')} value={formatYen(expenseTotal, locale)} icon={<JapaneseYen size={16} />} />
                            <Kpi
                                label={t('kpiBudget')}
                                value={overallBudget != null ? formatYen(overallBudget, locale) : t('unset')}
                                icon={<Wallet size={16} />}
                            />
                            <Kpi
                                label={budgetVariance?.over ? t('kpiOver') : t('kpiRemaining')}
                                value={budgetVariance ? formatYen(Math.abs(budgetVariance.remaining), locale) : t('unset')}
                                accent={budgetVariance?.over ? 'text-red-600' : 'text-emerald-600'}
                            />
                            <Kpi label={t('kpiIncome')} value={formatYen(financeEntries.filter((entry) => entry.entryType === 'income').reduce((sum, entry) => sum + entry.amountYen, 0), locale)} />
                        </div>
                    )}

                    <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h2 className="font-bold text-gray-900">{t('projectsTitle')}</h2>
                        <p className="text-sm text-gray-600 mt-1 mb-4">{t('projectsHint')}</p>
                        <TimeTable
                            rows={projectRows}
                            locale={locale}
                            expectedFor={(id) => projects.find((project) => project.id === id)?.expectedMinutes}
                            labelFor={(row) => bucketLabel(row.id, row.label, 'project')}
                            onSelect={(id) => setBreakdown({ kind: 'project', id })}
                            selectedId={breakdown?.kind === 'project' ? breakdown.id : null}
                            expectedDrafts={expectedDrafts}
                            onExpectedDraft={(id, value) => setExpectedDrafts((current) => ({ ...current, [id]: value }))}
                            onSaveExpected={(id) => {
                                const project = projects.find((item) => item.id === id);
                                if (project) void handleSaveExpected(project);
                            }}
                            showExpected
                        />
                    </section>

                    <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h2 className="font-bold text-gray-900">{t('tagsTitle')}</h2>
                        <p className="text-sm text-gray-600 mt-1 mb-4">{t('tagsHint')}</p>
                        <TimeTable
                            rows={tagRows}
                            locale={locale}
                            labelFor={(row) => bucketLabel(row.id, row.label, 'tag')}
                            onSelect={(id) => setBreakdown({ kind: 'tag', id })}
                            selectedId={breakdown?.kind === 'tag' ? breakdown.id : null}
                        />
                    </section>

                    {breakdown && (
                        <section className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                            <div className="flex justify-between items-start gap-4 mb-4">
                                <h3 className="font-bold text-gray-900">{t('breakdownTitle', { label: breakdownTitle })}</h3>
                                <button type="button" onClick={() => setBreakdown(null)} className="text-sm text-blue-700 hover:underline cursor-pointer">
                                    {t('closeBreakdown')}
                                </button>
                            </div>
                            <TimeTable
                                rows={breakdownRows}
                                locale={locale}
                                labelFor={(row) => bucketLabel(row.id, row.label, breakdown.kind === 'project' ? 'tag' : 'project')}
                            />
                        </section>
                    )}

                    {periodType && periodKey && (
                        <PeriodPlanForm
                            key={`${periodType}:${periodKey}:${periodPlan?.updatedAt ?? 'new'}`}
                            financeEnabled={financeEnabled}
                            initialHours={minutesToHoursInput(periodPlan?.expectedMinutes)}
                            initialBudget={periodPlan?.overallBudgetYen != null ? String(periodPlan.overallBudgetYen) : ''}
                            initialReflection={periodPlan?.reflection ?? ''}
                            onSave={(hours, budget, reflection) => {
                                void savePeriodPlan(periodType, periodKey, {
                                    expectedMinutes: hoursInputToMinutes(hours),
                                    overallBudgetYen: parseYenInput(budget),
                                    reflection: reflection.trim() === '' ? null : reflection,
                                }).then((ok) => {
                                    showToast(ok ? t('planSaved') : t('planSaveError'), ok ? 'success' : 'error');
                                });
                            }}
                        />
                    )}

                    {financeEnabled ? (
                        <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-6">
                            <div>
                                <h2 className="font-bold text-gray-900">{t('financeTitle')}</h2>
                                <p className="text-sm text-gray-600 mt-1">{t('financeHint')}</p>
                            </div>
                            {financeByCategory.length === 0 ? (
                                <p className="text-sm text-gray-600">{t('noFinance')}</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="text-gray-600 border-b border-gray-100">
                                            <tr>
                                                <th className="py-2 pr-3">{t('category')}</th>
                                                <th className="py-2 pr-3">{t('spent')}</th>
                                                <th className="py-2 pr-3">{t('budget')}</th>
                                                <th className="py-2">{t('colVariance')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {financeByCategory.map((row) => {
                                                const budget = categoryBudgets.find((item) => item.categoryId === row.categoryId)?.amountYen
                                                    ?? null;
                                                const variance = computeVariance(row.expenseYen, budget);
                                                const draft = categoryBudgetDrafts[row.categoryId] ?? (budget != null ? String(budget) : '');
                                                return (
                                                    <tr key={row.categoryId} className="border-b border-gray-50">
                                                        <td className="py-3 pr-3 font-medium text-gray-900">{row.label}</td>
                                                        <td className="py-3 pr-3 text-gray-900">{formatYen(row.expenseYen, locale)}</td>
                                                        <td className="py-3 pr-3">
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="text"
                                                                    inputMode="numeric"
                                                                    value={draft}
                                                                    onChange={(event) => setCategoryBudgetDrafts((current) => ({
                                                                        ...current,
                                                                        [row.categoryId]: event.target.value,
                                                                    }))}
                                                                    className="w-28 border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900"
                                                                />
                                                                {periodType && periodKey && (
                                                                    <>
                                                                        <button
                                                                            type="button"
                                                                            className="text-xs text-blue-700 hover:underline cursor-pointer"
                                                                            onClick={() => {
                                                                                const amount = parseYenInput(draft);
                                                                                if (amount == null) return;
                                                                                void saveCategoryBudget(periodType, periodKey, row.categoryId, amount);
                                                                            }}
                                                                        >
                                                                            {t('setBudget')}
                                                                        </button>
                                                                        {budget != null && (
                                                                            <button
                                                                                type="button"
                                                                                className="text-xs text-gray-600 hover:underline cursor-pointer"
                                                                                onClick={() => void removeCategoryBudget(periodType, periodKey, row.categoryId)}
                                                                            >
                                                                                {t('clearBudget')}
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className={clsx('py-3', variance?.over ? 'text-red-600' : 'text-emerald-700')}>
                                                            {variance
                                                                ? t(variance.over ? 'overBy' : 'remainingBy', { duration: formatYen(Math.abs(variance.remaining), locale) })
                                                                : t('unset')}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {financeByProject.length > 0 && (
                                <div>
                                    <h3 className="font-semibold text-gray-900 mb-2">{t('projectsTitle')}</h3>
                                    <ul className="space-y-2">
                                        {financeByProject.map((row) => (
                                            <li key={row.id} className="flex justify-between text-sm">
                                                <span className="text-gray-800">{row.label || t('uncategorized')}</span>
                                                <span className="font-medium text-gray-900">{formatYen(row.expenseYen, locale)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </section>
                    ) : (
                        <p className="text-sm text-gray-600">{t('financeDisabled')}</p>
                    )}

                    {timeRange !== 'all' && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <BarChart size={18} className="text-blue-500" />
                                    {t('trendTitle')}
                                </h3>
                                <div className="flex bg-gray-100 p-1 rounded-lg text-xs font-medium">
                                    <button type="button" onClick={() => setMetric('minutes')} className={clsx('px-3 py-1 rounded cursor-pointer', metric === 'minutes' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600')}>
                                        {t('metricTime')}
                                    </button>
                                    <button type="button" onClick={() => setMetric('count')} className={clsx('px-3 py-1 rounded cursor-pointer', metric === 'count' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600')}>
                                        {t('metricTasks')}
                                    </button>
                                </div>
                            </div>
                            <TrendChart data={trendData} metric={metric} />
                        </div>
                    )}

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                            <CheckCircle size={18} className="text-green-500" />
                            {t('completedTasks')}
                        </h3>
                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                            {completedTasks.length === 0 && (
                                <div className="text-center text-gray-500 py-8">{t('noCompleted')}</div>
                            )}
                            {completedTasks
                                .slice()
                                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                                .map((task) => (
                                    <div key={task.id} className="p-3 border border-gray-100 rounded-lg">
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="font-medium text-gray-900 line-clamp-1">{task.title}</div>
                                            <div className="text-xs text-gray-500 whitespace-nowrap">{task.date}</div>
                                        </div>
                                        {task.actualMinutes > 0 && (
                                            <div className="flex items-center gap-1 text-xs text-gray-600">
                                                <Clock size={12} />
                                                {formatDurationMinutes(task.actualMinutes, locale)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setIsTaskListOpen(!isTaskListOpen)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left cursor-pointer"
                        >
                            <span className="font-bold text-gray-800">
                                {t('totalList')} ({filteredTasks.length})
                            </span>
                            <ChevronDown size={20} className={clsx('text-gray-500 transition-transform', isTaskListOpen && 'rotate-180')} />
                        </button>
                        {isTaskListOpen && (
                            <div className="max-h-[500px] overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-100 sticky top-0">
                                        <tr>
                                            <th className="px-4 py-2">Date</th>
                                            <th className="px-4 py-2">Title</th>
                                            <th className="px-4 py-2">Status</th>
                                            <th className="px-4 py-2">Time</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredTasks
                                            .slice()
                                            .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                                            .map((task) => (
                                                <tr key={task.id}>
                                                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{task.date}</td>
                                                    <td className="px-4 py-2 text-gray-900 font-medium">{task.title}</td>
                                                    <td className="px-4 py-2 text-gray-700">{task.status}</td>
                                                    <td className="px-4 py-2 text-gray-600">
                                                        {formatDurationMinutes(task.status === 'done' ? task.actualMinutes : task.estimatedMinutes, locale)}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}

function PeriodPlanForm({
    financeEnabled,
    initialHours,
    initialBudget,
    initialReflection,
    onSave,
}: {
    financeEnabled: boolean;
    initialHours: string;
    initialBudget: string;
    initialReflection: string;
    onSave: (hours: string, budget: string, reflection: string) => void;
}) {
    const t = useTranslations('Analytics');
    const [hours, setHours] = useState(initialHours);
    const [budget, setBudget] = useState(initialBudget);
    const [reflection, setReflection] = useState(initialReflection);

    return (
        <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
            <h2 className="font-bold text-gray-900">{t('periodPlanTitle')}</h2>
            <div className="grid md:grid-cols-2 gap-4">
                <label className="text-sm text-gray-700 space-y-1">
                    <span>{t('periodExpected')}</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={hours}
                        onChange={(event) => setHours(event.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-2 bg-white text-gray-900"
                    />
                </label>
                {financeEnabled && (
                    <label className="text-sm text-gray-700 space-y-1">
                        <span>{t('periodBudget')}</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={budget}
                            onChange={(event) => setBudget(event.target.value)}
                            className="w-full border border-gray-300 rounded-lg p-2 bg-white text-gray-900"
                        />
                    </label>
                )}
            </div>
            <label className="text-sm text-gray-700 space-y-1 block">
                <span>{t('periodReflection')}</span>
                <textarea
                    value={reflection}
                    onChange={(event) => setReflection(event.target.value)}
                    rows={4}
                    placeholder={t('periodReflectionPlaceholder')}
                    className="w-full border border-gray-300 rounded-lg p-3 bg-white text-gray-900"
                />
            </label>
            <button
                type="button"
                onClick={() => onSave(hours, budget, reflection)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
            >
                {t('savePlan')}
            </button>
        </section>
    );
}

function Kpi({
    label,
    value,
    accent,
    icon,
}: {
    label: string;
    value: string;
    accent?: string;
    icon?: ReactNode;
}) {
    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="text-sm text-gray-600 mb-1 flex items-center gap-1">{icon}{label}</div>
            <div className={clsx('text-2xl font-bold truncate', accent ?? 'text-gray-900')}>{value}</div>
        </div>
    );
}

function TimeTable({
    rows,
    locale,
    expectedFor,
    labelFor,
    onSelect,
    selectedId,
    expectedDrafts,
    onExpectedDraft,
    onSaveExpected,
    showExpected,
}: {
    rows: { id: string; label: string; minutes: number; taskCount: number }[];
    locale: string;
    expectedFor?: (id: string) => number | undefined;
    labelFor: (row: { id: string; label: string }) => string;
    onSelect?: (id: string) => void;
    selectedId?: string | null;
    expectedDrafts?: Record<string, string>;
    onExpectedDraft?: (id: string, value: string) => void;
    onSaveExpected?: (id: string) => void;
    showExpected?: boolean;
}) {
    const t = useTranslations('Analytics');
    const maxMinutes = Math.max(...rows.map((row) => row.minutes), 1);

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="text-gray-600 border-b border-gray-100">
                    <tr>
                        <th className="py-2 pr-3">{t('colName')}</th>
                        <th className="py-2 pr-3">{t('colActual')}</th>
                        {showExpected && <th className="py-2 pr-3">{t('colExpected')}</th>}
                        <th className="py-2 pr-3">{t('colVariance')}</th>
                        <th className="py-2">{t('colTasks')}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const expected = expectedFor?.(row.id);
                        const variance = computeVariance(row.minutes, expected);
                        return (
                            <tr
                                key={row.id}
                                className={clsx(
                                    'border-b border-gray-50',
                                    onSelect && 'cursor-pointer hover:bg-gray-50',
                                    selectedId === row.id && 'bg-blue-50'
                                )}
                                onClick={() => onSelect?.(row.id)}
                            >
                                <td className="py-3 pr-3">
                                    <div className="font-medium text-gray-900">{labelFor(row)}</div>
                                    <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(row.minutes / maxMinutes) * 100}%` }} />
                                    </div>
                                </td>
                                <td className="py-3 pr-3 text-gray-900 whitespace-nowrap">{formatDurationMinutes(row.minutes, locale)}</td>
                                {showExpected && (
                                    <td className="py-3 pr-3" onClick={(event) => event.stopPropagation()}>
                                        {onExpectedDraft && row.id !== UNCATEGORIZED_ID ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    aria-label={t('expectedHours')}
                                                    value={expectedDrafts?.[row.id] ?? minutesToHoursInput(expected)}
                                                    onChange={(event) => onExpectedDraft(row.id, event.target.value)}
                                                    className="w-20 border border-gray-300 rounded px-2 py-1 bg-white text-gray-900"
                                                />
                                                <button type="button" className="text-xs text-blue-700 hover:underline cursor-pointer" onClick={() => onSaveExpected?.(row.id)}>
                                                    {t('saveExpected')}
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-gray-600">{expected != null ? formatDurationMinutes(expected, locale) : t('unset')}</span>
                                        )}
                                    </td>
                                )}
                                <td className={clsx('py-3 pr-3 whitespace-nowrap', variance?.over ? 'text-red-600' : 'text-emerald-700')}>
                                    {variance
                                        ? t(variance.over ? 'overBy' : 'remainingBy', { duration: formatDurationMinutes(Math.abs(variance.remaining), locale) })
                                        : t('unset')}
                                </td>
                                <td className="py-3 text-gray-600">{row.taskCount}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function TrendChart({
    data,
    metric,
}: {
    data: { label: string; value: number }[];
    metric: 'minutes' | 'count';
}) {
    const maxData = Math.max(...data.map((item) => item.value), 0);
    const maxVal = metric === 'minutes'
        ? Math.ceil(Math.max(maxData, 60) / 60) * 60
        : Math.max(Math.ceil(maxData), 5);

    return (
        <div className="h-64 flex gap-4">
            <div className="flex flex-col justify-between text-xs text-gray-500 pb-6 text-right font-mono w-12 flex-shrink-0">
                {[1, 0.75, 0.5, 0.25, 0].map((pct) => {
                    const val = maxVal * pct;
                    const label = metric === 'minutes'
                        ? (val >= 60 ? `${(val / 60).toFixed(1)}h` : `${Math.round(val)}m`)
                        : String(val);
                    return <span key={pct}>{val === 0 ? '0' : label}</span>;
                })}
            </div>
            <div className="flex-1 flex items-end gap-2 border-l border-b border-gray-100 pl-2">
                {data.map((item, index) => {
                    const height = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
                    return (
                        <div key={index} className="flex-1 flex flex-col items-center justify-end h-full">
                            <div className="text-[10px] text-gray-600 mb-1">
                                {metric === 'minutes'
                                    ? (item.value >= 60 ? `${(item.value / 60).toFixed(1)}h` : `${Math.round(item.value)}m`)
                                    : item.value}
                            </div>
                            <div className="w-full bg-blue-100 rounded-t-sm" style={{ height: `${height}%`, minHeight: item.value > 0 ? '4px' : '0' }}>
                                <div className="w-full bg-blue-500 h-full" />
                            </div>
                            <div className="mt-2 text-[10px] text-gray-500 truncate w-full text-center">{item.label}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
