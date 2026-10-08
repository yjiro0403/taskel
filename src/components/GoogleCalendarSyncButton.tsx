'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';
import {
    clearGoogleCalendarProviderToken,
    clearPendingGoogleCalendarSync,
    isGoogleCalendarSyncDataReady,
    readGoogleCalendarProviderToken,
    readPendingGoogleCalendarSync,
    resolveGoogleCalendarSyncReturnPath,
    writePendingGoogleCalendarSync,
    writeStoredCurrentDate,
    type GoogleCalendarSyncReturnPath,
    type PendingGoogleCalendarSync,
} from '@/lib/calendarService';

type GoogleCalendarSyncButtonProps = {
    startDate: string;
    endDate: string;
    returnTo: GoogleCalendarSyncReturnPath;
    label: string;
    syncingLabel?: string;
    helper?: string;
    className?: string;
};

async function startGoogleCalendarOAuth(pending: PendingGoogleCalendarSync) {
    writePendingGoogleCalendarSync(pending);
    if (pending.start === pending.end) {
        writeStoredCurrentDate(pending.start);
    }

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${pending.returnTo}`;
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo,
            scopes: 'https://www.googleapis.com/auth/calendar.readonly',
            queryParams: {
                access_type: 'offline',
                prompt: 'consent',
            },
        },
    });
    if (error) {
        throw error;
    }
}

function requestMeetingNotificationPermission() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') {
        return;
    }
    // Must start during the click, before any await, or the browser drops the prompt.
    void Notification.requestPermission().catch(() => undefined);
}

export function GoogleCalendarSyncButton({
    startDate,
    endDate,
    returnTo,
    label,
    syncingLabel = '取り込んでいます…',
    helper,
    className = 'text-sm bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60',
}: GoogleCalendarSyncButtonProps) {
    const user = useStore((state) => state.user);
    const syncGoogleCalendar = useStore((state) => state.syncGoogleCalendar);
    const [isSyncing, setIsSyncing] = useState(false);

    const handleSync = async () => {
        if (!user || isSyncing) return;
        requestMeetingNotificationPermission();
        setIsSyncing(true);

        try {
            const supabase = createClient();
            const { data } = await supabase.auth.getSession();
            const accessToken = readGoogleCalendarProviderToken(
                data.session?.provider_token,
                user.uid
            );
            const pending = {
                start: startDate,
                end: endDate,
                returnTo: resolveGoogleCalendarSyncReturnPath(window.location.pathname, returnTo),
            };

            if (accessToken) {
                const result = await syncGoogleCalendar(
                    accessToken,
                    startDate,
                    startDate === endDate ? undefined : endDate
                );
                if (result === 'auth_required') {
                    clearGoogleCalendarProviderToken();
                    await startGoogleCalendarOAuth(pending);
                }
            } else {
                await startGoogleCalendarOAuth(pending);
            }
        } catch (error) {
            console.error('Sync failed', error);
            alert('Sync failed. Check console.');
        } finally {
            setIsSyncing(false);
        }
    };

    const button = (
        <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className={`${className} shrink-0 whitespace-nowrap`}
        >
            {isSyncing ? syncingLabel : label}
        </button>
    );

    if (!helper) return button;

    return (
        <div className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            {button}
            <p className="text-xs text-gray-500 leading-relaxed sm:flex-1 sm:min-w-0">{helper}</p>
        </div>
    );
}

type ResumeLock = { started: boolean };
let resumeLock: ResumeLock | null = null;

/** One resume for the whole app, so OAuth can return on /weekly or /monthly. */
export function GoogleCalendarSyncResume() {
    const user = useStore((state) => state.user);
    const tasksLoaded = useStore((state) => state.tasksLoaded);
    const initialDataStatus = useStore((state) => state.initialDataStatus);
    const sectionCount = useStore((state) => state.sections.length);
    const setCurrentDate = useStore((state) => state.setCurrentDate);
    const syncGoogleCalendar = useStore((state) => state.syncGoogleCalendar);

    useEffect(() => {
        const pending = readPendingGoogleCalendarSync();
        if (!pending || !user) return;

        // Single-day imports restore the day. A range must not jump the UI to one date.
        if (pending.start === pending.end && pending.start !== useStore.getState().currentDate) {
            setCurrentDate(pending.start);
        }

        if (!isGoogleCalendarSyncDataReady(initialDataStatus, tasksLoaded, sectionCount)) {
            return;
        }
        if (resumeLock) return;

        const lock: ResumeLock = { started: false };
        resumeLock = lock;
        let cancelled = false;

        const syncPending = async () => {
            try {
                const supabase = createClient();
                const sessionProviderToken = (await supabase.auth.getSession()).data.session?.provider_token;
                const accessToken = readGoogleCalendarProviderToken(sessionProviderToken, user.uid);
                if (!accessToken || cancelled || resumeLock !== lock) return;

                lock.started = true;
                clearPendingGoogleCalendarSync();
                const result = await syncGoogleCalendar(
                    accessToken,
                    pending.start,
                    pending.start === pending.end ? undefined : pending.end
                );
                if (result === 'auth_required') {
                    clearGoogleCalendarProviderToken();
                    alert('Google Calendar access was not granted. Please try connecting again.');
                }
            } finally {
                if (resumeLock === lock) {
                    resumeLock = null;
                }
            }
        };

        void syncPending();
        return () => {
            cancelled = true;
            if (!lock.started && resumeLock === lock) {
                resumeLock = null;
            }
        };
    }, [
        initialDataStatus,
        sectionCount,
        setCurrentDate,
        syncGoogleCalendar,
        tasksLoaded,
        user,
    ]);

    return null;
}
