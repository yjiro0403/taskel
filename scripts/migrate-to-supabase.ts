import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import nodemailer from 'nodemailer';

import type { Database, Json } from '../src/types/supabase';

type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];

type ProfileInsert = Tables['profiles']['Insert'];
type ProjectInsert = Tables['projects']['Insert'];
type ProjectMemberInsert = Tables['project_members']['Insert'];
type TagInsert = Tables['tags']['Insert'];
type GoalInsert = Tables['goals']['Insert'];
type SectionInsert = Tables['sections']['Insert'];
type RoutineInsert = Tables['routines']['Insert'];
type TaskInsert = Tables['tasks']['Insert'];
type TaskTagInsert = Tables['task_tags']['Insert'];
type TaskCommentInsert = Tables['task_comments']['Insert'];
type InvitationInsert = Tables['invitations']['Insert'];
type SubscriptionInsert = Tables['subscriptions']['Insert'];
type NoteInsert = Tables['notes']['Insert'];
type AttachmentInsert = Tables['attachments']['Insert'];

type NoteType = Database['public']['Enums']['note_type'];
type HubRole = Database['public']['Enums']['hub_role'];
type GoalType = Database['public']['Enums']['goal_type'];
type GoalStatus = Database['public']['Enums']['goal_status'];
type RoutineFrequency = Database['public']['Enums']['routine_frequency'];
type TaskStatus = Database['public']['Enums']['task_status'];
type TaskAiStatus = Database['public']['Enums']['task_ai_status'];
type TaskAuthorType = Database['public']['Enums']['task_author_type'];
type InvitationStatus = Database['public']['Enums']['invitation_status'];
type SubscriptionPlan = Database['public']['Enums']['subscription_plan'];
type SubscriptionStatus = Database['public']['Enums']['subscription_status'];
type AttachmentFileType = Database['public']['Enums']['attachment_file_type'];

type AuthUserRecord = {
    id: string;
    email?: string | null;
};

type RawDoc<T = Record<string, unknown>> = {
    id: string;
    data: T;
};

type UserScopedDoc<T = Record<string, unknown>> = RawDoc<T> & {
    userId: string;
};

type NoteDoc = UserScopedDoc<{
    content?: unknown;
    updatedAt?: unknown;
}> & {
    noteType: NoteType;
    periodKey: string;
};

type TaskCommentDoc = RawDoc<{
    taskId?: unknown;
    userId?: unknown;
    authorType?: unknown;
    authorName?: unknown;
    content?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
}> & {
    taskId: string;
};

type PendingAttachmentInsert = AttachmentInsert & {
    source_url: string | null;
    source_storage_path: string | null;
};

type MigrationDataset = {
    users: RawDoc[];
    tags: RawDoc[];
    projects: RawDoc[];
    invitations: RawDoc[];
    subscriptions: RawDoc[];
    tasks: RawDoc[];
    taskComments: TaskCommentDoc[];
    goals: UserScopedDoc[];
    sections: UserScopedDoc[];
    routines: UserScopedDoc[];
    notes: NoteDoc[];
};

type EntityCounts = {
    profiles: number;
    projects: number;
    project_members: number;
    tags: number;
    goals: number;
    sections: number;
    routines: number;
    tasks: number;
    task_tags: number;
    task_comments: number;
    invitations: number;
    subscriptions: number;
    notes: number;
    attachments: number;
    auth_users_created: number;
    auth_users_reused: number;
    reset_emails_sent: number;
    reset_emails_logged: number;
};

type BatchResult = {
    attempted: number;
    succeeded: number;
    failed: number;
    // 行単位リトライでも書き込めなかった行の識別子（onConflict 列の値を連結したもの）。
    // サマリーで「どの行が落ちたか」を可視化し、サイレントな欠損を防ぐために保持する。
    failedIds: string[];
};

const BATCH_SIZE = 100;
const dryRun = process.argv.includes('--dry-run');
const sendResetEmails = process.argv.includes('--send-reset-emails');

const counts: EntityCounts = {
    profiles: 0,
    projects: 0,
    project_members: 0,
    tags: 0,
    goals: 0,
    sections: 0,
    routines: 0,
    tasks: 0,
    task_tags: 0,
    task_comments: 0,
    invitations: 0,
    subscriptions: 0,
    notes: 0,
    attachments: 0,
    auth_users_created: 0,
    auth_users_reused: 0,
    reset_emails_sent: 0,
    reset_emails_logged: 0,
};

let errorCount = 0;
let smtpTransportPromise: Promise<nodemailer.Transporter | null> | null = null;

// テーブルごとの書き込み結果（試行/成功/失敗）。upsertTable が記録し、printSummary が
// 参照する。main() の途中で例外終了しても正しい部分サマリーを出せるようモジュール
// レベルで保持する（従来は upsertTable の戻り値を破棄し、試行件数を成功として表示していた）。
const writeOutcomes: Partial<Record<keyof EntityCounts, BatchResult>> = {};

function recordWriteOutcome(countKey: keyof EntityCounts, result: BatchResult) {
    const existing = writeOutcomes[countKey];
    if (!existing) {
        writeOutcomes[countKey] = result;
        return;
    }
    // 同一テーブルが複数回 upsert される場合に備えて集計する。
    existing.attempted += result.attempted;
    existing.succeeded += result.succeeded;
    existing.failed += result.failed;
    existing.failedIds.push(...result.failedIds);
}

function totalWriteFailures(): number {
    return Object.values(writeOutcomes).reduce((sum, outcome) => sum + (outcome?.failed ?? 0), 0);
}

function logInfo(message: string) {
    console.log(`[INFO] ${message}`);
}

function logWarn(message: string) {
    console.warn(`[WARN] ${message}`);
}

function logError(message: string, error?: unknown) {
    errorCount += 1;
    console.error(`[ERROR] ${message}`);
    if (error instanceof Error) {
        console.error(error.stack ?? error.message);
        return;
    }
    if (error !== undefined) {
        console.error(error);
    }
}

function requireEnv(name: string) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getSupabaseClient() {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url) {
        throw new Error('Missing required environment variable: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
    }
    if (!serviceRoleKey) {
        throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');
    }

    return createClient<Database>(url, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

function getAppUrl() {
    return (process.env.NEXT_PUBLIC_APP_URL || 'https://taskel.vercel.app').replace(/\/$/, '');
}

function getFirebaseStorageBucketName() {
    return process.env.FIREBASE_STORAGE_BUCKET
        ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
        ?? process.env.SUPABASE_PROJECT_ID
        ?? undefined;
}

async function getSmtpTransport() {
    if (smtpTransportPromise) {
        return smtpTransportPromise;
    }

    smtpTransportPromise = (async () => {
        const hasCredentials = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
        if (!hasCredentials) {
            logWarn('SMTP credentials not found. Password reset links will be logged instead of emailed.');
            return null;
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        await transporter.verify();
        return transporter;
    })();

    return smtpTransportPromise;
}

async function deliverPasswordResetLink(email: string, resetLink: string) {
    const transporter = await getSmtpTransport();
    if (!transporter) {
        counts.reset_emails_logged += 1;
        logInfo(`[RESET LINK] ${email}: ${resetLink}`);
        return;
    }

    await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
        to: email,
        subject: 'Reset your Taskel password',
        text: [
            'Your Taskel account was migrated to Supabase authentication.',
            'For your first login, reset your password using the link below:',
            resetLink,
            '',
            'If you usually sign in with Google or another OAuth provider, use the same email address and your account will be linked automatically.',
        ].join('\n'),
    });

    counts.reset_emails_sent += 1;
}

function initializeFirebase() {
    if (getApps().length > 0) {
        return getFirestore();
    }

    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccount) {
        initializeApp({
            credential: cert(JSON.parse(serviceAccount)),
        });
        return getFirestore();
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (projectId || clientEmail || privateKey) {
        if (!projectId || !clientEmail || !privateKey) {
            throw new Error(
                'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must all be set.'
            );
        }
        initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey: privateKey.replace(/\\n/g, '\n'),
            }),
        });
        return getFirestore();
    }

    requireEnv('GOOGLE_APPLICATION_CREDENTIALS');
    initializeApp({
        credential: applicationDefault(),
    });
    return getFirestore();
}

