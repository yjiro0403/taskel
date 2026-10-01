import type { Section, Task } from '@/types';
import { calculateTaskSchedule } from '@/lib/timeUtils';

/**
 * End of the queued schedule across every section, in section order.
 * Matches the tasks-page header: tasks are grouped by section, ordered by
 * `order`, then walked with calculateTaskSchedule. Dates are not filtered.
 */
export function computeQueuedFinishTime(
    tasks: readonly Task[],
    sections: readonly Section[],
    currentTime: Date
): Date | null {
    if (tasks.length === 0 || sections.length === 0) return null;

    const sortedSections = [...sections].sort((a, b) => a.order - b.order);
    const bySection = new Map<string, Task[]>();
    for (const task of tasks) {
        const bucket = bySection.get(task.sectionId);
        if (bucket) bucket.push(task);
        else bySection.set(task.sectionId, [task]);
    }

    const ordered: Task[] = [];
    for (const section of sortedSections) {
        const bucket = bySection.get(section.id);
        if (!bucket || bucket.length === 0) continue;
        bucket.sort((a, b) => a.order - b.order);
        ordered.push(...bucket);
    }
    if (ordered.length === 0) return null;

    const schedule = calculateTaskSchedule(ordered, currentTime);
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const slot = schedule.get(ordered[index].id);
        if (slot) return slot.end;
    }
    return null;
}
