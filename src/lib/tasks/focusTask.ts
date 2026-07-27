/**
 * Shared focus / navigation intent for search jumps and permanent task links.
 * Mirrors the existing TaskSearchModal behaviour: dated tasks switch the day list;
 * undated tasks open the unscheduled (right) sidebar.
 */

export const TASK_HIGHLIGHT_MS = 3500;

export type TaskFocusLocation = {
    taskId: string;
    /** When set, the tasks page should switch to this date (YYYY-MM-DD). */
    date: string | null;
    /** When true, open the unscheduled backlog sidebar instead of the day list. */
    openRightSidebar: boolean;
};

export type TaskLikeForFocus = {
    id: string;
    date?: string | null;
};

export function isUndatedTask(task: TaskLikeForFocus): boolean {
    return !task.date || task.date.trim() === '';
}

/**
 * Resolve where a task should be focused in the main tasks UI.
 */
export function resolveTaskFocusLocation(task: TaskLikeForFocus): TaskFocusLocation {
    if (isUndatedTask(task)) {
        return {
            taskId: task.id,
            date: null,
            openRightSidebar: true,
        };
    }

    return {
        taskId: task.id,
        date: task.date!.trim(),
        openRightSidebar: false,
    };
}
