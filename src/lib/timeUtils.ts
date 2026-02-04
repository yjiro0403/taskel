import { Task } from '@/types';
import { addMinutes, format } from 'date-fns';

export interface TimeSlot {
    start: Date;
    end: Date;
}

export function calculateTaskSchedule(
    tasks: Task[],
    startTime: Date = new Date()
): Map<string, TimeSlot> {
    const schedule = new Map<string, TimeSlot>();
    let currentTime = startTime;

    // Use input order directly (caller is responsible for sorting)
    const sortedTasks = tasks;

    sortedTasks.forEach((task) => {
        // If task is done, we don't need to predict its time in the future
        // But for visualized schedule, we could use completedAt if available, 
        // or just skip it for the "Queue" calculation.
        // For MVP: We only calculate schedule for OPEN or IN_PROGRESS tasks.

        if (task.status === 'done') {
            return;
        }

        let start = currentTime;

        // If task is in_progress and has a startedAt, it uses that.
        if (task.status === 'in_progress' && task.startedAt) {
            start = new Date(task.startedAt);
        } else if (task.scheduledStart) {
            // Parse scheduled start time (HH:mm)
            const [hours, minutes] = task.scheduledStart.split(':').map(Number);
            const scheduledDate = new Date(currentTime);
            scheduledDate.setHours(hours, minutes, 0, 0);

            // Respect user's scheduled start even if it overlaps with previous task (is before currentTime).
            // We NO LONGER clamp it to "Now" if it's in the past, per user request.
            start = scheduledDate;
        }

        // Use estimatedMinutes - actualMinutes for remaining time?
        const remainingMinutes = Math.max(0, task.estimatedMinutes - task.actualMinutes);
        const duration = remainingMinutes > 0 ? remainingMinutes : task.estimatedMinutes;

        const end = addMinutes(start, duration);
        schedule.set(task.id, { start, end });

        // Update currentTime for the NEXT task. 
        // If we have overlapping tasks, the "Resource" is effectively the user. 
        // If user multitasks A and B, when does C start?
        // Usually C starts when BOTH are done, or when the user becomes free.
        // We take the max of current pointer and this task's end.
        // If Task A ends 11:00, Task B (parallel) ends 10:45. Task C starts 11:00.
        // If Task B ends 11:30. Task C starts 11:30.
        if (end > currentTime) {
            currentTime = end;
        }
    });

    return schedule;
}

export function formatTime(date: Date): string {
    return format(date, 'HH:mm');
}
