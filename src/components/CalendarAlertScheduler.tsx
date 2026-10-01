'use client';

import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import {
    CALENDAR_ALERTS_CHANGED_EVENT,
    CALENDAR_ALERTS_STORAGE_KEY,
    markCalendarAlertsFired,
    meetingAlertLines,
    partitionDueCalendarAlerts,
    readCalendarAlerts,
    type CalendarAlert,
} from '@/lib/calendarAlerts';

const ARM_WINDOW_MS = 24 * 60 * 60 * 1000;
const REARM_INTERVAL_MS = 60 * 1000;

function matchingTaskIsDone(alert: CalendarAlert): boolean {
    return useStore.getState().tasks.some((task) => (
        task.status === 'done'
        && task.title === alert.title
        && task.date === alert.date
        && (task.scheduledStart ?? '') === alert.scheduledStart
    ));
}

function announceMeetings(alerts: readonly CalendarAlert[]) {
    if (alerts.length === 0) return;
    const body = meetingAlertLines(alerts);
    const title = alerts.length === 1 ? 'まもなく予定です' : `まもなく予定が${alerts.length}件あります`;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification(title, { body });
            return;
        } catch {
            // Fall through. A denied or missing Notification API still needs a visible warning.
        }
    }
    // Toasts dismiss in 4 seconds, which is how a meeting gets missed.
    window.alert(`${title}\n${body}`);
}

/**
 * Local reminders for imported calendar events. Fires while this tab is open,
 * and catches meetings whose reminder passed when the app is opened again.
 */
export function CalendarAlertScheduler() {
    useEffect(() => {
        let timeoutId: number | null = null;
        let firing = false;

        const clearArmedTimeout = () => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const arm = () => {
            clearArmedTimeout();
            const now = Date.now();
            const next = readCalendarAlerts()
                .filter((alert) => !alert.fired && alert.alertAt > now && alert.alertAt <= now + ARM_WINDOW_MS)
                .sort((a, b) => a.alertAt - b.alertAt)[0];
            if (!next) return;
            timeoutId = window.setTimeout(() => {
                void fireDue();
            }, Math.max(0, next.alertAt - now));
        };

        const fireDue = async () => {
            if (firing) return;
            firing = true;
            try {
                const now = Date.now();
                const { announce, markFired } = partitionDueCalendarAlerts(
                    readCalendarAlerts(),
                    now,
                    matchingTaskIsDone
                );
                if (announce.length > 0) {
                    announceMeetings(announce);
                }
                markCalendarAlertsFired(markFired);
            } finally {
                firing = false;
                arm();
            }
        };

        const onAlertsChanged = () => {
            void fireDue();
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                void fireDue();
            }
        };

        const onStorage = (event: StorageEvent) => {
            if (event.key && event.key !== CALENDAR_ALERTS_STORAGE_KEY) return;
            onAlertsChanged();
        };

        window.addEventListener(CALENDAR_ALERTS_CHANGED_EVENT, onAlertsChanged);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisible);
        const intervalId = window.setInterval(() => {
            void fireDue();
        }, REARM_INTERVAL_MS);
        void fireDue();

        return () => {
            clearArmedTimeout();
            window.clearInterval(intervalId);
            window.removeEventListener(CALENDAR_ALERTS_CHANGED_EVENT, onAlertsChanged);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    return null;
}
