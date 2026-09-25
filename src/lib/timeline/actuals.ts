import { format } from 'date-fns';

import type { Section, Task } from '../../types';
import { getPersistedSectionForTime } from '../sectionUtils';

/**
 * Timeline play: the block follows the real start.
 *
 * Pressing ▶ at 11:30 on a task planned for 12:00 moves it to 11:30, and a task
 * without a start time gets the current time, so what the axis shows is what
 * actually happened. The planned length (estimatedMinutes) is kept.
 */
export function buildTimelinePlayUpdate(task: Task, now: Date, sections: Section[]): Partial<Task> {
    const scheduledStart = format(now, 'HH:mm');
    const sectionId = getPersistedSectionForTime(sections, scheduledStart);
    return {
        status: 'in_progress',
        startedAt: now.getTime(),
        scheduledStart,
        ...(sectionId ? { sectionId } : {}),
    };
}

/**
 * Timeline stop: the block ends where the timer stopped.
 *
 * A done block spans its start plus actualMinutes, so recording the elapsed
 * time is what makes "stop at 11:30" end at 11:30. When this was the task's
 * only run and it started on the task's own day, the start is also aligned
 * with the real start (the task may have been started from the list view,
 * which keeps the planned time). Returns null when the task is not running.
 */
export function buildTimelineStopUpdate(task: Task, now: Date): Partial<Task> | null {
    if (task.status !== 'in_progress' || !task.startedAt) return null;

    const elapsedMinutes = Math.max(0, Math.round((now.getTime() - task.startedAt) / 60000));
    const previousActual = Number(task.actualMinutes || 0);
    const update: Partial<Task> = {
        status: 'done',
        startedAt: undefined,
        actualMinutes: previousActual + elapsedMinutes,
        completedAt: now.getTime(),
    };

    const started = new Date(task.startedAt);
    if (previousActual === 0 && format(started, 'yyyy-MM-dd') === task.date) {
        const actualStart = format(started, 'HH:mm');
        if (task.scheduledStart !== actualStart) update.scheduledStart = actualStart;
    }
    return update;
}
