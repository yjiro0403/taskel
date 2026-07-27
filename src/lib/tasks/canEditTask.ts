/**
 * UI-level edit permission for a task, aligned with TaskList / TaskItem.
 *
 * Mirrors the previous inline `canEditTask` in TaskList:
 * - No user → cannot edit
 * - No projectId → personal task → can edit
 * - Project missing from loaded list → cannot edit
 * - Project owner → can edit
 * - Project role `viewer` → cannot edit
 * - Other roles (including default when roles map is missing) → can edit
 *
 * Note: Supabase RLS still enforces server-side writes; this gates the Edit Item modal only.
 */

export type TaskLikeForEditAuth = {
    projectId?: string | null;
};

export type ProjectLikeForEditAuth = {
    id: string;
    ownerId: string;
    roles?: { [userId: string]: string };
};

export function canEditTask(
    task: TaskLikeForEditAuth,
    userId: string | null | undefined,
    projects: readonly ProjectLikeForEditAuth[]
): boolean {
    if (!userId) return false;
    if (!task.projectId) return true;

    const project = projects.find((entry) => entry.id === task.projectId);
    if (!project) return false;

    if (project.ownerId === userId) return true;

    const role = project.roles?.[userId] || 'member';
    return role !== 'viewer';
}
