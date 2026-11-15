import type { McpDaySnapshot } from '@/lib/mcp/db';
import { routineOccursOn } from '@/lib/routineUtils';
import { createVirtualRoutineTaskId } from '@/lib/tasks/virtualTask';

/**
 * The day view of the MCP tools: stored tasks merged with the routine
 * occurrences that have not been touched yet.
 *
 * This mirrors `getMergedTasks` in src/store/slices/taskSlice.ts, the view the
 * app itself shows. The app builds it in the browser; here it is rebuilt from
 * one database snapshot. `dayView.test.ts` runs both on the same fixtures: if
 * the store logic changes, that test is what notices.
 *
 * Two deliberate differences from the app:
 *   - rows and routines of a project shared with someone else are left out and
 *     only counted (`hidden_shared_count`);
 *   - the order is fixed here (section start, start time, order, id), since
 *     the app sorts in its components.
 *
 * Nothing is written: a virtual occurrence stays virtual.
 */

export const MCP_DAY_VIEW_LIMIT = 100;
export const MCP_DAILY_GOAL_LIMIT = 50;

export type McpTaskItem = {
    id: string;
    title: string;
    status: 'open' | 'in_progress' | 'done';
    date: string | null;
    scheduled_start: string | null;
    section: string | null;
    estimated_minutes: number;
    actual_minutes: number;
    is_routine: boolean;
    is_virtual: boolean;
};

export type McpDaySummary = {
    total: number;
    open: number;
    in_progress: number;
    done: number;
    estimated_minutes_total: number;
    estimated_minutes_remaining: number;
    actual_minutes_total: number;
};

export type McpDayView = {
    summary: McpDaySummary;
    tasks: McpTaskItem[];
    daily_goals: { id: string; title: string; status: 'open' | 'in_progress' | 'done' }[];
    hidden_shared_count: number;
    truncated: boolean;
};

type Candidate = {
    id: string;
    title: string | null;
    status: 'open' | 'in_progress' | 'done' | 'skipped';
    scheduledStart: string | null;
    sectionId: string | null;
    estimatedMinutes: number;
    actualMinutes: number;
    routineId: string | null;
    order: number;
    inScope: boolean;
    isVirtual: boolean;
};

function minutesOf(time: string | null): number | null {
    if (!time) {
        return null;
    }
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function compareNullsLast(a: number | null, b: number | null): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    return a - b;
}

export function buildDayView(input: { snapshot: McpDaySnapshot; date: string }): McpDayView {
    const { snapshot, date } = input;

    const stored: Candidate[] = snapshot.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scheduledStart: task.scheduled_start,
        sectionId: task.section_id,
        estimatedMinutes: task.estimated_minutes,
        actualMinutes: task.actual_minutes,
        routineId: task.routine_id,
        order: task.order,
        inScope: task.in_scope,
        isVirtual: false,
    }));

    // 1 and 2: routine occurrences of the day that no stored row stands for.
    // Every stored row counts here, whatever its status or scope: a skipped
    // row is the tombstone of a deleted occurrence.
    const virtual: Candidate[] = [];
    for (const routine of snapshot.routines) {
        const occurs = routineOccursOn(
            {
                frequency: routine.frequency,
                daysOfWeek: routine.days_of_week ?? undefined,
                interval: routine.interval ?? undefined,
                startDate: routine.start_date,
                nextRun: routine.next_run,
            },
            date
        );
        if (!occurs) {
            continue;
        }

        const virtualId = createVirtualRoutineTaskId(routine.id, date);
        if (stored.some((task) => task.id === virtualId || task.routineId === routine.id)) {
            continue;
        }

        // The app keeps a missing section as ''; both mean "no section".
        const sectionId = routine.section_id;
        const peerOrders = [...stored, ...virtual]
            .filter((task) => (task.sectionId ?? '') === (sectionId ?? ''))
            .map((task) => task.order);

        virtual.push({
            id: virtualId,
            title: routine.title,
            status: 'open',
            scheduledStart: routine.start_time,
            sectionId,
            estimatedMinutes: routine.estimated_minutes,
            actualMinutes: 0,
            routineId: routine.id,
            order: (peerOrders.length > 0 ? Math.max(...peerOrders) : 0) + 1,
            inScope: routine.in_scope,
            isVirtual: true,
        });
    }

    // 3: tombstones are never shown.
    const shown = [...stored, ...virtual].filter((task) => task.status !== 'skipped');

    // 4: shared-project items are counted, never listed.
    const visible = shown.filter((task) => task.inScope && task.title !== null);
    const hiddenSharedCount = shown.length - visible.length;

    // 5: fixed order.
    const sections = new Map(snapshot.sections.map((section) => [section.id, section]));
    const sectionStart = (task: Candidate): number | null => {
        const section = task.sectionId ? sections.get(task.sectionId) : undefined;
        // A section without a start time sorts as 00:00, like the app's own section order.
        return section ? (minutesOf(section.start_time) ?? 0) : null;
    };
    visible.sort(
        (a, b) =>
            compareNullsLast(sectionStart(a), sectionStart(b)) ||
            compareNullsLast(minutesOf(a.scheduledStart), minutesOf(b.scheduledStart)) ||
            a.order - b.order ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

    const summary: McpDaySummary = {
        total: visible.length,
        open: 0,
        in_progress: 0,
        done: 0,
        estimated_minutes_total: 0,
        estimated_minutes_remaining: 0,
        actual_minutes_total: 0,
    };
    for (const task of visible) {
        const status = task.status as McpTaskItem['status'];
        summary[status] += 1;
        summary.estimated_minutes_total += task.estimatedMinutes;
        summary.actual_minutes_total += task.actualMinutes;
        if (status !== 'done') {
            summary.estimated_minutes_remaining += task.estimatedMinutes;
        }
    }

    const tasks: McpTaskItem[] = visible.slice(0, MCP_DAY_VIEW_LIMIT).map((task) => ({
        id: task.id,
        title: task.title as string,
        status: task.status as McpTaskItem['status'],
        date,
        scheduled_start: task.scheduledStart,
        section: (task.sectionId ? sections.get(task.sectionId)?.name : undefined) ?? null,
        estimated_minutes: task.estimatedMinutes,
        actual_minutes: task.actualMinutes,
        is_routine: task.routineId !== null,
        is_virtual: task.isVirtual,
    }));

    return {
        summary,
        tasks,
        daily_goals: snapshot.goals.slice(0, MCP_DAILY_GOAL_LIMIT).map((goal) => ({
            id: goal.id,
            title: goal.title,
            status: goal.status,
        })),
        hidden_shared_count: hiddenSharedCount,
        truncated: visible.length > MCP_DAY_VIEW_LIMIT || snapshot.tasks_truncated,
    };
}
