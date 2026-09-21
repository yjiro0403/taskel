'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import {
    clearGoogleCalendarProviderToken,
    isGoogleCalendarSyncDataReady,
    parsePendingCalendarSync,
    PENDING_GOOGLE_CALENDAR_SYNC_KEY,
    readGoogleCalendarProviderToken,
    serializePendingCalendarSync,
    type CalendarSyncRange,
    writeStoredCurrentDate,
} from '@/lib/calendarService';
import { useStore } from '@/store/useStore';

export function useGoogleCalendarSync() {
    const pathname = usePathname();
    const user = useStore((state) => state.user);
    const initialDataStatus = useStore((state) => state.initialDataStatus);
    const tasksLoaded = useStore((state) => state.tasksLoaded);
    const sections = useStore((state) => state.sections);
    const setCurrentDate = useStore((state) => state.setCurrentDate);
    const syncGoogleCalendar = useStore((state) => state.syncGoogleCalendar);
    const [isSyncing, setIsSyncing] = useState(false);
    const pendingInFlight = useRef<string | null>(null);

    const startGoogleCalendarOAuth = useCallback(async (range: CalendarSyncRange) => {
        localStorage.setItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY, serializePendingCalendarSync(range));
        writeStoredCurrentDate(range.start);

        const supabase = createClient();
        const nextPath = pathname || '/tasks';
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
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
    }, [pathname]);

    const syncRange = useCallback(async (range: CalendarSyncRange) => {
        if (!user) return;
        setIsSyncing(true);
        try {
            const supabase = createClient();
            const { data } = await supabase.auth.getSession();
            const accessToken = readGoogleCalendarProviderToken(
                data.session?.provider_token,
                user.uid
            );

            if (accessToken) {
                const result = await syncGoogleCalendar(accessToken, range);
                if (result === 'auth_required') {
                    clearGoogleCalendarProviderToken();
                    await startGoogleCalendarOAuth(range);
                }
            } else {
                await startGoogleCalendarOAuth(range);
            }
        } catch (error) {
            console.error('Sync failed', error);
            alert('Sync failed. Check console.');
        } finally {
            setIsSyncing(false);
        }
    }, [startGoogleCalendarOAuth, syncGoogleCalendar, user]);

    useEffect(() => {
        const pending = parsePendingCalendarSync(
            localStorage.getItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY)
        );
        if (!pending || !user) return;

        if (pending.start !== useStore.getState().currentDate) {
            setCurrentDate(pending.start);
        }

        if (
            !isGoogleCalendarSyncDataReady(
                initialDataStatus,
                tasksLoaded,
                sections.length
            ) ||
            pendingInFlight.current === serializePendingCalendarSync(pending)
        ) {
            return;
        }

        let cancelled = false;
        const syncPending = async () => {
            const supabase = createClient();
            const sessionProviderToken =
                (await supabase.auth.getSession()).data.session?.provider_token;
            const accessToken = readGoogleCalendarProviderToken(
                sessionProviderToken,
                user.uid
            );
            if (!accessToken || cancelled) return;

            pendingInFlight.current = serializePendingCalendarSync(pending);
            localStorage.removeItem(PENDING_GOOGLE_CALENDAR_SYNC_KEY);
            try {
                const result = await syncGoogleCalendar(accessToken, pending);
                if (result === 'auth_required') {
                    clearGoogleCalendarProviderToken();
                    alert(
                        'Google Calendar access was not granted. Please try connecting again.'
                    );
                }
            } finally {
                pendingInFlight.current = null;
            }
        };

        void syncPending();
        return () => {
            cancelled = true;
        };
    }, [
        initialDataStatus,
        sections.length,
        setCurrentDate,
        syncGoogleCalendar,
        tasksLoaded,
        user,
    ]);

    return { isSyncing, syncRange };
}