function chunk<T>(items: T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasToMillis(value: unknown): value is { toMillis: () => number } {
    return isObject(value) && typeof value.toMillis === 'function';
}

function normalizeTimestamp(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (hasToMillis(value)) {
        return new Date(value.toMillis()).toISOString();
    }
    return null;
}

function normalizeDate(value: unknown): string | null {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    const iso = normalizeTimestamp(value);
    return iso ? iso.slice(0, 10) : null;
}

function normalizeTime(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
        return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
    }
    return null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function asNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asJson(value: unknown): Json | null {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value as Json;
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => asJson(entry))
            .filter((entry): entry is Json => entry !== undefined) as Json;
    }
    if (hasToMillis(value)) {
        return new Date(value.toMillis()).toISOString();
    }
    if (isObject(value)) {
        // jsonb カラム（goals.ai_analysis 等）へ入れる値のキーは変換しない。
        // アプリは ai_analysis を camelCase の Goal['aiAnalysis'] としてそのまま読む
        // （src/lib/supabase/mappers.ts）ため、suggestedBreakdown / keyResults 等を
        // snake_case 化すると UI から内容が消える。原文のキーを保持する。
        const entries = Object.entries(value)
            .map(([key, entry]) => [key, asJson(entry)] as const)
            .filter(([, entry]) => entry !== undefined);
        return Object.fromEntries(entries) as Json;
    }
    return null;
}

function deterministicUuid(seed: string) {
    const hash = createHash('sha1').update(seed).digest('hex');
    const base = hash.slice(0, 32).split('');
    base[12] = '5';
    base[16] = ((Number.parseInt(base[16], 16) & 0x3) | 0x8).toString(16);
    return [
        base.slice(0, 8).join(''),
        base.slice(8, 12).join(''),
        base.slice(12, 16).join(''),
        base.slice(16, 20).join(''),
        base.slice(20, 32).join(''),
    ].join('-');
}

function maybeUuid(value: string | null | undefined) {
    if (!value) {
        return null;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
        ? value
        : null;
}

function pickEnumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

class IdRegistry {
    private readonly maps = new Map<string, Map<string, string>>();

    set(namespace: string, sourceId: string, targetId: string) {
        if (!this.maps.has(namespace)) {
            this.maps.set(namespace, new Map());
        }
        this.maps.get(namespace)!.set(sourceId, targetId);
    }

    get(namespace: string, sourceId: string | null | undefined) {
        if (!sourceId) {
            return null;
        }
        return this.maps.get(namespace)?.get(sourceId) ?? null;
    }

    ensure(namespace: string, sourceId: string) {
        const existing = this.get(namespace, sourceId);
        if (existing) {
            return existing;
        }
        const next = deterministicUuid(`${namespace}:${sourceId}`);
        this.set(namespace, sourceId, next);
        return next;
    }
}

async function readCollection<T = Record<string, unknown>>(path: string): Promise<RawDoc<T>[]> {
    const db = initializeFirebase();
    const snapshot = await db.collection(path).get();
    return snapshot.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() as T,
    }));
}

