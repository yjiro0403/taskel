'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useStore } from '@/store/useStore';
import {
    parseTaskDateFromQuery,
    parseTaskIdFromQuery,
    stripTaskQueryParam,
} from '@/lib/tasks/taskLinks';

/**
 * Handles permanent task links: `/{locale}/tasks?task=<id>`.
 *
 * After tasks finish loading, focuses the target (same navigation as search jumps)
 * and opens the Edit Item modal only when the user may edit (same rule as TaskItem).
 * Missing tasks or view-only access show a toast; the query param is always cleared.
 */
export default function TaskDeepLinkHandler() {
    const t = useTranslations('TaskLink');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const tasksLoaded = useStore((s) => s.tasksLoaded);
    const focusTask = useStore((s) => s.focusTask);
    const showToast = useStore((s) => s.showToast);

    /** Avoid re-processing the same task occurrence after we strip the query params. */
    const handledTaskKeyRef = useRef<string | null>(null);

    useEffect(() => {
        const taskId = parseTaskIdFromQuery(searchParams);
        if (!taskId) {
            handledTaskKeyRef.current = null;
            return;
        }
        const taskDate = parseTaskDateFromQuery(searchParams);
        const taskKey = `${taskId}:${taskDate ?? ''}`;

        // Wait until the initial task fetch finishes so "not found" is reliable.
        if (!tasksLoaded) {
            return;
        }

        if (handledTaskKeyRef.current === taskKey) {
            return;
        }
        handledTaskKeyRef.current = taskKey;

        const result = focusTask(taskId, { openEdit: true, date: taskDate });
        if (result.status === 'not_found') {
            // Missing or not returned under current RLS / ownership — stay on tasks UI.
            showToast(t('not_found'), 'error');
        } else if (!result.openedEdit) {
            // Task is visible (e.g. project viewer) but Edit Item is not allowed.
            showToast(t('no_edit_access'), 'error');
        }

        // Drop ?task= so reload after close does not re-open, while history stays shareable
        // (the original URL still worked for the initial open).
        const cleanUrl = stripTaskQueryParam(pathname, searchParams.toString());
        router.replace(cleanUrl, { scroll: false });
    }, [tasksLoaded, searchParams, focusTask, showToast, t, pathname, router]);

    return null;
}
