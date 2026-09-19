/**
 * Display ordering shared by the daily task list and the Now / Next widget.
 *
 * TaskList used to keep this comparator inline. The widget must predict the
 * "next" unscheduled task with exactly the order (and therefore the same
 * predicted start time) the list shows, so the logic lives here once.
 */

import type { Section, Task } from '@/types';
// Relative runtime import: the vitest "unit" project does not resolve the `@/` alias.
import { generateDisplaySections } from '../sectionUtils';

export function hasScheduledStart(task: Pick<Task, 'scheduledStart'>): boolean {
    return !!task.scheduledStart && task.scheduledStart.trim() !== '';
}

/**
 * Order inside a section:
 * 0. done → in_progress → open
 * 1. scheduled tasks by time
 * 2. scheduled before unscheduled
 * 3. manual `order`
 */
export function compareTasksForDisplay(a: Task, b: Task): number {
    const statusRank = (task: Task) => {
        if (task.status === 'done') return 0;
        if (task.status === 'in_progress') return 1;
        return 2;
    };
    const rankDiff = statusRank(a) - statusRank(b);
    if (rankDiff !== 0) return rankDiff;

    const hasScheduleA = hasScheduledStart(a);
    const hasScheduleB = hasScheduledStart(b);

    if (hasScheduleA && hasScheduleB) {
        const timeCompare = a.scheduledStart!.localeCompare(b.scheduledStart!);
        if (timeCompare !== 0) return timeCompare;
    }

    if (hasScheduleA && !hasScheduleB) return -1;
    if (!hasScheduleA && hasScheduleB) return 1;

    return (a.order ?? 0) - (b.order ?? 0);
}

/**
 * Flatten tasks in the order the daily list renders them: display sections
 * (including virtual intervals) top to bottom, each sorted by
 * compareTasksForDisplay. Tasks whose section is unknown are omitted, exactly
 * as the list omits them.
 */
export function sortTasksForDisplay(tasks: Task[], sections: Section[]): Task[] {
    const displaySections = generateDisplaySections(sections);
    const ordered: Task[] = [];
    displaySections.forEach((section) => {
        const sectionTasks = tasks
            .filter((task) => task.sectionId === section.id)
            .sort(compareTasksForDisplay);
        ordered.push(...sectionTasks);
    });
    return ordered;
}
