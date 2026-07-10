import type {
    RealtimeChannel,
    SupabaseClient,
} from '@supabase/supabase-js';

import type { Attachment, DailyNote, MonthlyNote, WeeklyNote, YearlyNote, Tag, Task, Project } from '@/types';
import type { Database } from '@/types/supabase';
import {
    mapAttachment,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID 列（section_id/project_id 等）向け: 空文字・センチネル('goal')・非UUIDは null に正規化。
// アプリは日付なしタスク(ゴール)を sectionId:'goal'、プロジェクト未指定を projectId:'' で扱うが、
// Postgres の uuid 列は空文字/非UUIDを受け付けず INSERT/UPDATE が失敗するため。
function toUuidOrNull(value: string | undefined | null): string | null {
    if (!value) return null;
    return UUID_RE.test(value) ? value : null;
}

// DATE 列（date/assigned_date）向け: 空文字は null に正規化（アプリの date:'' = 日付なし）。
function toDateOrNull(value: string | undefined | null): string | null {
    if (!value) return null;
    return value;
}

// UPDATE 経路用: undefined は「更新しない（省略）」を維持しつつ、値がある場合のみ正規化する。
function uuidUpdate(value: string | undefined | null): string | null | undefined {
    return value === undefined ? undefined : toUuidOrNull(value);
}
function dateUpdate(value: string | undefined | null): string | null | undefined {
    return value === undefined ? undefined : toDateOrNull(value);
}

function buildTaskInsertPayload(task: Task, userId: string): Tables['tasks']['Insert'] {
    return {
        id: task.id,
        user_id: userId,
        title: task.title,
        assignee_id: toUuidOrNull(task.assigneeId),
        reporter_id: toUuidOrNull(task.reporterId),
        section_id: toUuidOrNull(task.sectionId),
        date: toDateOrNull(task.date),
        status: task.status,
        estimated_minutes: task.estimatedMinutes,
        actual_minutes: task.actualMinutes,
        started_at: millisToIso(task.startedAt),
        completed_at: millisToIso(task.completedAt),
        scheduled_start: task.scheduledStart ?? null,
        external_link: task.externalLink ?? null,
        parent_goal_id: toUuidOrNull(task.parentGoalId),
        project_id: toUuidOrNull(task.projectId),
        milestone_id: task.milestoneId ?? null,
        routine_id: toUuidOrNull(task.routineId),
        assigned_week: task.assignedWeek ?? null,
        assigned_month: task.assignedMonth ?? null,
        assigned_year: task.assignedYear ?? null,
        assigned_date: toDateOrNull(task.assignedDate),
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
    allTags: Tag[],
    attachmentRows: Tables['attachments']['Row'][] = []
) {
    const tagById = new Map(allTags.map((tag) => [tag.id, tag]));

    return tasks.map((task) => {
        const tags = taskTagRows
            .filter((taskTag) => taskTag.task_id === task.id)
            .map((taskTag) => tagById.get(taskTag.tag_id))
            .filter((tag): tag is Tag => Boolean(tag));

        const attachments = attachmentRows
            .filter((row) => row.task_id === task.id)
            .map(mapAttachment);

        return mapTask(task, tags, attachments);
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
    let attachmentRows: Tables['attachments']['Row'][] = [];
    if (taskIds.length > 0) {
        const { data, error } = await client
            .from('task_tags')
            .select('*')
            .in('task_id', taskIds);

        taskTagRows = requireData(data, error);

        const { data: attachments, error: attachmentsError } = await client
            .from('attachments')
            .select('*')
            .in('task_id', taskIds);

        attachmentRows = requireData(attachments, attachmentsError);
    }

    return buildTaskTags(taskRows, taskTagRows, tags, attachmentRows);
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

    const { data: attachments, error: attachmentsError } = await client
        .from('attachments')
        .select('*')
        .eq('task_id', taskId);

    const attachmentRows = requireData(attachments, attachmentsError);

    return mapTask(task, tags.map(mapTag), attachmentRows.map(mapAttachment));
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

    // attachments が渡された場合のみ同期（undefined=未指定は既存を温存）
    if (task.attachments !== undefined) {
        await syncTaskAttachments(client, task.id, task.attachments);
    }
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
        section_id: uuidUpdate(updates.sectionId),
        date: dateUpdate(updates.date),
        status: updates.status,
        estimated_minutes: updates.estimatedMinutes,
        actual_minutes: updates.actualMinutes,
        started_at: updates.startedAt === undefined ? undefined : millisToIso(updates.startedAt),
        completed_at: updates.completedAt === undefined ? undefined : millisToIso(updates.completedAt),
        scheduled_start: toNullable(updates.scheduledStart),
        external_link: toNullable(updates.externalLink),
        parent_goal_id: uuidUpdate(updates.parentGoalId),
        project_id: uuidUpdate(updates.projectId),
        milestone_id: toNullable(updates.milestoneId),
        routine_id: uuidUpdate(updates.routineId),
        assigned_week: toNullable(updates.assignedWeek),
        assigned_month: toNullable(updates.assignedMonth),
        assigned_year: toNullable(updates.assignedYear),
        assigned_date: dateUpdate(updates.assignedDate),
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

    // attachments が更新に含まれる場合のみ同期（編集で添付を追加/削除したケース）
    if (updates.attachments !== undefined) {
        await syncTaskAttachments(client, taskId, updates.attachments);
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
        section_id: uuidUpdate(updates.sectionId),
        date: dateUpdate(updates.date),
        status: updates.status,
        estimated_minutes: updates.estimatedMinutes,
        actual_minutes: updates.actualMinutes,
        started_at: updates.startedAt === undefined ? undefined : millisToIso(updates.startedAt),
        completed_at: updates.completedAt === undefined ? undefined : millisToIso(updates.completedAt),
        scheduled_start: toNullable(updates.scheduledStart),
        external_link: toNullable(updates.externalLink),
        parent_goal_id: uuidUpdate(updates.parentGoalId),
        project_id: uuidUpdate(updates.projectId),
        milestone_id: toNullable(updates.milestoneId),
        routine_id: uuidUpdate(updates.routineId),
        assigned_week: toNullable(updates.assignedWeek),
        assigned_month: toNullable(updates.assignedMonth),
        assigned_year: toNullable(updates.assignedYear),
        assigned_date: dateUpdate(updates.assignedDate),
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

// タスクの添付メタを attachments テーブルへ同期する（現状全削除→再挿入の単純差分）。
// アプリは添付を Task.attachments 配列で保持するが、従来は DB へ一切書かれず、
// Storage へ上げてもリロードで消えていた。ここで tasks 保存時に結線する。
export async function syncTaskAttachments(client: Client, taskId: string, attachments: Attachment[]) {
    const { error: deleteError } = await client.from('attachments').delete().eq('task_id', taskId);
    if (deleteError) {
        throw new Error(deleteError.message);
    }

    if (attachments.length === 0) {
        return;
    }

    const rows = attachments.map((attachment) => ({
        id: attachment.id,
        task_id: taskId,
        url: attachment.url,
        storage_path: attachment.path,
        name: attachment.name,
        file_type: attachment.type,
        size: attachment.size ?? null,
    }));

    const { error: insertError } = await client.from('attachments').insert(rows);
    if (insertError) {
        throw new Error(insertError.message);
    }
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

export async function unsubscribeChannels(client: Client, channels: RealtimeChannel[]) {
    // client.removeChannel は内部で `await channel.unsubscribe()` → teardown を行う非同期処理。
    // fire-and-forget にすると teardown 完了前に呼び出し側が次の購読を張ってしまい、
    // 「同名トピックの解放待ちと再取得が競合する」「購読解除漏れ（リーク）」の温床になる。
    // そのため各チャンネルの破棄完了を必ず待つ。呼び出し側が待たない場合も、
    // 破棄処理自体は Promise として確実に開始・完走する。
    await Promise.all(channels.map((channel) => client.removeChannel(channel)));
}
