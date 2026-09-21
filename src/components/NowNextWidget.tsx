'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Timer } from 'lucide-react';

import { useNowNext } from '@/hooks/useNowNext';
import {
    describeDuration,
    hasScheduleConflict,
    type CurrentAction,
    type DurationParts,
    type NextAction,
} from '@/lib/tasks/nowNext';
import { formatTime } from '@/lib/timeUtils';
import { useStore } from '@/store/useStore';
import type { Task } from '@/types';

/** Per-device UI preference only; nothing here needs to sync across devices. */
const COLLAPSED_STORAGE_KEY = 'taskel_now_next_collapsed';
/** Next fixed start within this → red and pulsing. */
const URGENT_MS = 5 * 60_000;
/** Next fixed start within this → amber. */
const SOON_MS = 15 * 60_000;

type Tone = 'calm' | 'soon' | 'urgent';

function readCollapsed(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function writeCollapsed(value: boolean): void {
    try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? '1' : '0');
    } catch {
        // Private mode / blocked storage: the toggle still works for this page view.
    }
}

function nextTone(next: NextAction | null): Tone {
    if (!next || next.kind !== 'fixed') return 'calm';
    if (next.untilMs <= URGENT_MS) return 'urgent';
    if (next.untilMs <= SOON_MS) return 'soon';
    return 'calm';
}

const TONE_TEXT: Record<Tone, string> = {
    calm: 'text-gray-900',
    soon: 'text-amber-700',
    urgent: 'text-red-600',
};

const TONE_BORDER: Record<Tone, string> = {
    calm: 'border-gray-200',
    soon: 'border-amber-300',
    urgent: 'border-red-300 ring-1 ring-red-200',
};

type Translate = ReturnType<typeof useTranslations<'NowNext'>>;

function useDurationFormatter(t: Translate) {
    return useCallback(
        (parts: DurationParts): string => {
            switch (parts.mode) {
                case 'hm':
                    return t('duration_hm', { hours: parts.hours, minutes: parts.minutes });
                case 'h':
                    return t('duration_h', { hours: parts.hours });
                case 'm':
                    return t('duration_m', { minutes: parts.minutes });
                case 'ms':
                    return t('duration_ms', { minutes: parts.minutes, seconds: parts.seconds });
                case 's':
                    return t('duration_s', { seconds: parts.seconds });
            }
        },
        [t]
    );
}

/** "残り 12分" / "12 min left": the label stays small, the number (the <n> chunk) is big. */
function BigNumber({ className, children }: { className: string; children: ReactNode }) {
    return <span className={clsx('text-3xl font-bold font-mono tabular-nums leading-none', className)}>{children}</span>;
}

interface LaneLabelProps {
    icon: typeof Timer;
    text: string;
    className?: string;
    pulse?: boolean;
}

