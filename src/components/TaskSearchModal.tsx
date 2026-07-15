'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Calendar, FileText, Search, Type, X } from 'lucide-react';
import clsx from 'clsx';

import { useStore } from '@/store/useStore';
import { searchTasks, type TaskSearchResult } from '@/lib/tasks/searchTasks';
import type { TaskStatus } from '@/types';

const HIGHLIGHT_MS = 3500;

function statusBadgeClass(status: TaskStatus): string {
    switch (status) {
        case 'done':
            return 'bg-green-50 text-green-700 border-green-200';
        case 'in_progress':
            return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'skipped':
            return 'bg-amber-50 text-amber-700 border-amber-200';
        default:
            return 'bg-gray-50 text-gray-600 border-gray-200';
    }
}

/**
 * Global task search (title + memo). Mounted once via AuthProvider; opens via header icon or shortcuts.
 * Content remounts on each open so form state resets without effect-based setState.
 */
export default function TaskSearchModal() {
    const isOpen = useStore((s) => s.isSearchModalOpen);

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(<TaskSearchModalContent />, document.body);
}

function TaskSearchModalContent() {
    const t = useTranslations('Search');
    const router = useRouter();
    const pathname = usePathname();

    const closeSearchModal = useStore((s) => s.closeSearchModal);
    const tasks = useStore((s) => s.tasks);
    const setCurrentDate = useStore((s) => s.setCurrentDate);
    const setRightSidebarOpen = useStore((s) => s.setRightSidebarOpen);
    const setHighlightedTaskId = useStore((s) => s.setHighlightedTaskId);

    const [query, setQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [includeUndated, setIncludeUndated] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Focus search field after mount (open)
    useEffect(() => {
        const id = window.setTimeout(() => inputRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
    }, []);

    // Escape to close; lock body scroll
    useEffect(() => {
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSearchModal();
            }
        };

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [closeSearchModal]);

    const results = useMemo(
        () =>
            searchTasks(tasks, {
                query,
                dateFrom,
                dateTo,
                includeUndated,
                limit: 50,
            }),
        [tasks, query, dateFrom, dateTo, includeUndated]
    );

    const safeActiveIndex =
        results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

    // Scroll active item into view
    useEffect(() => {
        if (!listRef.current) return;
        const el = listRef.current.querySelector<HTMLElement>(
            `[data-search-index="${safeActiveIndex}"]`
        );
        el?.scrollIntoView({ block: 'nearest' });
    }, [safeActiveIndex, results.length]);

    const navigateToResult = useCallback(
        (result: TaskSearchResult) => {
            const { task } = result;
            closeSearchModal();

            if (highlightTimerRef.current) {
                clearTimeout(highlightTimerRef.current);
            }

            const localeMatch = pathname.match(/^\/(en|ja)/);
            const localePrefix = localeMatch ? localeMatch[0] : '';
            const tasksPath = `${localePrefix}/tasks`;
            const onTasksPage = pathname === tasksPath || pathname.endsWith('/tasks');

            if (task.date && task.date.trim() !== '') {
                setCurrentDate(task.date);
                setRightSidebarOpen(false);
            } else {
                // Unscheduled: open backlog sidebar so the item is visible
                setRightSidebarOpen(true);
            }

            setHighlightedTaskId(task.id);
            highlightTimerRef.current = setTimeout(() => {
                setHighlightedTaskId(null);
                highlightTimerRef.current = null;
            }, HIGHLIGHT_MS);

            if (!onTasksPage) {
                router.push(tasksPath);
            }
        },
        [
            closeSearchModal,
            pathname,
            router,
            setCurrentDate,
            setHighlightedTaskId,
            setRightSidebarOpen,
        ]
    );

    const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (results.length === 0) return;
            setActiveIndex((i) => {
                const current = results.length === 0 ? 0 : Math.min(i, results.length - 1);
                return (current + 1) % results.length;
            });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length === 0) return;
            setActiveIndex((i) => {
                const current = results.length === 0 ? 0 : Math.min(i, results.length - 1);
                return (current - 1 + results.length) % results.length;
            });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = results[safeActiveIndex];
            if (target) navigateToResult(target);
        }
    };

    const hasFilters = query.trim() !== '' || dateFrom !== '' || dateTo !== '';
    const showIncludeUndated = dateFrom !== '' || dateTo !== '';

    return (
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('title')}
        >
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
                onClick={closeSearchModal}
            />

            <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[75vh]">
                {/* Search input */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                    <Search className="text-gray-400 shrink-0" size={20} />
                    <input
                        ref={inputRef}
                        type="search"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        onKeyDown={onInputKeyDown}
                        placeholder={t('placeholder')}
                        className="flex-1 min-w-0 text-base text-gray-900 placeholder:text-gray-400 outline-none bg-transparent"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <button
                        type="button"
                        onClick={closeSearchModal}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label={t('close')}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Date filters */}
                <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 flex flex-wrap items-center gap-2 text-sm">
                    <Calendar size={14} className="text-gray-400 shrink-0" />
                    <label className="flex items-center gap-1.5 text-gray-600">
                        <span className="text-xs text-gray-500">{t('date_from')}</span>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => {
                                setDateFrom(e.target.value);
                                setActiveIndex(0);
                            }}
                            className="px-2 py-1 border border-gray-200 rounded-md bg-white text-gray-900 text-xs focus:outline-none focus:border-blue-400"
                        />
                    </label>
                    <span className="text-gray-300">–</span>
                    <label className="flex items-center gap-1.5 text-gray-600">
                        <span className="text-xs text-gray-500">{t('date_to')}</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => {
                                setDateTo(e.target.value);
                                setActiveIndex(0);
                            }}
                            className="px-2 py-1 border border-gray-200 rounded-md bg-white text-gray-900 text-xs focus:outline-none focus:border-blue-400"
                        />
                    </label>
                    {showIncludeUndated && (
                        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={includeUndated}
                                onChange={(e) => {
                                    setIncludeUndated(e.target.checked);
                                    setActiveIndex(0);
                                }}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            {t('include_undated')}
                        </label>
                    )}
                </div>

                {/* Results */}
                <div ref={listRef} className="flex-1 overflow-y-auto min-h-[12rem]">
                    {!hasFilters && (
                        <div className="px-4 py-10 text-center text-sm text-gray-500">
                            <p className="font-medium text-gray-700 mb-1">{t('hint_title')}</p>
                            <p className="text-gray-500">{t('hint_body')}</p>
                            <p className="mt-3 text-xs text-gray-400">{t('hint_shortcut')}</p>
                        </div>
                    )}

                    {hasFilters && results.length === 0 && (
                        <div className="px-4 py-10 text-center text-sm text-gray-500">
                            {t('no_results')}
                        </div>
                    )}

                    {results.map((result, index) => {
                        const { task, matchedIn, memoSnippet } = result;
                        const isActive = index === safeActiveIndex;
                        const dateLabel =
                            task.date && task.date.trim() !== ''
                                ? task.date
                                : t('undated');

                        return (
                            <button
                                key={task.id}
                                type="button"
                                data-search-index={index}
                                onClick={() => navigateToResult(result)}
                                onMouseEnter={() => setActiveIndex(index)}
                                className={clsx(
                                    'w-full text-left px-4 py-3 border-b border-gray-50 transition-colors',
                                    isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                                )}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                            <span className="text-xs font-medium text-gray-500 tabular-nums">
                                                {dateLabel}
                                            </span>
                                            <span
                                                className={clsx(
                                                    'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border font-medium',
                                                    statusBadgeClass(task.status)
                                                )}
                                            >
                                                {t(`status.${task.status}`)}
                                            </span>
                                            {matchedIn.includes('title') && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600">
                                                    <Type size={10} />
                                                    {t('match_title')}
                                                </span>
                                            )}
                                            {matchedIn.includes('memo') && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-600">
                                                    <FileText size={10} />
                                                    {t('match_memo')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                            {task.title}
                                        </p>
                                        {memoSnippet && (
                                            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">
                                                {memoSnippet}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-400 flex items-center justify-between gap-2">
                    <span>
                        {hasFilters
                            ? t('result_count', { count: results.length })
                            : t('footer_idle')}
                    </span>
                    <span className="hidden sm:inline">{t('footer_keys')}</span>
                </div>
            </div>
        </div>
    );
}
