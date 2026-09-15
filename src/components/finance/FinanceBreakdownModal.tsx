'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { groupFinanceEntries } from '@/lib/finance/mapping';
import { formatSignedYen, formatYen } from '@/lib/finance/format';
import type { FinanceEntry, FinanceTypeGroup } from '@/lib/finance/types';
import { useStore } from '@/store/useStore';

interface FinanceBreakdownModalProps {
    isOpen: boolean;
    start: string;
    end: string;
    onClose: () => void;
}

export function FinanceBreakdownModal({ isOpen, start, end, onClose }: FinanceBreakdownModalProps) {
    const t = useTranslations('Finance');
    const locale = useLocale();
    const loadFinanceBreakdown = useStore((state) => state.loadFinanceBreakdown);
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const onCloseRef = useRef(onClose);
    const [loadNonce, setLoadNonce] = useState(0);
    const [result, setResult] = useState<
        | { start: string; end: string; ok: true; entries: FinanceEntry[] }
        | { start: string; end: string; ok: false; message: string }
        | null
    >(null);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        let cancelled = false;

        loadFinanceBreakdown(start, end)
            .then((rows) => {
                if (!cancelled) {
                    setResult({ start, end, ok: true, entries: rows });
                }
            })
            .catch((loadError: unknown) => {
                if (!cancelled) {
                    setResult({
                        start,
                        end,
                        ok: false,
                        message: loadError instanceof Error ? loadError.message : t('breakdownError'),
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isOpen, start, end, loadFinanceBreakdown, loadNonce, t]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setResult(null);
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') {
                return;
            }

            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (!focusable || focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus();
        };
    }, [isOpen]);

    const current = result && result.start === start && result.end === end ? result : null;
    const entries = current?.ok ? current.entries : [];
    const error = current && !current.ok ? current.message : null;
    const loading = isOpen && !current;

    if (!isOpen) {
        return null;
    }

    const groups = groupFinanceEntries(entries);

    return createPortal(
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    setResult(null);
                    onClose();
                }
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
            >
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <h2 id={titleId} className="text-lg font-semibold text-gray-800">
                        {t('breakdownTitle')}
                    </h2>
                    <button
                        type="button"
                        ref={closeButtonRef}
                        onClick={() => {
                            setResult(null);
                            onClose();
                        }}
                        className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label={t('breakdownClose')}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 max-h-[70vh] overflow-y-auto space-y-4">
                    {loading && <p role="status" className="text-sm text-gray-500">{t('breakdownLoading')}</p>}
                    {error && (
                        <div className="space-y-2">
                            <p role="alert" className="text-sm text-red-600 font-medium">{t('breakdownError')}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    setResult(null);
                                    setLoadNonce((nonce) => nonce + 1);
                                }}
                                className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                {t('loadFinanceRetry')}
                            </button>
                        </div>
                    )}
                    {!loading && !error && groups.length === 0 && (
                        <p className="text-sm text-gray-500">{t('breakdownEmpty')}</p>
                    )}
                    {!loading && !error && groups.map((group) => (
                        <TypeGroupSection key={group.entryType} group={group} locale={locale} />
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}

function TypeGroupSection({ group, locale }: { group: FinanceTypeGroup; locale: string }) {
    const t = useTranslations('Finance');
    const typeLabel = group.entryType === 'expense' ? t('expense') : t('income');

    return (
        <section className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold text-gray-800">{typeLabel}</h3>
                    <p className="text-xs text-gray-500">{t('breakdownCount', { count: group.count })}</p>
                </div>
                <p className="text-sm font-bold text-gray-900">
                    {formatSignedYen(group.total, group.entryType, locale)}
                </p>
            </div>
            <div className="divide-y divide-gray-100">
                {group.categories.map((category) => (
                    <div key={category.label} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 break-words text-sm font-medium text-gray-800">{category.label}</p>
                            <p className="shrink-0 text-sm text-gray-700">
                                {t('breakdownTotal')}: {formatYen(category.total, locale)}
                                <span className="ml-2 text-xs text-gray-500">
                                    {t('breakdownCount', { count: category.count })}
                                </span>
                            </p>
                        </div>
                        <ul className="space-y-2">
                            {category.entries.map((entry) => (
                                <li key={entry.id} className="text-sm text-gray-700">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-medium text-gray-800 truncate">
                                                {entry.taskTitleSnapshot || t('breakdownNoTask')}
                                            </p>
                                            {entry.memo && (
                                                <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap break-words">
                                                    {entry.memo}
                                                </p>
                                            )}
                                            <p className="text-[11px] text-gray-400 mt-0.5">{entry.occurredOn}</p>
                                        </div>
                                        <p className="shrink-0 font-medium">
                                            {formatSignedYen(entry.amountYen, entry.entryType, locale)}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
}