function LaneLabel({ icon: Icon, text, className, pulse }: LaneLabelProps) {
    return (
        <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide', className ?? 'text-gray-600')}>
            <Icon size={14} />
            {text}
            {pulse && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true" />}
        </span>
    );
}

function locationLabel(task: Task, viewedDate: string, t: Translate): string | null {
    if (!task.date || task.date.trim() === '') return t('unscheduled');
    if (task.date === viewedDate) return null;
    return task.date;
}

interface TitleButtonProps {
    task: Task;
    label: string;
    viewedDate: string;
    t: Translate;
    onJump: (task: Task) => void;
}

function TitleButton({ task, label, viewedDate, t, onJump }: TitleButtonProps) {
    const where = locationLabel(task, viewedDate, t);
    return (
        <button
            type="button"
            onClick={() => onJump(task)}
            title={label}
            aria-label={label}
            className="mt-1 w-full text-left text-lg font-bold text-gray-900 leading-snug hover:text-blue-700 cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
            <span className="line-clamp-2">{task.title}</span>
            {where && (
                <span className="mt-0.5 block text-[11px] font-medium text-gray-500 tabular-nums">{where}</span>
            )}
        </button>
    );
}

interface NowLaneProps {
    current: CurrentAction | null;
    conflict: boolean;
    viewedDate: string;
    t: Translate;
    formatDuration: (parts: DurationParts) => string;
    onJump: (task: Task) => void;
}

function NowLane({ current, conflict, viewedDate, t, formatDuration, onJump }: NowLaneProps) {
    if (!current) {
        return (
            <div className="p-4 min-w-0">
                <LaneLabel icon={Timer} text={t('now')} />
                <p className="mt-1 text-base font-semibold text-gray-700">{t('nothing_now')}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t('start_hint')}</p>
            </div>
        );
    }

    const overrun = current.remainingMs !== null && current.remainingMs < 0;
    const reading =
        current.remainingMs === null
            ? { key: 'elapsed' as const, parts: describeDuration(current.elapsedMs, { roundUp: false }), className: 'text-gray-900' }
            : overrun
              ? { key: 'overrun' as const, parts: describeDuration(current.remainingMs, { roundUp: false }), className: 'text-red-600' }
              : { key: 'remaining' as const, parts: describeDuration(current.remainingMs, { roundUp: true }), className: 'text-blue-700' };
    const jumpLabel = t('jump_named', { title: current.task.title });

    return (
        <div className="p-4 min-w-0">
            <div className="flex items-center justify-between gap-2 pr-8 sm:pr-0">
                <LaneLabel icon={Timer} text={t('now')} className="text-blue-700" />
                {current.concurrentCount > 0 && (
                    <span className="text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5">
                        {t('concurrent', { count: current.concurrentCount })}
                    </span>
                )}
            </div>
            <TitleButton
                task={current.task}
                label={jumpLabel}
                viewedDate={viewedDate}
                t={t}
                onJump={onJump}
            />
            <button
                type="button"
                onClick={() => onJump(current.task)}
                title={jumpLabel}
                aria-label={jumpLabel}
                className="mt-1.5 w-full text-left cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <span className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
                    <span className={clsx('text-sm font-medium', reading.className)}>
                        {t.rich(reading.key, {
                            time: formatDuration(reading.parts),
                            n: (chunks) => <BigNumber className={reading.className}>{chunks}</BigNumber>,
                        })}
                    </span>
                    {current.endAt !== null && (
                        <span className="text-sm font-mono font-semibold text-gray-600">
                            {t('ends_at', { time: formatTime(new Date(current.endAt)) })}
                        </span>
                    )}
                </span>
            </button>
            {conflict && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle size={12} />
                    {t('conflict')}
                </p>
            )}
            {current.concurrentTasks.length > 0 && (
                <div className="mt-3 pt-2 border-t border-blue-100">
                    <p className="text-[11px] font-semibold text-blue-700">{t('concurrent_heading')}</p>
                    <ul className="mt-1 space-y-0.5">
                        {current.concurrentTasks.map((task) => {
                            const where = locationLabel(task, viewedDate, t);
                            return (
                                <li key={task.id}>
                                    <button
                                        type="button"
                                        onClick={() => onJump(task)}
                                        title={t('jump_named', { title: task.title })}
                                        aria-label={t('jump_named', { title: task.title })}
                                        className="w-full text-left text-sm font-medium text-gray-800 hover:text-blue-700 cursor-pointer rounded px-0.5 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                    >
                                        <span className="line-clamp-1">{task.title}</span>
                                        {where && (
                                            <span className="block text-[11px] font-medium text-gray-500 tabular-nums">
                                                {where}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}

interface NextLaneProps {
    next: NextAction | null;
    tone: Tone;
    viewedDate: string;
    t: Translate;
    formatDuration: (parts: DurationParts) => string;
    onJump: (task: Task) => void;
}

function NextLane({ next, tone, viewedDate, t, formatDuration, onJump }: NextLaneProps) {
    if (!next) {
        return (
            <div className="p-4 min-w-0">
                <LaneLabel icon={ArrowRight} text={t('next')} />
                <p className="mt-1 text-base font-semibold text-gray-700">{t('nothing_next')}</p>
            </div>
        );
    }

    const toneText = TONE_TEXT[tone];

    return (
        <div className="p-4 min-w-0">
            {/* sm:pr-8 keeps the queue hint clear of the collapse button in the two-column layout */}
            <div className="flex items-center justify-between gap-2 sm:pr-8">
                <LaneLabel
                    icon={ArrowRight}
                    text={t('next')}
                    className={tone === 'calm' ? 'text-gray-600' : toneText}
                    pulse={tone === 'urgent'}
                />
                {next.kind === 'queued' && <span className="text-[11px] text-gray-600">{t('queued_hint')}</span>}
            </div>
            <TitleButton
                task={next.task}
                label={t('jump_named', { title: next.task.title })}
                viewedDate={viewedDate}
                t={t}
                onJump={onJump}
            />
            {next.kind === 'fixed' ? (
                <div className="mt-1.5 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
                    <span className={clsx('text-xl font-bold font-mono tabular-nums', toneText)}>
                        {t('starts_at', { time: formatTime(new Date(next.startAt)) })}
                    </span>
                    {next.untilMs <= 0 ? (
                        <span className={clsx('text-3xl font-bold leading-none', toneText)}>{t('due_now')}</span>
                    ) : (
                        <span className={clsx('text-sm font-medium', toneText)}>
                            {t.rich('until', {
                                time: formatDuration(describeDuration(next.untilMs, { roundUp: true })),
                                n: (chunks) => <BigNumber className={toneText}>{chunks}</BigNumber>,
                            })}
                        </span>
                    )}
                </div>
            ) : (
                <p className="mt-1.5 text-sm font-medium text-gray-600">{t('no_time')}</p>
            )}
        </div>
    );
}

/**
 * Glanceable "Now / Next" panel for the daily task page.
 *
 * Shows the running task with its remaining (or overrun) time and the next
 * fixed-time task with a live countdown, so a misread "10:09" gets caught by a
 * big "10:01 · in 3m 20s". Always reflects the system's local today, even while
 * another date is being browsed. Data comes from useNowNext / computeNowNext.
 */
export default function NowNextWidget() {
    const t = useTranslations('NowNext');
    const { snapshot } = useNowNext();
    const focusTask = useStore((state) => state.focusTask);
    const viewedDate = useStore((state) => state.currentDate);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const formatDuration = useDurationFormatter(t);

    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const value = !prev;
            writeCollapsed(value);
            return value;
        });
    };

    if (!snapshot) return null;

    const { current, next } = snapshot;
    const tone = nextTone(next);
    const conflict = hasScheduleConflict(snapshot);
    const jumpTo = (task: Task) => {
        focusTask(task.id, { date: task.date || null });
    };

    const summaryFor = (): ReactNode => {
        const nowText = current
            ? current.remainingMs === null
                ? formatDuration(describeDuration(current.elapsedMs, { roundUp: false }))
                : formatDuration(describeDuration(current.remainingMs, { roundUp: current.remainingMs >= 0 }))
            : null;
        const nextText =
            next && next.kind === 'fixed'
                ? `${formatTime(new Date(next.startAt))} · ${
                      next.untilMs <= 0
                          ? t('due_now')
                          : formatDuration(describeDuration(next.untilMs, { roundUp: true }))
                  }`
                : null;
        return (
            <>
                <span className="inline-flex items-center gap-1.5 min-w-0 shrink">
                    <Timer size={14} className="shrink-0 text-blue-700" />
                    <span className="truncate font-semibold text-gray-900">{current ? current.task.title : t('nothing_now')}</span>
                    {nowText && (
                        <span
                            className={clsx(
                                'shrink-0 font-mono tabular-nums font-bold',
                                current && current.remainingMs !== null && current.remainingMs < 0 ? 'text-red-600' : 'text-blue-700'
                            )}
                        >
                            {nowText}
                        </span>
                    )}
                </span>
                <span className="inline-flex items-center gap-1.5 min-w-0 shrink">
                    <ArrowRight size={14} className={clsx('shrink-0', tone === 'calm' ? 'text-gray-600' : TONE_TEXT[tone])} />
                    <span className="truncate font-semibold text-gray-900">{next ? next.task.title : t('nothing_next')}</span>
                    {nextText && <span className={clsx('shrink-0 font-mono tabular-nums font-bold', TONE_TEXT[tone])}>{nextText}</span>}
                </span>
            </>
        );
    };

    return (
        <section aria-label={t('aria_label')} className="sticky top-16 z-20">
            <div className={clsx('relative rounded-xl border bg-white shadow-md overflow-hidden', TONE_BORDER[tone])}>
                {collapsed ? (
                    <button
                        type="button"
                        onClick={toggleCollapsed}
                        aria-expanded={false}
                        title={t('expand')}
                        className="w-full flex items-center gap-4 px-4 py-2.5 text-sm text-left cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                        {summaryFor()}
                        <ChevronDown size={18} className="ml-auto shrink-0 text-gray-500" />
                    </button>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                            <NowLane
                                current={current}
                                conflict={conflict}
                                viewedDate={viewedDate}
                                t={t}
                                formatDuration={formatDuration}
                                onJump={jumpTo}
                            />
                            <NextLane
                                next={next}
                                tone={tone}
                                viewedDate={viewedDate}
                                t={t}
                                formatDuration={formatDuration}
                                onJump={jumpTo}
                            />
                        </div>
                        <button
                            type="button"
                            onClick={toggleCollapsed}
                            aria-expanded={true}
                            title={t('collapse')}
                            aria-label={t('collapse')}
                            className="absolute top-2 right-2 p-1.5 rounded text-gray-500 hover:text-gray-800 hover:bg-gray-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        >
                            <ChevronUp size={18} />
                        </button>
                    </>
                )}
            </div>
        </section>
    );
}
