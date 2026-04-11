import type {
    RealtimeChannel,
    SupabaseClient,
} from '@supabase/supabase-js';

import type { DailyNote, MonthlyNote, WeeklyNote, YearlyNote, Tag, Task, Project } from '@/types';
import type { Database } from '@/types/supabase';
import {
    mapGoal,
    mapProject,
    mapRoutine,
    mapSection,
    mapTag,
    mapTask,
    millisToIso,
} from '@/lib/supabase/mappers';

type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];

function toNullable<T>(value: T | undefined) {
    return value === undefined ? undefined : value ?? null;
}

function buildTaskInsertPayload(task: Task, userId: string): Tables['tasks']['Insert'] {
    return {
        id: task.id,
        user_id: userId,
        title: task.title,
        assignee_id: task.assigneeId ?? null,
        reporter_id: task.reporterId ?? null,
        section_id: task.sectionId,
        date: task.date,
        status: task.status,
        estimated_minutes: task.estimatedMinutes,
        actual_minutes: task.actualMinutes,
        started_at: millisToIso(task.startedAt),
        completed_at: millisToIso(task.completedAt),
        scheduled_start: task.scheduledStart ?? null,
        external_link: task.externalLink ?? null,
        parent_goal_id: task.parentGoalId ?? null,
        project_id: task.projectId ?? null,
        milestone_id: task.milestoneId ?? null,
        routine_id: task.routineId ?? null,
        assigned_week: task.assignedWeek ?? null,
        assigned_month: task.assignedMonth ?? null,
        assigned_year: task.assignedYear ?? null,
        assigned_date: task.assignedDate ?? null,
        score: task.score ?? null,
        order: task.order,
        memo: task.memo ?? null,
        ai_tags: task.aiTags ?? [],
        ai_status: task.aiStatus ?? null,
        ai_error: task.aiError ?? null,
        ai_completed_at: millisToIso(task.aiCompletedAt),
        created_at: millisToIso(task.createdAt) ?? undefined,
    };
}

function requireData<T>(data: T | null, error: { message: string } | null): T {
    if (error) {
        throw new Error(error.message);
    }

    if (data === null) {
        throw new Error('Unexpected null response');
    }

    return data;
}

export async function ensureProfile(client: Client, user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
}) {
    const displayName =
        typeof user.user_metadata?.display_name === 'string'
            ? user.user_metadata.display_name
            : typeof user.user_metadata?.full_name === 'string'
                ? user.user_metadata.full_name
                : typeof user.user_metadata?.name === 'string'
                    ? user.user_metadata.name
                    : null;
    const avatarUrl =
        typeof user.user_metadata?.avatar_url === 'string'
            ? user.user_metadata.avatar_url
            : typeof user.user_metadata?.picture === 'string'
                ? user.user_metadata.picture
                : null;

    const { error } = await client.from('profiles').upsert({
        id: user.id,
        email: user.email ?? '',
        display_name: displayName,
        avatar_url: avatarUrl,
    });

    if (error) {
        throw new Error(error.message);
    }
}

export async function createDefaultWorkspace(client: Client, userId: string) {
    const { data: existingSections, error: sectionError } = await client
        .from('sections')
        .select('id')
        .eq('user_id', userId)
        .limit(1);

    if (sectionError) {
        throw new Error(sectionError.message);
    }

    if (existingSections && existingSections.length > 0) {
        return;
    }

    const defaultSections: Tables['sections']['Insert'][] = [
        { user_id: userId, name: 'Morning', start_time: '06:00', order: 0 },
        { user_id: userId, name: 'Lunch', start_time: '12:00', order: 1 },
        { user_id: userId, name: 'Afternoon', start_time: '13:00', order: 2 },
        { user_id: userId, name: 'Evening', start_time: '18:00', order: 3 },
        { user_id: userId, name: 'Night', start_time: '21:00', order: 4 },
    ];

    const { data: insertedSections, error: insertSectionError } = await client
        .from('sections')
        .insert(defaultSections)
        .select();

    if (insertSectionError) {
        throw new Error(insertSectionError.message);
    }

    const firstSectionId = insertedSections?.[0]?.id;
    if (!firstSectionId) {
        return;
    }

    const today = new Date().toISOString().split('T')[0];

    const { error: taskError } = await client.from('tasks').insert([
        {
            user_id: userId,
            title: '【チュートリアル】このタスクの再生ボタンを押してみよう（1分）',
            estimated_minutes: 1,
            actual_minutes: 0,
            section_id: firstSectionId,
            status: 'open',
            order: 0,
            date: today,
            assigned_date: today,
        },
        {
            user_id: userId,
            title: '【チュートリアル】完了したらチェックボタンを押す',
            estimated_minutes: 5,
            actual_minutes: 0,
            section_id: firstSectionId,
            status: 'open',
            order: 1,
            date: today,
            assigned_date: today,
        },
    ]);

    if (taskError) {
        throw new Error(taskError.message);
    }
}

