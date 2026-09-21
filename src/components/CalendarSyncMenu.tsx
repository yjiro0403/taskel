'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarSync, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface CalendarSyncMenuProps {
    isSyncing: boolean;
    onSyncDay?: () => void;
    onSyncWeek: () => void;
    onSyncMonth: () => void;
}

export function CalendarSyncMenu({
    isSyncing,
    onSyncDay,
    onSyncWeek,
    onSyncMonth,
}: CalendarSyncMenuProps) {
    const t = useTranslations('CalendarSync');
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    const run = (action: () => void) => {
        setOpen(false);
        action();
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                disabled={isSyncing}
                className="p-2 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title={isSyncing ? t('syncing') : t('sync')}
                aria-label={isSyncing ? t('syncing') : t('sync')}
                aria-expanded={open}
                aria-haspopup="menu"
            >
                {isSyncing ? (
                    <RefreshCw size={18} className="animate-spin" />
                ) : (
                    <CalendarSync size={18} />
                )}
            </button>
            {open && !isSyncing && (
                <div
                    role="menu"
                    className="absolute right-0 mt-1 z-30 min-w-[10rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                    {onSyncDay && (
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => run(onSyncDay)}
                            className={clsx(
                                'w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50'
                            )}
                        >
                            {t('this_day')}
                        </button>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => run(onSyncWeek)}
                        className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                        {t('this_week')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => run(onSyncMonth)}
                        className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                        {t('this_month')}
                    </button>
                </div>
            )}
        </div>
    );
}
