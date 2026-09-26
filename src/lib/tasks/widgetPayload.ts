/**
 * Payload the web app pushes to the Android home-screen widget (TaskelWidget plugin).
 *
 * The native side has no access to Supabase, so the WebView is its only data source.
 * To keep the widget meaningful after the app is closed, the payload carries more
 * than the current answer: the running task with its planned end, and *all* of
 * today's remaining fixed-time tasks. The widget then advances "next", flips to
 * "due now" and "overrun", and counts down with a Chronometer entirely on-device,
 * until the app is opened again and sends a fresh payload.
 *
 * All timestamps are epoch milliseconds; the device renders clock times in its own
 * locale and time zone.
 */

// Relative runtime imports: the vitest "unit" project does not resolve the `@/` alias.
import {
    computeNowNext,
    listScheduleForWidget,
    listUpcomingFixed,
    pickQueued,
    type NowNextInput,
    type ScheduleStatus,
} from './nowNext';

/** Enough to cover a busy day without shipping the whole task list every time. */
export const WIDGET_UPCOMING_LIMIT = 10;
/** Rows the schedule widget can list; keeps the Binder payload small on a packed day. */
export const WIDGET_SCHEDULE_LIMIT = 30;

export interface WidgetCurrent {
    title: string;
    startAt: number;
    /** Planned end, or null when the task has no estimate (widget shows elapsed time). */
    endAt: number | null;
    concurrentCount: number;
}

export interface WidgetUpcoming {
    title: string;
    startAt: number;
    /** End of the task's window; the widget drops the entry once this has passed. */
    endAt: number;
}

export interface WidgetScheduleItem {
    /** Task id, so a row tap can open that task's edit modal. */
    id: string;
    title: string;
    startAt: number;
    endAt: number;
    status: ScheduleStatus;
}

export interface WidgetPayload {
    /** When this payload was computed; the widget shows it as "updated HH:mm". */
    generatedAt: number;
    /** Local calendar date the upcoming list was computed for (yyyy-MM-dd). */
    today: string;
    current: WidgetCurrent | null;
    upcoming: WidgetUpcoming[];
    /** First open unscheduled task, shown once no fixed-time task is left. */
    queued: { title: string } | null;
    /**
     * Today's remaining fixed-time tasks for the schedule widget (running ones
     * included), earliest first. The widget drops rows itself as their windows end.
     */
    schedule: WidgetScheduleItem[];
}

export function buildWidgetPayload({ tasks, sections, now, today }: NowNextInput): WidgetPayload {
    const { current } = computeNowNext({ tasks, sections, now, today });
    const queued = pickQueued(tasks, sections, today);

    return {
        generatedAt: now,
        today,
        current: current
            ? {
                  title: current.task.title,
                  startAt: current.startAt,
                  endAt: current.endAt,
                  concurrentCount: current.concurrentCount,
              }
            : null,
        upcoming: listUpcomingFixed(tasks, now, today)
            .slice(0, WIDGET_UPCOMING_LIMIT)
            .map(({ task, startAt, endAt }) => ({ title: task.title, startAt, endAt })),
        queued: queued ? { title: queued.title } : null,
        schedule: listScheduleForWidget(tasks, now, today)
            .slice(0, WIDGET_SCHEDULE_LIMIT)
            .map(({ task, startAt, endAt, status }) => ({ id: task.id, title: task.title, startAt, endAt, status })),
    };
}

/**
 * Identity of a payload for change detection. generatedAt is excluded on purpose:
 * the bridge recomputes often, and only real changes should reach the device.
 */
export function widgetPayloadKey(payload: WidgetPayload): string {
    return JSON.stringify({
        today: payload.today,
        current: payload.current,
        upcoming: payload.upcoming,
        queued: payload.queued,
        schedule: payload.schedule,
    });
}