export async function fetchTags(client: Client) {
    const { data, error } = await client.from('tags').select('*').order('created_at', { ascending: true });
    return requireData(data, error).map(mapTag);
}

export async function fetchSections(client: Client) {
    const { data, error } = await client.from('sections').select('*').order('order', { ascending: true });
    return requireData(data, error).map(mapSection);
}

export async function fetchRoutines(client: Client) {
    const { data, error } = await client.from('routines').select('*').order('created_at', { ascending: true });
    return requireData(data, error).map(mapRoutine);
}

export async function fetchGoals(client: Client) {
    const { data, error } = await client.from('goals').select('*').order('created_at', { ascending: true });
    return requireData(data, error).map(mapGoal);
}

export async function fetchProjects(client: Client) {
    const { data: projects, error: projectError } = await (client
        .from('projects') as any)
        .select('*, project_members(user_id, role)')
        .order('created_at', { ascending: true });

    const projectRows = requireData(projects, projectError) as Array<
        Tables['projects']['Row'] & {
            project_members: Array<Pick<Tables['project_members']['Row'], 'user_id' | 'role'>> | null;
        }
    >;

    return projectRows.map((project) =>
        mapProject(
            project,
            (project.project_members ?? []).map((member) => ({
                project_id: project.id,
                user_id: member.user_id,
                role: member.role,
                created_at: project.created_at,
            }))
        )
    );
}

export async function fetchProjectById(client: Client, projectId: string) {
    const { data: project, error: projectError } = await (client
        .from('projects') as any)
        .select('*, project_members(user_id, role)')
        .eq('id', projectId)
        .maybeSingle();

    if (projectError) {
        throw new Error(projectError.message);
    }

    if (!project) {
        return null;
    }

    const projectWithMembers = project as Tables['projects']['Row'] & {
        project_members: Array<Pick<Tables['project_members']['Row'], 'user_id' | 'role'>> | null;
    };

    return mapProject(
        projectWithMembers,
        (projectWithMembers.project_members ?? []).map((member) => ({
            project_id: projectId,
            user_id: member.user_id,
            role: member.role,
            created_at: projectWithMembers.created_at,
        }))
    );
}

function buildTaskTags(
    tasks: Tables['tasks']['Row'][],
    taskTagRows: Tables['task_tags']['Row'][],
    allTags: Tag[]
) {
    const tagById = new Map(allTags.map((tag) => [tag.id, tag]));

    return tasks.map((task) => {
        const tags = taskTagRows
            .filter((taskTag) => taskTag.task_id === task.id)
            .map((taskTag) => tagById.get(taskTag.tag_id))
            .filter((tag): tag is Tag => Boolean(tag));

        return mapTask(task, tags);
    });
}

export async function fetchTasks(client: Client, tags: Tag[]) {
    const { data: tasks, error: taskError } = await client
        .from('tasks')
        .select('*')
        .order('date', { ascending: true })
        .order('order', { ascending: true });

    const taskRows = requireData(tasks, taskError);
    const taskIds = taskRows.map((task) => task.id);

    let taskTagRows: Tables['task_tags']['Row'][] = [];
    if (taskIds.length > 0) {
        const { data, error } = await client
            .from('task_tags')
            .select('*')
            .in('task_id', taskIds);

        taskTagRows = requireData(data, error);
    }

    return buildTaskTags(taskRows, taskTagRows, tags);
}