async function readTaskComments(tasks: RawDoc[]): Promise<TaskCommentDoc[]> {
    const nestedComments: TaskCommentDoc[] = [];

    for (const [index, task] of tasks.entries()) {
        logInfo(`Reading task comments ${index + 1}/${tasks.length}: ${task.id}`);
        const comments = await readCollection(`tasks/${task.id}/comments`);
        nestedComments.push(...comments.map((comment) => ({
            ...comment,
            taskId: task.id,
        })));
    }

    let topLevelComments: TaskCommentDoc[] = [];
    try {
        const comments = await readCollection('task_comments');
        topLevelComments = comments.flatMap((comment) => {
            const taskId = asString(comment.data.taskId);
            if (!taskId) {
                logWarn(`Skipping top-level task comment ${comment.id}: missing taskId`);
                return [];
            }

            return [{
                ...comment,
                taskId,
            }];
        });
    } catch (error) {
        logWarn(`Top-level task_comments collection could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
    }

    const deduped = new Map<string, TaskCommentDoc>();
    for (const comment of [...nestedComments, ...topLevelComments]) {
        deduped.set(`${comment.taskId}:${comment.id}`, comment);
    }

    return Array.from(deduped.values());
}

async function loadDataset(): Promise<MigrationDataset> {
    const users = await readCollection('users');
    logInfo(`Loaded users: ${users.length}`);

    const [tags, projects, invitations, subscriptions, tasks] = await Promise.all([
        readCollection('tags'),
        readCollection('projects'),
        readCollection('invitations'),
        readCollection('subscriptions'),
        readCollection('tasks'),
    ]);
    const taskComments = await readTaskComments(tasks);

    const goals: UserScopedDoc[] = [];
    const sections: UserScopedDoc[] = [];
    const routines: UserScopedDoc[] = [];
    const notes: NoteDoc[] = [];

    for (const [index, user] of users.entries()) {
        logInfo(`Reading user subcollections ${index + 1}/${users.length}: ${user.id}`);

        const [userGoals, userSections, userRoutines, dailyNotes, weeklyNotes, monthlyNotes, yearlyNotes] = await Promise.all([
            readCollection(`users/${user.id}/goals`),
            readCollection(`users/${user.id}/sections`),
            readCollection(`users/${user.id}/routines`),
            readCollection(`users/${user.id}/dailyNotes`),
            readCollection(`users/${user.id}/weeklyNotes`),
            readCollection(`users/${user.id}/monthlyNotes`),
            readCollection(`users/${user.id}/yearlyNotes`),
        ]);

        goals.push(...userGoals.map((entry) => ({ ...entry, userId: user.id })));
        sections.push(...userSections.map((entry) => ({ ...entry, userId: user.id })));
        routines.push(...userRoutines.map((entry) => ({ ...entry, userId: user.id })));

        notes.push(
            ...dailyNotes.map((entry) => ({ ...entry, userId: user.id, noteType: 'daily' as const, periodKey: entry.id })),
            ...weeklyNotes.map((entry) => ({ ...entry, userId: user.id, noteType: 'weekly' as const, periodKey: entry.id })),
            ...monthlyNotes.map((entry) => ({ ...entry, userId: user.id, noteType: 'monthly' as const, periodKey: entry.id })),
            ...yearlyNotes.map((entry) => ({ ...entry, userId: user.id, noteType: 'yearly' as const, periodKey: entry.id })),
        );
    }

    logInfo(`Loaded tags: ${tags.length}`);
    logInfo(`Loaded projects: ${projects.length}`);
    logInfo(`Loaded invitations: ${invitations.length}`);
    logInfo(`Loaded subscriptions: ${subscriptions.length}`);
    logInfo(`Loaded tasks: ${tasks.length}`);
    logInfo(`Loaded task comments: ${taskComments.length}`);
    logInfo(`Loaded goals: ${goals.length}`);
    logInfo(`Loaded sections: ${sections.length}`);
    logInfo(`Loaded routines: ${routines.length}`);
    logInfo(`Loaded notes: ${notes.length}`);

    return {
        users,
        tags,
        projects,
        invitations,
        subscriptions,
        tasks,
        taskComments,
        goals,
        sections,
        routines,
        notes,
    };
}

async function loadExistingAuthUsers(supabase: Client) {
    const allUsers: AuthUserRecord[] = [];
    let page = 1;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({
            page,
            perPage: 1000,
        });

        if (error) {
            throw new Error(`Failed to list Supabase auth users: ${error.message}`);
        }

        const users = data.users.map((user) => ({
            id: user.id,
            email: user.email,
        }));
        allUsers.push(...users);

        if (users.length < 1000) {
            break;
        }
        page += 1;
    }

    return allUsers;
}

async function ensureUserMappings(supabase: Client, registry: IdRegistry, users: RawDoc[]) {
    logInfo('Resolving user ID mappings via Supabase Auth');
    const existingUsers = await loadExistingAuthUsers(supabase);
    const authUserByEmail = new Map(
        existingUsers
            .filter((entry) => entry.email)
            .map((entry) => [entry.email!.toLowerCase(), entry.id] as const)
    );

    for (const [index, user] of users.entries()) {
        const email = asString(user.data.email);
        if (!email) {
            logError(`users/${user.id} is missing email and cannot be migrated to auth.users`);
            continue;
        }

        const emailKey = email.toLowerCase();
        const existingId = authUserByEmail.get(emailKey);
        if (existingId) {
            registry.set('users', user.id, existingId);
            counts.auth_users_reused += 1;
            logInfo(`Mapped user ${index + 1}/${users.length}: ${user.id} -> existing auth user`);
            continue;
        }

        if (dryRun) {
            const plannedId = deterministicUuid(`auth-user:${emailKey}`);
            registry.set('users', user.id, plannedId);
            counts.auth_users_created += 1;
            logInfo(`Planned auth user ${index + 1}/${users.length}: ${email}`);
            continue;
        }

        try {
            const displayName =
                asString(user.data.displayName) ??
                asString(user.data.name) ??
                asString(user.data.fullName);
            const avatarUrl = asString(user.data.avatarUrl) ?? asString(user.data.photoURL);

            const { data, error } = await supabase.auth.admin.createUser({
                email,
                password: randomBytes(24).toString('base64url'),
                email_confirm: true,
                user_metadata: {
                    display_name: displayName,
                    avatar_url: avatarUrl,
                    migrated_from_firestore_uid: user.id,
                },
            });

            if (error || !data.user) {
                throw new Error(error?.message ?? `Unknown error creating auth user for ${email}`);
            }

            registry.set('users', user.id, data.user.id);
            authUserByEmail.set(emailKey, data.user.id);
            counts.auth_users_created += 1;
            logInfo(`Created auth user ${index + 1}/${users.length}: ${email}`);

            if (sendResetEmails) {
                try {
                    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
                        type: 'recovery',
                        email,
                        options: {
                            // /auth/callback で code を session に交換してから /reset-password へ。
                            // 従来は /login 直行だが /login にはパスワード設定処理が無かった。
                            redirectTo: `${getAppUrl()}/auth/callback?next=/reset-password`,
                        },
                    });

                    if (linkError) {
                        throw new Error(linkError.message);
                    }

                    await deliverPasswordResetLink(email, linkData.properties.action_link);
                } catch (resetError) {
                    logError(`Failed to deliver password reset link for users/${user.id}`, resetError);
                }
            }
        } catch (error) {
            logError(`Failed to create auth user for users/${user.id}`, error);
        }
    }
}

async function upsertTable<T extends Record<string, unknown>>(
    supabase: Client,
    table: keyof Tables,
    rows: T[],
    onConflict: string,
    countKey: keyof EntityCounts
): Promise<BatchResult> {
    const result: BatchResult = {
        attempted: rows.length,
        succeeded: dryRun ? rows.length : 0,
        failed: 0,
        failedIds: [],
    };

    // onConflict 列の値を連結して行を識別する（id を持たない複合キーのテーブルにも対応）。
    const conflictCols = onConflict.split(',').map((col) => col.trim());
    const identify = (row: T) =>
        conflictCols
            .map((col) => String((row as Record<string, unknown>)[col] ?? '?'))
            .join('/') || '(unknown)';

    if (rows.length === 0) {
        recordWriteOutcome(countKey, result);
        return result;
    }

    counts[countKey] += rows.length;

    if (dryRun) {
        logInfo(`[DRY RUN] ${String(table)}: ${rows.length} row(s) planned`);
        recordWriteOutcome(countKey, result);
        return result;
    }

    const batches = chunk(rows, BATCH_SIZE);
    logInfo(`Writing ${String(table)} in ${batches.length} batch(es)`);

    for (const [index, batch] of batches.entries()) {
        logInfo(`${String(table)} batch ${index + 1}/${batches.length}: ${batch.length} row(s)`);
        const { error } = await supabase
            .from(table)
            .upsert(batch as never[], { onConflict });

        if (!error) {
            result.succeeded += batch.length;
            continue;
        }

        logWarn(`Batch upsert failed for ${String(table)} batch ${index + 1}; retrying row-by-row`);

        for (const row of batch) {
            const { error: rowError } = await supabase.from(table).upsert(row as never, { onConflict });
            if (rowError) {
                result.failed += 1;
                result.failedIds.push(identify(row));
                logError(`Failed upserting ${String(table)} row (${identify(row)})`, rowError);
                continue;
            }
            result.succeeded += 1;
        }
    }

    recordWriteOutcome(countKey, result);
    return result;
}

function buildProfiles(users: RawDoc[], registry: IdRegistry): ProfileInsert[] {
    return users.flatMap((user) => {
        const mappedId = registry.get('users', user.id);
        const email = asString(user.data.email);
        if (!mappedId || !email) {
            return [];
        }

        return [{
            id: mappedId,
            email,
            display_name:
                asString(user.data.displayName) ??
                asString(user.data.name) ??
                asString(user.data.fullName),
            avatar_url: asString(user.data.avatarUrl) ?? asString(user.data.photoURL),
            created_at: normalizeTimestamp(user.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(user.data.updatedAt) ?? undefined,
        }];
    });
}

function buildTags(tags: RawDoc[], registry: IdRegistry) {
    const rows: TagInsert[] = [];
    // (user_id, 正規化name) -> 生存者タグの Supabase UUID。task_tags は名前で引くため、
    // このマップが name ベースの参照解決も兼ねる（キーは trim 済み name で統一する）。
    const tagNameByUser = new Map<string, string>();
    let mergedCount = 0;

    for (const tag of tags) {
        const sourceUserId = asString(tag.data.userId);
        const userId = registry.get('users', sourceUserId);
        if (!userId) {
            logError(`Skipping tag ${tag.id}: missing user mapping for ${sourceUserId ?? '(null)'}`);
            continue;
        }

        const name = asString(tag.data.name);
        if (!name) {
            logError(`Skipping tag ${tag.id}: missing name`);
            continue;
        }

        // unique(user_id, name) 違反を防ぐため (user_id, trim済みname) 単位で重複排除する。
        // 大小文字は変えない（実データの意味を壊さない）。最初の1件を生存者とする。
        const dedupeKey = `${userId}:${name.trim()}`;
        const survivorId = tagNameByUser.get(dedupeKey);
        if (survivorId) {
            // 重複タグは投入しない。この Firestore ID の参照を生存者 UUID に張り替え、
            // 名前ベースの task_tags 紐づけも生存者へ集約する（従来は2件目の INSERT が
            // unique 違反で落ち、その名前を参照するタスクの task_tags が欠損していた）。
            registry.set('tags', tag.id, survivorId);
            mergedCount += 1;
            continue;
        }

        const id = registry.ensure('tags', tag.id);
        rows.push({
            id,
            user_id: userId,
            name,
            memo: asString(tag.data.memo),
            color: asString(tag.data.color),
            created_at: normalizeTimestamp(tag.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(tag.data.updatedAt) ?? undefined,
        });

        tagNameByUser.set(dedupeKey, id);
    }

    if (mergedCount > 0) {
        logWarn(`Tags: merged ${mergedCount} duplicate (user, name) tag(s) into their survivor to satisfy unique(user_id, name)`);
    }

    return { rows, tagNameByUser };
}

function buildProjects(projects: RawDoc[], registry: IdRegistry) {
    const projectRows: ProjectInsert[] = [];
    const memberRows: ProjectMemberInsert[] = [];

    for (const project of projects) {
        const id = registry.ensure('projects', project.id);
        const ownerSourceId =
            asString(project.data.ownerId) ??
            asString(project.data.userId);
        const ownerId = registry.get('users', ownerSourceId);

        if (!ownerId) {
            logError(`Skipping project ${project.id}: missing owner mapping for ${ownerSourceId ?? '(null)'}`);
            continue;
        }

        projectRows.push({
            id,
            owner_id: ownerId,
            title: asString(project.data.title) ?? 'Untitled project',
            description: asString(project.data.description) ?? '',
            status: pickEnumValue(project.data.status, ['active', 'completed', 'archived'] as const, 'active'),
            created_at: normalizeTimestamp(project.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(project.data.updatedAt) ?? undefined,
        });

        const memberIds = new Set<string>([
            ownerSourceId,
            ...asStringArray(project.data.memberIds),
        ].filter((entry): entry is string => Boolean(entry)));
        const roles = isObject(project.data.roles) ? project.data.roles : {};
        const createdAt = normalizeTimestamp(project.data.createdAt) ?? undefined;

        for (const memberSourceId of memberIds) {
            const mappedMemberId = registry.get('users', memberSourceId);
            if (!mappedMemberId) {
                logError(`Skipping project member for project ${project.id}: missing user mapping for ${memberSourceId}`);
                continue;
            }

            const roleValue = typeof roles[memberSourceId] === 'string' ? roles[memberSourceId] : undefined;
            const role: HubRole = pickEnumValue(roleValue ?? (memberSourceId === ownerSourceId ? 'owner' : 'member'), ['owner', 'admin', 'member', 'viewer'] as const, 'member');

            memberRows.push({
                project_id: id,
                user_id: mappedMemberId,
                role,
                created_at: createdAt,
            });
        }
    }

    return { projectRows, memberRows };
}

// ISO週文字列 'YYYY-Www' から代表月 'YYYY-MM' を導出する（週の木曜日が属する月）。
function isoWeekToMonth(weekStr: string | null): string | null {
    if (!weekStr) return null;
    const m = /^(\d{4})-W(\d{2})$/.exec(weekStr);
    if (!m) return null;
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    const monday = new Date(week1Monday);
    monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
    const thursday = new Date(monday);
    thursday.setUTCDate(monday.getUTCDate() + 3);
    return `${thursday.getUTCFullYear()}-${String(thursday.getUTCMonth() + 1).padStart(2, '0')}`;
}

// goals_period_scope_check（yearly→month/week null / monthly→month必須,week null /
// weekly→month,week必須）を満たすよう type と assigned_month/week を整える。欠損は
// 導出（weekから月）または粒度降格で救済し、CHECK違反による欠損を防ぐ。
function normalizeGoalScope(type: GoalType, month: string | null, week: string | null): {
    type: GoalType;
    assigned_month: string | null;
    assigned_week: string | null;
} {
    if (type === 'yearly') {
        return { type: 'yearly', assigned_month: null, assigned_week: null };
    }
    if (type === 'monthly') {
        if (month) return { type: 'monthly', assigned_month: month, assigned_week: null };
        return { type: 'yearly', assigned_month: null, assigned_week: null };
    }
    // weekly
    if (week) {
        const resolvedMonth = month ?? isoWeekToMonth(week);
        if (resolvedMonth) {
            return { type: 'weekly', assigned_month: resolvedMonth, assigned_week: week };
        }
    }
    if (month) return { type: 'monthly', assigned_month: month, assigned_week: null };
    return { type: 'yearly', assigned_month: null, assigned_week: null };
}

type GoalWork = {
    key: string;                // registry 'goals' 名前空間のキー `${userId}:${goalId}`
    parentKey: string | null;   // 実在する親のキー（未解決/自己参照/循環は null）
    row: GoalInsert;
};

// 親→子のトポロジカル順に並べ替える。goals.parent_goal_id は NOT DEFERRABLE な自己参照 FK
// のため、BATCH_SIZE で分割した際に「子が親より前のバッチ」に入ると FK 違反で欠損する。
// 親を必ず先に投入するため Kahn 法で並べる。循環がある場合は循環メンバーの親を null に
// して断ち切り、logError で可視化した上で末尾に追加する（本体は必ず残す）。
function topologicalSortGoals(works: GoalWork[]): GoalInsert[] {
    const byKey = new Map<string, GoalWork>();
    for (const work of works) {
        byKey.set(work.key, work);
    }

    const childrenByParent = new Map<string, GoalWork[]>();
    const inDegree = new Map<string, number>();
    for (const work of works) {
        inDegree.set(work.key, 0);
    }
    for (const work of works) {
        if (work.parentKey && byKey.has(work.parentKey)) {
            inDegree.set(work.key, (inDegree.get(work.key) ?? 0) + 1);
            const siblings = childrenByParent.get(work.parentKey) ?? [];
            siblings.push(work);
            childrenByParent.set(work.parentKey, siblings);
        }
    }

    // 親を持たないノードから幅優先で確定する。元配列順を保つため FIFO で処理する
    // （決定的な順序 = 再実行しても同じ並びになり、ログの安定性が保てる）。
    const queue: GoalWork[] = works.filter((work) => (inDegree.get(work.key) ?? 0) === 0);
    const ordered: GoalWork[] = [];
    let head = 0;
    while (head < queue.length) {
        const node = queue[head];
        head += 1;
        ordered.push(node);
        for (const child of childrenByParent.get(node.key) ?? []) {
            const remaining = (inDegree.get(child.key) ?? 0) - 1;
            inDegree.set(child.key, remaining);
            if (remaining === 0) {
                queue.push(child);
            }
        }
    }

    if (ordered.length < works.length) {
        // ordered に含まれないノードは循環に属する。親を null にして循環を断ち、末尾へ。
        const resolved = new Set(ordered.map((work) => work.key));
        for (const work of works) {
            if (!resolved.has(work.key)) {
                logError(`Goal ${work.key}: detected circular parent_goal_id; parent set to null to break the cycle`);
                work.row.parent_goal_id = null;
                ordered.push(work);
            }
        }
    }

    return ordered.map((work) => work.row);
}

function buildGoals(goals: UserScopedDoc[], registry: IdRegistry) {
    // --- 第1パス: 実在するゴールを先に採番し、キー -> UUID を確定する ---
    // parent_goal_id の FK は goals(id) を指すため、親が「実際に投入されるゴール集合」に
    // 実在する場合のみ親参照を張る（従来は registry.ensure で未登録の親 UUID を捏造し、
    // dangling parent のゴールが FK 違反で永久欠損していた）。
    const idByKey = new Map<string, string>();
    const validGoals: Array<{ goal: UserScopedDoc; userId: string; key: string; id: string }> = [];
    for (const goal of goals) {
        const userId = registry.get('users', goal.userId);
        if (!userId) {
            logError(`Skipping goal ${goal.id}: missing user mapping`);
            continue;
        }
        const key = `${goal.userId}:${goal.id}`;
        const id = registry.ensure('goals', key);
        idByKey.set(key, id);
        validGoals.push({ goal, userId, key, id });
    }

    // --- 第2パス: 行を組み立て、親参照を実在チェックした上で解決する ---
    const works: GoalWork[] = [];
    let orphanedParentCount = 0;

    for (const { goal, userId, key, id } of validGoals) {
        const rawType: GoalType = pickEnumValue(goal.data.type, ['yearly', 'monthly', 'weekly'] as const, 'weekly');
        const scope = normalizeGoalScope(rawType, asString(goal.data.assignedMonth) ?? null, asString(goal.data.assignedWeek) ?? null);
        if (scope.type !== rawType) {
            logWarn(`Goal ${goal.id}: adjusted scope ${rawType} -> ${scope.type} to satisfy period-scope constraint`);
        }
        const status: GoalStatus = pickEnumValue(goal.data.status, ['pending', 'in_progress', 'achieved', 'missed', 'cancelled'] as const, 'pending');

        const parentSourceId = asString(goal.data.parentGoalId);
        const parentKeyCandidate = parentSourceId ? `${goal.userId}:${parentSourceId}` : null;
        let resolvedParentKey: string | null = null;
        if (parentKeyCandidate) {
            if (parentKeyCandidate === key) {
                // 自己参照は論理破綻。null にして本体を残す。
                logWarn(`Goal ${goal.id}: self-referential parent_goal_id dropped`);
                orphanedParentCount += 1;
            } else if (idByKey.has(parentKeyCandidate)) {
                resolvedParentKey = parentKeyCandidate;
            } else {
                // 親が実在しない（Firestore で親削除済み等）。孤児化して本体を残す。
                orphanedParentCount += 1;
            }
        }

        const row: GoalInsert = {
            id,
            user_id: userId,
            type: scope.type,
            title: asString(goal.data.title) ?? 'Untitled goal',
            description: asString(goal.data.description),
            assigned_year: asString(goal.data.assignedYear) ?? new Date().getUTCFullYear().toString(),
            assigned_month: scope.assigned_month,
            assigned_week: scope.assigned_week,
            status,
            progress: Math.max(0, Math.min(100, asNumber(goal.data.progress, 0))),
            parent_goal_id: resolvedParentKey ? idByKey.get(resolvedParentKey)! : null,
            project_id: registry.get('projects', asString(goal.data.projectId)),
            priority: Math.max(1, Math.min(5, asNumber(goal.data.priority, 3))),
            tags: asStringArray(goal.data.tags),
            reflection: asString(goal.data.reflection),
            ai_analysis: asJson(goal.data.aiAnalysis),
            created_at: normalizeTimestamp(goal.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(goal.data.updatedAt) ?? undefined,
        };

        works.push({ key, parentKey: resolvedParentKey, row });
    }

    if (orphanedParentCount > 0) {
        logWarn(`Goals: ${orphanedParentCount} parent_goal_id reference(s) were orphaned (parent missing or self-referential) and set to null; goal rows preserved`);
    }

    // --- 第3パス: 親→子順に並べ替えてバッチ跨ぎの FK 違反を防ぐ ---
    return topologicalSortGoals(works);
}

function buildSections(sections: UserScopedDoc[], registry: IdRegistry) {
    const rows: SectionInsert[] = [];
    // (user_id, 正規化name) -> 生存者セクションの Supabase UUID
    const survivorByUserName = new Map<string, string>();
    let mergedCount = 0;

    for (const section of sections) {
        const userId = registry.get('users', section.userId);
        if (!userId) {
            logError(`Skipping section ${section.id}: missing user mapping`);
            continue;
        }

        const key = `${section.userId}:${section.id}`;
        const name = asString(section.data.name) ?? 'Untitled section';
        // unique(user_id, name) 違反を防ぐため (user_id, trim済みname) 単位で重複排除する。
        // 大小文字は変えない（実データの意味を壊さない）。最初の1件を生存者とする。
        const dedupeKey = `${userId}:${name.trim()}`;

        const survivorId = survivorByUserName.get(dedupeKey);
        if (survivorId) {
            // 重複セクションは投入しない。この Firestore ID の参照を生存者 UUID に張り替える
            // ことで、このセクションを参照するタスク/ルーチンが FK 違反・欠損しないようにする
            // （従来は2件目の INSERT が unique 違反で落ち、それを指すタスクまで FK 違反で欠損）。
            registry.set('sections', key, survivorId);
            mergedCount += 1;
            continue;
        }

        const id = registry.ensure('sections', key);
        survivorByUserName.set(dedupeKey, id);
        rows.push({
            id,
            user_id: userId,
            name,
            start_time: normalizeTime(section.data.startTime),
            end_time: normalizeTime(section.data.endTime),
            order: asNumber(section.data.order, 0),
        });
    }

    if (mergedCount > 0) {
        logWarn(`Sections: merged ${mergedCount} duplicate (user, name) section(s) into their survivor; referencing tasks/routines repointed`);
    }

    return rows;
}

function buildRoutines(routines: UserScopedDoc[], registry: IdRegistry) {
    const rows: RoutineInsert[] = [];

    for (const routine of routines) {
        const userId = registry.get('users', routine.userId);
        if (!userId) {
            logError(`Skipping routine ${routine.id}: missing user mapping`);
            continue;
        }

        // section_id は nullable 化済み（008）。参照先セクション削除済み等でマッピングが
        // 引けなくても skip せず section_id=null で投入する（従来は skip で欠損）。
        const sectionId = registry.get('sections', `${routine.userId}:${asString(routine.data.sectionId) ?? ''}`) ?? null;

        const frequency: RoutineFrequency = pickEnumValue(routine.data.frequency, ['daily', 'weekly', 'monthly', 'custom'] as const, 'daily');
        const startDate = normalizeDate(routine.data.startDate) ?? new Date().toISOString().slice(0, 10);
        const nextRun = normalizeDate(routine.data.nextRun) ?? startDate;

        // interval は CHECK (interval is null or interval > 0) 制約下。0/負値/非有限/非整数を
        // そのまま投入すると CHECK 違反でルーチンが欠損するため、正の整数のみ採用し、
        // それ以外は null にクランプする（integer 列なので floor で整数化する）。
        const rawInterval = routine.data.interval;
        const flooredInterval = typeof rawInterval === 'number' && Number.isFinite(rawInterval)
            ? Math.floor(rawInterval)
            : null;
        const interval = flooredInterval !== null && flooredInterval > 0 ? flooredInterval : null;
        if (rawInterval !== null && rawInterval !== undefined && interval === null) {
            logWarn(`Routine ${routine.id}: interval ${String(rawInterval)} is not a positive integer; clamped to null`);
        }

        rows.push({
            id: registry.ensure('routines', `${routine.userId}:${routine.id}`),
            user_id: userId,
            title: asString(routine.data.title) ?? 'Untitled routine',
            frequency,
            days_of_week: Array.isArray(routine.data.daysOfWeek)
                ? routine.data.daysOfWeek.filter((value): value is number => typeof value === 'number')
                : null,
            interval,
            start_date: startDate,
            next_run: nextRun,
            start_time: normalizeTime(routine.data.startTime),
            section_id: sectionId,
            estimated_minutes: Math.max(0, asNumber(routine.data.estimatedMinutes, 0)),
            active: asBoolean(routine.data.active, true),
            project_id: registry.get('projects', asString(routine.data.projectId)),
            tags: asStringArray(routine.data.tags),
            memo: asString(routine.data.memo),
            created_at: normalizeTimestamp(routine.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(routine.data.updatedAt) ?? undefined,
        });
    }

    return rows;
}

function buildTasks(tasks: RawDoc[], registry: IdRegistry, tagNameByUser: Map<string, string>) {
    const taskRows: TaskInsert[] = [];
    const taskTagRows: TaskTagInsert[] = [];
    const attachmentRows: PendingAttachmentInsert[] = [];

    for (const task of tasks) {
        const sourceUserId = asString(task.data.userId);
        const userId = registry.get('users', sourceUserId);
        if (!userId || !sourceUserId) {
            logError(`Skipping task ${task.id}: missing user mapping`);
            continue;
        }

        const sourceSectionId = asString(task.data.sectionId);
        // section_id は nullable 化済み（006）。ゴール/バックログタスクは section を持たない
        // （元データで sectionId='goal' や空、または参照先セクション削除済み）ので、マッピングが
        // 引けなくても skip せず section_id=null で投入する（従来は skip で欠損していた）。
        const sectionId = registry.get('sections', `${sourceUserId}:${sourceSectionId ?? ''}`) ?? null;

        const id = registry.ensure('tasks', task.id);
        // date は nullable 化済み（006）。日付なしタスク（週/月/年ゴール・バックログ, 元データ
        // date:''）は date=null として意味を保持する（従来は today にフォールバックし『今日の
        // 日次タスク』へ化けてゴール/バックログビューから消えていた）。
        const date = normalizeDate(task.data.date) ?? null;
        const tags = asStringArray(task.data.tags);
        const attachments = Array.isArray(task.data.attachments) ? task.data.attachments : [];

        taskRows.push({
            id,
            user_id: userId,
            title: asString(task.data.title) ?? 'Untitled task',
            assignee_id: registry.get('users', asString(task.data.assigneeId)),
            reporter_id: registry.get('users', asString(task.data.reporterId)),
            section_id: sectionId,
            date,
            status: pickEnumValue(task.data.status, ['open', 'in_progress', 'done', 'skipped'] as const, 'open') as TaskStatus,
            estimated_minutes: Math.max(0, asNumber(task.data.estimatedMinutes, 0)),
            actual_minutes: Math.max(0, asNumber(task.data.actualMinutes, 0)),
            started_at: normalizeTimestamp(task.data.startedAt),
            completed_at: normalizeTimestamp(task.data.completedAt),
            scheduled_start: normalizeTime(task.data.scheduledStart),
            external_link: asString(task.data.externalLink),
            parent_goal_id: registry.get('goals', `${sourceUserId}:${asString(task.data.parentGoalId) ?? ''}`),
            project_id: registry.get('projects', asString(task.data.projectId)),
            milestone_id: asString(task.data.milestoneId),
            routine_id: registry.get('routines', `${sourceUserId}:${asString(task.data.routineId) ?? ''}`),
            assigned_week: asString(task.data.assignedWeek),
            assigned_month: asString(task.data.assignedMonth),
            assigned_year: asString(task.data.assignedYear),
            assigned_date: normalizeDate(task.data.assignedDate),
            score: typeof task.data.score === 'number' ? task.data.score : null,
            order: asNumber(task.data.order, 0),
            memo: asString(task.data.memo),
            ai_tags: asStringArray(task.data.aiTags),
            ai_status: typeof task.data.aiStatus === 'string'
                ? pickEnumValue(task.data.aiStatus, ['pending', 'processing', 'completed', 'error'] as const, 'pending') as TaskAiStatus
                : null,
            ai_error: asString(task.data.aiError),
            ai_completed_at: normalizeTimestamp(task.data.aiCompletedAt),
            comment_count: Math.max(0, asNumber(task.data.commentCount, 0)),
            created_at: normalizeTimestamp(task.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(task.data.updatedAt) ?? undefined,
        });

        for (const tagName of tags) {
            // buildTags は (user_id, trim済みname) をキーに重複排除・登録しているため、
            // 参照側も trim して引く（前後空白違いで別タグ扱いにならないよう統一する）。
            const tagId = tagNameByUser.get(`${userId}:${tagName.trim()}`);
            if (!tagId) {
                logWarn(`Task ${task.id} references unknown tag "${tagName}"`);
                continue;
            }

            taskTagRows.push({
                task_id: id,
                tag_id: tagId,
            });
        }

        for (const [attachmentIndex, attachment] of attachments.entries()) {
            if (!isObject(attachment)) {
                logWarn(`Skipping malformed attachment on task ${task.id}`);
                continue;
            }

            const url = asString(attachment.url);
            const storagePath = asString(attachment.path);
            if (!url || !storagePath) {
                logWarn(`Skipping attachment on task ${task.id}: missing url or path`);
                continue;
            }

            // アプリの Storage 規約 users/{SupabaseUID}/attachments/{id}_{name} で
            // ターゲットパスを再構築する（従来は Firebase の path をそのまま採用し、
            // アプリの参照/削除ロジックとズレていた）。source_* に Firebase 側を残し、
            // migrateAttachmentsToSupabase が source→target へコピーする。
            const attachmentId = registry.ensure('attachments', `${task.id}:${asString(attachment.id) ?? attachmentIndex.toString()}`);
            const attachmentName = asString(attachment.name) ?? `attachment-${attachmentIndex + 1}`;
            const sanitizedName = attachmentName.replace(/[^\w.\-]+/g, '_');
            const targetStoragePath = `users/${userId}/attachments/${attachmentId}_${sanitizedName}`;

            attachmentRows.push({
                id: attachmentId,
                task_id: id,
                url,
                storage_path: targetStoragePath,
                name: attachmentName,
                file_type: pickEnumValue(attachment.type, ['image', 'file'] as const, 'file') as AttachmentFileType,
                size: typeof attachment.size === 'number' ? attachment.size : null,
                created_at: normalizeTimestamp(attachment.createdAt) ?? undefined,
                source_url: url,
                source_storage_path: storagePath,
            });
        }
    }

    // 005 の部分ユニークインデックス（user_id where status='in_progress' は1件のみ）に
    // 抵触しないよう、ユーザー単位で in_progress を1件に正規化する。実 Firestore には
    // タイマー放置・複数日跨ぎ等で複数 in_progress が残りうるため、最新 started_at のみ
    // in_progress を保持し、他は open へ降格する（従来はそのまま投入し unique 違反で
    // 2件目以降のタスクが移行失敗＝欠損していた）。
    const inProgressByUser = new Map<string, TaskInsert[]>();
    for (const row of taskRows) {
        if (row.status === 'in_progress') {
            const list = inProgressByUser.get(row.user_id) ?? [];
            list.push(row);
            inProgressByUser.set(row.user_id, list);
        }
    }
    for (const [normalizeUserId, rows] of inProgressByUser) {
        if (rows.length <= 1) continue;
        // 最新 started_at を in_progress として残す。started_at が同値/null の場合は
        // task id 昇順を tie-break に使い、再実行しても常に同じ1件が残るようにする
        // （不安定だと再実行時に別の行が残り 005 の部分ユニーク制約に抵触し得る）。
        rows.sort((a, b) => {
            const byStarted = (b.started_at ?? '').localeCompare(a.started_at ?? '');
            if (byStarted !== 0) return byStarted;
            return String(a.id ?? '').localeCompare(String(b.id ?? ''));
        });
        for (let i = 1; i < rows.length; i++) {
            rows[i].status = 'open';
        }
        logWarn(`User ${normalizeUserId}: demoted ${rows.length - 1} extra in_progress task(s) to open (single-active-task constraint)`);
    }

    return { taskRows, taskTagRows, attachmentRows };
}

function buildTaskComments(taskComments: TaskCommentDoc[], registry: IdRegistry) {
    const rows: TaskCommentInsert[] = [];

    for (const comment of taskComments) {
        const taskId = registry.get('tasks', comment.taskId);
        if (!taskId) {
            logError(`Skipping task comment ${comment.id}: missing task mapping for ${comment.taskId}`);
            continue;
        }

        const authorType = pickEnumValue(comment.data.authorType, ['user', 'ai'] as const, 'user') as TaskAuthorType;
        const userId = registry.get('users', asString(comment.data.userId));

        rows.push({
            id: registry.ensure('task_comments', `${comment.taskId}:${comment.id}`),
            task_id: taskId,
            user_id: userId,
            author_type: authorType,
            author_name: asString(comment.data.authorName),
            content: asString(comment.data.content) ?? '',
            created_at: normalizeTimestamp(comment.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(comment.data.updatedAt) ?? undefined,
        });
    }

    return rows;
}

function buildInvitations(invitations: RawDoc[], registry: IdRegistry) {
    const rows: InvitationInsert[] = [];

    for (const invitation of invitations) {
        const projectId = registry.get('projects', asString(invitation.data.projectId));
        const inviterId = registry.get('users', asString(invitation.data.inviterId));
        if (!projectId || !inviterId) {
            logError(`Skipping invitation ${invitation.id}: missing project or inviter mapping`);
            continue;
        }

        rows.push({
            id: registry.ensure('invitations', invitation.id),
            project_id: projectId,
            email: asString(invitation.data.email),
            role: pickEnumValue(invitation.data.role, ['owner', 'admin', 'member', 'viewer'] as const, 'member') as HubRole,
            inviter_id: inviterId,
            status: pickEnumValue(invitation.data.status, ['pending', 'accepted', 'expired'] as const, 'pending') as InvitationStatus,
            created_at: normalizeTimestamp(invitation.data.createdAt) ?? undefined,
            expires_at: normalizeTimestamp(invitation.data.expiresAt) ?? new Date().toISOString(),
            is_reusable: asBoolean(invitation.data.isReusable, false),
        });
    }

    return rows;
}

function buildSubscriptions(subscriptions: RawDoc[], registry: IdRegistry) {
    const rows: SubscriptionInsert[] = [];

    for (const subscription of subscriptions) {
        const sourceUserId = asString(subscription.data.userId) ?? subscription.id;
        const userId = registry.get('users', sourceUserId);
        if (!userId) {
            logError(`Skipping subscription ${subscription.id}: missing user mapping`);
            continue;
        }

        rows.push({
            id: deterministicUuid(`subscriptions:${sourceUserId}`),
            user_id: userId,
            stripe_customer_id: asString(subscription.data.stripeCustomerId),
            stripe_subscription_id: asString(subscription.data.stripeSubscriptionId),
            plan: pickEnumValue(subscription.data.plan, ['free', 'pro', 'business'] as const, 'free') as SubscriptionPlan,
            status: pickEnumValue(subscription.data.status, ['active', 'past_due', 'canceled', 'none'] as const, 'none') as SubscriptionStatus,
            current_period_end: normalizeTimestamp(subscription.data.currentPeriodEnd),
            created_at: normalizeTimestamp(subscription.data.createdAt) ?? undefined,
            updated_at: normalizeTimestamp(subscription.data.updatedAt) ?? undefined,
        });
    }

    return rows;
}

function buildNotes(notes: NoteDoc[], registry: IdRegistry) {
    const rows: NoteInsert[] = [];

    for (const note of notes) {
        const userId = registry.get('users', note.userId);
        if (!userId) {
            logError(`Skipping note ${note.noteType}/${note.periodKey}: missing user mapping`);
            continue;
        }

        rows.push({
            id: registry.ensure('notes', `${note.userId}:${note.noteType}:${note.periodKey}`),
            user_id: userId,
            type: note.noteType,
            period_key: note.periodKey,
            content: asString(note.data.content) ?? '',
            updated_at: normalizeTimestamp(note.data.updatedAt) ?? undefined,
        });
    }

    return rows;
}

function inferFirebaseAttachmentPath(explicitPath: string | null, url: string | null) {
    if (explicitPath) {
        return explicitPath;
    }

    if (!url) {
        return null;
    }

    try {
        const parsed = new URL(url);
        const objectPath = parsed.pathname.match(/\/o\/(.+)$/)?.[1];
        if (!objectPath) {
            return null;
        }
        return decodeURIComponent(objectPath);
    } catch {
        return null;
    }
}

async function canUseSupabaseAttachmentBucket(supabase: Client) {
    const { error } = await supabase.storage.from('attachments').list('', { limit: 1 });
    if (!error) {
        return true;
    }

    logWarn(`Supabase storage bucket "attachments" is not available: ${error.message}`);
    return false;
}

async function downloadFirebaseAttachment(path: string) {
    const bucketName = getFirebaseStorageBucketName();
    const bucket = bucketName ? getStorage().bucket(bucketName) : getStorage().bucket();
    const file = bucket.file(path);
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();

    return {
        buffer,
        contentType: metadata.contentType,
    };
}

async function migrateAttachmentsToSupabase(supabase: Client, attachments: PendingAttachmentInsert[]) {
    if (attachments.length === 0) {
        return [] as AttachmentInsert[];
    }

    if (dryRun) {
        // dry-run では Supabase 側のターゲットパスを提示（実コピーはしない）
        return attachments.map(({ source_storage_path, source_url, ...attachment }) => ({
            ...attachment,
            storage_path: attachment.storage_path,
            url: attachment.storage_path,
        }));
    }

    const bucketAvailable = await canUseSupabaseAttachmentBucket(supabase);
    if (!bucketAvailable) {
        // バケット未作成だと添付をコピーできない。サイレントに Firebase URL を残すと
        // Firebase 退役後に全滅するため、明示的に ERROR で可視化する（migration 007 の
        // attachments バケット適用が前提。runbook §2 参照）。
        logError(
            `attachments bucket unavailable: ${attachments.length} attachment(s) were NOT copied. ` +
            `Apply migration 007 (attachments bucket) and re-run. URLs left pointing at Firebase (temporary).`
        );
        return attachments.map(({ source_storage_path, source_url, ...attachment }) => ({
            ...attachment,
            storage_path: source_storage_path ?? attachment.storage_path,
            url: source_url ?? attachment.url,
        }));
    }

    const migratedRows: AttachmentInsert[] = [];

    for (const attachment of attachments) {
        const { source_storage_path, source_url, ...baseAttachment } = attachment;
        const targetPath = attachment.storage_path;
        const sourcePath = inferFirebaseAttachmentPath(source_storage_path, source_url);

        if (!sourcePath) {
            logWarn(`Skipping storage transfer for attachment ${attachment.id}: missing Firebase source path`);
            migratedRows.push({
                ...baseAttachment,
                url: source_url ?? attachment.url,
                storage_path: targetPath,
            });
            continue;
        }

        try {
            const { buffer, contentType } = await downloadFirebaseAttachment(sourcePath);
            const { error } = await supabase.storage.from('attachments').upload(targetPath, buffer, {
                upsert: true,
                contentType: contentType ?? undefined,
            });

            if (error) {
                throw new Error(error.message);
            }

            migratedRows.push({
                ...baseAttachment,
                storage_path: targetPath,
                // attachments バケットは private（migration 009）。公開URLは 403 になるため
                // 保存しない。アプリは storage_path から署名付きURLを都度生成して描画する。
                // url 列は NOT NULL のため、破綻しない値として storage_path を格納する
                // （src/lib/storage.ts の uploadTaskAttachment と同じ規約）。
                url: targetPath,
            });
        } catch (error) {
            logWarn(`Attachment transfer failed for ${attachment.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
            migratedRows.push({
                ...baseAttachment,
                storage_path: targetPath,
                url: source_url ?? attachment.url,
            });
        }
    }

    return migratedRows;
}

const SUMMARY_TABLE_KEYS: (keyof EntityCounts)[] = [
    'profiles',
    'projects',
    'project_members',
    'tags',
    'goals',
    'sections',
    'routines',
    'tasks',
    'task_tags',
    'task_comments',
    'invitations',
    'subscriptions',
    'notes',
    'attachments',
];

function printSummary() {
    console.log('\n=== Migration Summary ===');
    console.log(`Mode: ${dryRun ? 'dry-run' : 'write'}`);
    console.log(`Send reset emails: ${sendResetEmails ? 'yes' : 'no'}`);
    console.log(`Auth users created: ${counts.auth_users_created}`);
    console.log(`Auth users reused: ${counts.auth_users_reused}`);
    console.log(`Reset emails sent: ${counts.reset_emails_sent}`);
    console.log(`Reset links logged: ${counts.reset_emails_logged}`);

    // 試行 / 成功 / 失敗を明確に分けて表示する（従来は試行件数だけを表示し、行単位
    // リトライで一部が落ちても全件成功のように見えていた）。
    console.log('\n-- Table writes (attempted / succeeded / failed) --');
    for (const key of SUMMARY_TABLE_KEYS) {
        const outcome = writeOutcomes[key];
        const attempted = outcome?.attempted ?? counts[key];
        const succeeded = outcome?.succeeded ?? 0;
        const failed = outcome?.failed ?? 0;
        const flag = failed > 0 ? '   <-- FAILED' : '';
        console.log(`${`${key}:`.padEnd(18)} attempted=${attempted}  succeeded=${succeeded}  failed=${failed}${flag}`);
    }

    const totalFailed = totalWriteFailures();
    if (totalFailed > 0) {
        console.error('\n!!! WRITE FAILURES DETECTED !!!');
        console.error(
            `${totalFailed} row(s) failed to persist. Migrated data is INCOMPLETE — ` +
            `investigate and re-run before retiring Firestore.`
        );
        for (const key of SUMMARY_TABLE_KEYS) {
            const outcome = writeOutcomes[key];
            if (outcome && outcome.failed > 0) {
                console.error(`  ${key}: ${outcome.failed} failed [${outcome.failedIds.join(', ')}]`);
            }
        }
    }

    console.log(`\nerrors: ${errorCount}`);
    console.log(`failed rows: ${totalFailed}`);
}

async function main() {
    logInfo(`Starting Firestore -> Supabase migration (${dryRun ? 'dry-run' : 'write'})`);

    const supabase = getSupabaseClient();
    const dataset = await loadDataset();
    const registry = new IdRegistry();

    await ensureUserMappings(supabase, registry, dataset.users);

    const profiles = buildProfiles(dataset.users, registry);
    const { rows: tagRows, tagNameByUser } = buildTags(dataset.tags, registry);
    const { projectRows, memberRows } = buildProjects(dataset.projects, registry);
    const goalRows = buildGoals(dataset.goals, registry);
    const sectionRows = buildSections(dataset.sections, registry);
    const routineRows = buildRoutines(dataset.routines, registry);
    const { taskRows, taskTagRows, attachmentRows } = buildTasks(dataset.tasks, registry, tagNameByUser);
    const taskCommentRows = buildTaskComments(dataset.taskComments, registry);
    const invitationRows = buildInvitations(dataset.invitations, registry);
    const subscriptionRows = buildSubscriptions(dataset.subscriptions, registry);
    const noteRows = buildNotes(dataset.notes, registry);
    const migratedAttachmentRows = await migrateAttachmentsToSupabase(supabase, attachmentRows);

    logInfo('Beginning ordered upserts');

    await upsertTable(supabase, 'profiles', profiles, 'id', 'profiles');
    await upsertTable(supabase, 'projects', projectRows, 'id', 'projects');
    await upsertTable(supabase, 'project_members', memberRows, 'project_id,user_id', 'project_members');
    await upsertTable(supabase, 'tags', tagRows, 'id', 'tags');
    await upsertTable(supabase, 'sections', sectionRows, 'id', 'sections');
    await upsertTable(supabase, 'goals', goalRows, 'id', 'goals');
    await upsertTable(supabase, 'routines', routineRows, 'id', 'routines');
    await upsertTable(supabase, 'tasks', taskRows, 'id', 'tasks');
    await upsertTable(supabase, 'task_comments', taskCommentRows, 'id', 'task_comments');
    await upsertTable(supabase, 'task_tags', taskTagRows, 'task_id,tag_id', 'task_tags');
    await upsertTable(supabase, 'attachments', migratedAttachmentRows, 'id', 'attachments');
    await upsertTable(supabase, 'invitations', invitationRows, 'id', 'invitations');
    await upsertTable(supabase, 'subscriptions', subscriptionRows, 'user_id', 'subscriptions');
    await upsertTable(supabase, 'notes', noteRows, 'user_id,type,period_key', 'notes');

    printSummary();

    // 書き込み失敗が1件でもあれば（行単位リトライでも落ちた行があれば）非0終了させ、
    // 成功したように見える誤検出を防ぐ。失敗行は logError 済みで errorCount にも計上される
    // が、明示的に totalWriteFailures も条件に含めて堅牢にする。
    if (errorCount > 0 || totalWriteFailures() > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    logError('Migration failed before completion', error);
    printSummary();
    process.exitCode = 1;
});
