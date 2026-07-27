'use client';

import { useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useStore } from '@/store/useStore';
import { buildTaskShareUrl, getLocalePrefixFromPathname } from '@/lib/tasks/taskLinks';

/**
 * Build and copy a permanent task share URL to the clipboard.
 * Uses the current locale prefix so pasted links open in the same language.
 */
export function useCopyTaskLink() {
    const t = useTranslations('TaskLink');
    const pathname = usePathname();
    const showToast = useStore((s) => s.showToast);

    const copyTaskLink = useCallback(
        async (taskId: string, taskDate?: string | null) => {
            if (typeof window === 'undefined') return false;

            const localePrefix = getLocalePrefixFromPathname(pathname);
            const url = buildTaskShareUrl(
                window.location.origin,
                taskId,
                localePrefix,
                taskDate
            );

            try {
                await navigator.clipboard.writeText(url);
                showToast(t('copied'), 'success');
                return true;
            } catch (error) {
                console.error('Failed to copy task link:', error);
                showToast(t('copy_failed'), 'error');
                return false;
            }
        },
        [pathname, showToast, t]
    );

    return { copyTaskLink };
}