export async function fetchTaskById(client: Client, taskId: string) {
    const { data: task, error: taskError } = await client
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .maybeSingle();

    if (taskError) {
        throw new Error(taskError.message);
    }

    if (!task) {
        return null;
    }

    const { data: taskTags, error: taskTagsError } = await client
        .from('task_tags')
        .select('*')
        .eq('task_id', taskId);

    const taskTagRows = requireData(taskTags, taskTagsError);
    const tagIds = taskTagRows.map((row) => row.tag_id);

    let tags: Tables['tags']['Row'][] = [];
    if (tagIds.length > 0) {
        const { data: selectedTags, error: tagsError } = await client
            .from('tags')
            .select('*')
            .in('id', tagIds);

        tags = requireData(selectedTags, tagsError);
    }

    return mapTask(task, tags.map(mapTag));
}

export async function fetchNotes(client: Client) {
    const { data, error } = await client.from('notes').select('*');
    const rows = requireData(data, error);

    const dailyNotes: DailyNote[] = [];
    const weeklyNotes: WeeklyNote[] = [];
    const monthlyNotes: MonthlyNote[] = [];
    const yearlyNotes: YearlyNote[] = [];

    rows.forEach((row) => {
        const mapped = {
            id: row.period_key,
            userId: row.user_id,
            content: row.content,
            updatedAt: new Date(row.updated_at).getTime(),
        };

        if (row.type === 'daily') dailyNotes.push(mapped);
        if (row.type === 'weekly') weeklyNotes.push(mapped);
        if (row.type === 'monthly') monthlyNotes.push(mapped);
        if (row.type === 'yearly') yearlyNotes.push(mapped);
    });

    return { dailyNotes, weeklyNotes, monthlyNotes, yearlyNotes };
}

export async function upsertTask(client: Client, task: Task, userId: string) {
    const { error } = await client.from('tasks').upsert(buildTaskInsertPayload(task, userId));
    if (error) {
        throw new Error(error.message);
    }

    await syncTaskTags(client, task.id, userId, task.tags ?? []);
}

export async function bulkUpsertTasks(client: Client, tasks: Task[], userId: string, syncTags = false) {
    if (tasks.length === 0) {
        return;
    }

    const { error } = await client
        .from('tasks')
        .upsert(tasks.map((task) => buildTaskInsertPayload(task, userId)));

    if (error) {
        throw new Error(error.message);
    }

    if (!syncTags) {
        return;
    }

    await Promise.all(tasks.map((task) => syncTaskTags(client, task.id, userId, task.tags ?? [])));
}

export async function updateTaskRow(client: Client, taskId: string, updates: Partial<Task>, userId: string) {
    const payload: Tables['tasks']['Update'] = {
        title: updates.title,
        assignee_id: toNullable(updates.assigneeId),
        reporter_id: toNullable(updates.reporterId),
        section_id: updates.sectionId,
        date: updates.date,
        status: updates.status,
        estimated_minutes: updates.estimatedMinutes,
        actual_minutes: updates.actualMinutes,
        started_at: updates.startedAt === undefined ? undefined : millisToIso(updates.startedAt),
        completed_at: updates.completedAt === undefined ? undefined : millisToIso(updates.completedAt),
        scheduled_start: toNullable(updates.scheduledStart),
        external_link: toNullable(updates.externalLink),
        parent_goal_id: toNullable(updates.parentGoalId),
        project_id: toNullable(updates.projectId),
        milestone_id: toNullable(updates.milestoneId),
        routine_id: toNullable(updates.routineId),
        assigned_week: toNullable(updates.assignedWeek),
        assigned_month: toNullable(updates.assignedMonth),
        assigned_year: toNullable(updates.assignedYear),
        assigned_date: toNullable(updates.assignedDate),
        score: toNullable(updates.score),
        order: updates.order,
        memo: toNullable(updates.memo),
        ai_tags: updates.aiTags,
        ai_status: toNullable(updates.aiStatus),
        ai_error: toNullable(updates.aiError),
        ai_completed_at: updates.aiCompletedAt === undefined ? undefined : millisToIso(updates.aiCompletedAt),
    };

    const { error } = await client.from('tasks').update(payload).eq('id', taskId);
    if (error) {
        throw new Error(error.message);
    }

    if (updates.tags) {
        await syncTaskTags(client, taskId, userId, updates.tags);
    }
}

