import type { Goal, Project, Routine, Section, Tag, Task, TaskComment } from '@/types';
import type { Database } from '@/types/supabase';

type Tables = Database['public']['Tables'];

export function isoToMillis(value?: string | null) {
    return value ? new Date(value).getTime() : undefined;
}

export function millisToIso(value?: number | null) {
    return typeof value === 'number' ? new Date(value).toISOString() : null;
}

export function mapSection(row: Tables['sections']['Row']): Section {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
        order: row.order,
    };
}

export function mapRoutine(row: Tables['routines']['Row']): Routine {
    return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        frequency: row.frequency,
        daysOfWeek: row.days_of_week ?? undefined,
        interval: row.interval ?? undefined,
        startDate: row.start_date,
        nextRun: row.next_run,
        startTime: row.start_time ?? undefined,
        sectionId: row.section_id,
        estimatedMinutes: row.estimated_minutes,
        active: row.active,
        projectId: row.project_id ?? undefined,
        tags: row.tags,
        memo: row.memo ?? undefined,
    };
}

export function mapTag(row: Tables['tags']['Row']): Tag {
    return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        memo: row.memo ?? undefined,
        color: row.color ?? undefined,
    };
}

export function mapGoal(row: Tables['goals']['Row']): Goal {
    return {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        description: row.description ?? undefined,
        assignedYear: row.assigned_year,
        assignedMonth: row.assigned_month ?? undefined,
        assignedWeek: row.assigned_week ?? undefined,
        status: row.status,
        progress: row.progress,
        parentGoalId: row.parent_goal_id ?? undefined,
        projectId: row.project_id ?? undefined,
        priority: row.priority as Goal['priority'],
        tags: row.tags,
        reflection: row.reflection ?? undefined,
        aiAnalysis: (row.ai_analysis as Goal['aiAnalysis'] | null) ?? undefined,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    };
}

export function mapProject(
    row: Tables['projects']['Row'],
    memberRows: Tables['project_members']['Row'][] = []
): Project {
    const roles = Object.fromEntries(memberRows.map((member) => [member.user_id, member.role]));
    const memberIds = Array.from(new Set([row.owner_id, ...memberRows.map((member) => member.user_id)]));

    return {
        id: row.id,
        userId: row.owner_id,
        title: row.title,
        description: row.description,
        ownerId: row.owner_id,
        memberIds,
        roles,
        status: row.status,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    };
}

export function mapTask(
    row: Tables['tasks']['Row'],
    tags: Tag[] = []
): Task {
    return {
        id: row.id,
        userId: row.user_id,
        title: row.title,
        assigneeId: row.assignee_id ?? undefined,
        reporterId: row.reporter_id ?? undefined,
        sectionId: row.section_id,
        date: row.date,
        status: row.status,
        estimatedMinutes: row.estimated_minutes,
        actualMinutes: row.actual_minutes,
        startedAt: isoToMillis(row.started_at),
        completedAt: isoToMillis(row.completed_at),
        scheduledStart: row.scheduled_start ?? undefined,
        externalLink: row.external_link ?? undefined,
        parentGoalId: row.parent_goal_id ?? undefined,
        aiTags: row.ai_tags,
        projectId: row.project_id ?? undefined,
        milestoneId: row.milestone_id ?? undefined,
        routineId: row.routine_id ?? undefined,
        assignedWeek: row.assigned_week ?? undefined,
        assignedMonth: row.assigned_month ?? undefined,
        assignedYear: row.assigned_year ?? undefined,
        assignedDate: row.assigned_date ?? undefined,
        score: row.score ?? undefined,
        order: row.order,
        tags: tags.map((tag) => tag.name),
        memo: row.memo ?? undefined,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
        aiStatus: row.ai_status ?? undefined,
        aiError: row.ai_error ?? undefined,
        aiCompletedAt: isoToMillis(row.ai_completed_at),
        commentCount: row.comment_count,
    };
}

export function mapTaskComment(row: Tables['task_comments']['Row']): TaskComment {
    return {
        id: row.id,
        taskId: row.task_id,
        userId: row.user_id ?? '',
        authorType: row.author_type,
        authorName: row.author_name ?? undefined,
        content: row.content,
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    };
}