export async function bulkUpdateTaskRows(client: Client, taskIds: string[], updates: Partial<Task>, userId: string) {
    if (taskIds.length === 0) {
        return;
    }

    const payload: Tables['tasks']['Update'] = {
        title: updates.title,
        assignee_id: toNullable(updates.assigneeId),
        reporter_id: toNullable(updates.reporterId),
        section_id: updates.sectionId,
        date: updates.date,
        status: updates.status,
        estimated_minutes: updates.estimatedMinutes,
        actual_minutes: updates.actualMinutes,
        started_at: updates.startedAt === undefined ? undefined : millisToIso(updates.startedAt),
        completed_at: updates.completedAt === undefined ? undefined : millisToIso(updates.completedAt),
        scheduled_start: toNullable(updates.scheduledStart),
        external_link: toNullable(updates.externalLink),
        parent_goal_id: toNullable(updates.parentGoalId),
        project_id: toNullable(updates.projectId),
        milestone_id: toNullable(updates.milestoneId),
        routine_id: toNullable(updates.routineId),
        assigned_week: toNullable(updates.assignedWeek),
        assigned_month: toNullable(updates.assignedMonth),
        assigned_year: toNullable(updates.assignedYear),
        assigned_date: toNullable(updates.assignedDate),
        score: toNullable(updates.score),
        order: updates.order,
        memo: toNullable(updates.memo),
        ai_tags: updates.aiTags,
        ai_status: toNullable(updates.aiStatus),
        ai_error: toNullable(updates.aiError),
        ai_completed_at: updates.aiCompletedAt === undefined ? undefined : millisToIso(updates.aiCompletedAt),
    };

    const { error } = await client
        .from('tasks')
        .update(payload)
        .in('id', taskIds)
        .eq('user_id', userId);

    if (error) {
        throw new Error(error.message);
    }

    if (!updates.tags) {
        return;
    }

    await Promise.all(taskIds.map((taskId) => syncTaskTags(client, taskId, userId, updates.tags ?? [])));
}

export async function syncTaskTags(client: Client, taskId: string, userId: string, tagNames: string[]) {
    const normalizedNames = Array.from(
        new Set(tagNames.map((tag) => tag.trim()).filter(Boolean))
    );

    const { error: deleteError } = await client.from('task_tags').delete().eq('task_id', taskId);
    if (deleteError) {
        throw new Error(deleteError.message);
    }

    if (normalizedNames.length === 0) {
        return;
    }

    const { data: existingTags, error: existingError } = await client
        .from('tags')
        .select('*')
        .in('name', normalizedNames);

    const currentTags = requireData(existingTags, existingError);
    const tagByName = new Map(currentTags.map((tag) => [tag.name, tag]));
    const missingNames = normalizedNames.filter((name) => !tagByName.has(name));

    if (missingNames.length > 0) {
        const { data: insertedTags, error: insertTagError } = await client
            .from('tags')
            .insert(
                missingNames.map((name) => ({
                    user_id: userId,
                    name,
                }))
            )
            .select('*');

        insertedTags?.forEach((tag) => tagByName.set(tag.name, tag));

        if (insertTagError) {
            throw new Error(insertTagError.message);
        }
    }

    const links = normalizedNames
        .map((name) => tagByName.get(name))
        .filter((tag): tag is Tables['tags']['Row'] => Boolean(tag))
        .map((tag) => ({ task_id: taskId, tag_id: tag.id }));

    if (links.length === 0) {
        return;
    }

    const { error: insertTaskTagError } = await client.from('task_tags').insert(links);
    if (insertTaskTagError) {
        throw new Error(insertTaskTagError.message);
    }
}

export function subscribeTable(
    client: Client,
    channelName: string,
    table: keyof Tables,
    onChange: (payload: {
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        new: Record<string, unknown>;
        old: Record<string, unknown>;
    }) => void,
    filter?: string
) {
    const channel = client.channel(channelName);
    channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        onChange
    );

    channel.subscribe();
    return channel;
}

export function unsubscribeChannels(client: Client, channels: RealtimeChannel[]) {
    channels.forEach((channel) => {
        client.removeChannel(channel);
    });
}
