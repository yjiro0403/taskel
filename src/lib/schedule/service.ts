import type { SupabaseClient, User } from '@supabase/supabase-js';

import { ApiError } from '@/lib/api/errors';
import { checkQuota, incrementRequestCount, recordTokenUsage } from '@/lib/billing/usage';
import {
    ALLOWED_IMAGE_MIME,
    DEFAULT_RETENTION_DAYS,
    INTAKE_MEMO,
    MAX_IMAGE_BYTES,
    SCHEDULE_BUCKET,
    SCHEDULE_TIME_ZONE,
    type ScheduleImageMime,
} from '@/lib/schedule/constants';
import { extractSchedule } from '@/lib/schedule/extract';
import {
    buildGoogleEventWrite,
    deleteGoogleEvent,
    GoogleCalendarWriteError,
    upsertGoogleEvent,
} from '@/lib/schedule/googleCalendarWrite';
import { contentHashForImage, contentHashForText } from '@/lib/schedule/idempotency';
import { isCalendarId, validateManualCandidate } from '@/lib/schedule/manual';
import { stripImageMetadata } from '@/lib/schedule/metadata';
import { decideSchedulePolicy } from '@/lib/schedule/policy';
import {
    appendAudit,
    asJson,
    intakeView,
    readCandidates,
    settingsFromRow,
    type IntakeRow,
    type SettingsRow,
} from '@/lib/schedule/present';
import { durationMinutes } from '@/lib/schedule/time';
import type {
    EditableCandidateInput,
    IntakeSource,
    ScheduleIntakeView,
    ScheduleSettings,
} from '@/lib/schedule/types';
import { getPersistedSectionForTime } from '@/lib/sectionUtils';
import { ensureProfile, upsertTask } from '@/lib/supabase/data';
import { mapSection } from '@/lib/supabase/mappers';
import type { Database } from '@/types/supabase';
import type { Task } from '@/types';

type Client = SupabaseClient<Database>;

const OPEN_FOR_EXTRACT = new Set(['received', 'extracting', 'failed', 'needs_review']);

function imageExtension(mime: ScheduleImageMime): string {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    return 'jpg';
}

function isImageMime(mime: string): mime is ScheduleImageMime {
    return (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

async function signedImageUrl(supabase: Client, path: string | null): Promise<string | null> {
    if (!path) {
        return null;
    }
    const { data, error } = await supabase.storage.from(SCHEDULE_BUCKET).createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) {
        return null;
    }
    return data.signedUrl;
}

function eligibleNow(row: IntakeRow, settings: ScheduleSettings, now: Date): boolean {
    if (row.status !== 'needs_review' || row.purged_at) {
        return false;
    }
    const decision = decideSchedulePolicy(readCandidates(row.candidates), {
        now,
        autoRegisterEnabled: settings.autoRegister,
        sourceText: row.raw_text,
        imageNotes: row.image_notes,
    });
    return decision.eligibleForAuto;
}

async function toView(supabase: Client, row: IntakeRow, settings: ScheduleSettings, now: Date): Promise<ScheduleIntakeView> {
    const imageUrl = await signedImageUrl(supabase, row.purged_at ? null : row.image_path);
    return intakeView(row, imageUrl, eligibleNow(row, settings, now));
}

async function loadSettings(supabase: Client, userId: string): Promise<SettingsRow> {
    const { data, error } = await supabase
        .from('schedule_intake_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) {
        throw new ApiError(500, 'settings_read_failed');
    }
    if (data) {
        return data;
    }
    const { data: created, error: insertError } = await supabase
        .from('schedule_intake_settings')
        .insert({
            user_id: userId,
            auto_register: false,
            retention_days: DEFAULT_RETENTION_DAYS,
            calendar_id: 'primary',
        })
        .select('*')
        .single();
    if (insertError || !created) {
        throw new ApiError(500, 'settings_create_failed');
    }
    return created;
}

async function patchRow(
    supabase: Client,
    row: IntakeRow,
    fields: Database['public']['Tables']['schedule_intakes']['Update'],
    action: string,
    ok: boolean,
    code?: string,
): Promise<IntakeRow> {
    const { data, error } = await supabase
        .from('schedule_intakes')
        .update({
            ...fields,
            audit: appendAudit(row.audit, action, ok, code),
            updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('user_id', row.user_id)
        .select('*')
        .single();
    if (error || !data) {
        throw new ApiError(500, 'intake_update_failed');
    }
    return data;
}

export async function getScheduleSettings(supabase: Client, user: User): Promise<ScheduleSettings> {
    await ensureProfile(supabase, user);
    return settingsFromRow(await loadSettings(supabase, user.id));
}

export async function saveScheduleSettings(
    supabase: Client,
    user: User,
    input: ScheduleSettings,
): Promise<ScheduleSettings> {
    await ensureProfile(supabase, user);
    if (!isCalendarId(input.calendarId)) {
        throw new ApiError(400, 'invalid_calendar');
    }
    if (input.retentionDays < 1 || input.retentionDays > 365) {
        throw new ApiError(400, 'invalid_retention');
    }
    const { data, error } = await supabase
        .from('schedule_intake_settings')
        .upsert({
            user_id: user.id,
            auto_register: input.autoRegister,
            retention_days: input.retentionDays,
            calendar_id: input.calendarId,
            default_duration_minutes: input.defaultDurationMinutes,
            updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();
    if (error || !data) {
        throw new ApiError(500, 'settings_save_failed');
    }

    const { data: rows } = await supabase
        .from('schedule_intakes')
        .select('id, created_at')
        .eq('user_id', user.id)
        .is('purged_at', null)
        .limit(200);
    if (rows) {
        await Promise.all(rows.map((row) => {
            const expires = new Date(new Date(row.created_at).getTime() + input.retentionDays * 86_400_000);
            return supabase
                .from('schedule_intakes')
                .update({ expires_at: expires.toISOString() })
                .eq('id', row.id)
                .eq('user_id', user.id);
        }));
    }
    return settingsFromRow(data);
}

export async function purgeExpiredIntakes(supabase: Client, userId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
        .from('schedule_intakes')
        .select('*')
        .eq('user_id', userId)
        .is('purged_at', null)
        .lt('expires_at', nowIso)
        .limit(50);
    if (error || !data) {
        return;
    }
    for (const row of data) {
        if (row.image_path) {
            await supabase.storage.from(SCHEDULE_BUCKET).remove([row.image_path]);
        }
        await patchRow(supabase, row, {
            raw_text: null,
            image_path: null,
            image_mime: null,
            image_notes: null,
            candidates: [],
            purged_at: nowIso,
        }, 'purged', true);
    }
}

export async function listScheduleIntakes(supabase: Client, user: User): Promise<{
    intakes: ScheduleIntakeView[];
    settings: ScheduleSettings;
}> {
    await ensureProfile(supabase, user);
    await purgeExpiredIntakes(supabase, user.id);
    const settingsRow = await loadSettings(supabase, user.id);
    const settings = settingsFromRow(settingsRow);
    const { data, error } = await supabase
        .from('schedule_intakes')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error || !data) {
        throw new ApiError(500, 'intake_list_failed');
    }
    const now = new Date();
    const intakes = await Promise.all(data.map((row) => toView(supabase, row, settings, now)));
    return { intakes, settings };
}

async function findOpenByHash(supabase: Client, userId: string, contentHash: string): Promise<IntakeRow | null> {
    const { data, error } = await supabase
        .from('schedule_intakes')
        .select('*')
        .eq('user_id', userId)
        .eq('content_hash', contentHash)
        .neq('status', 'cancelled')
        .maybeSingle();
    if (error) {
        throw new ApiError(500, 'intake_lookup_failed');
    }
    return data;
}

async function storeImage(
    supabase: Client,
    userId: string,
    intakeId: string,
    bytes: Uint8Array,
    mime: ScheduleImageMime,
): Promise<string> {
    const path = `users/${userId}/intakes/${intakeId}.${imageExtension(mime)}`;
    const { error } = await supabase.storage.from(SCHEDULE_BUCKET).upload(path, Buffer.from(bytes), {
        contentType: mime,
        upsert: true,
    });
    if (error) {
        throw new ApiError(500, 'image_store_failed');
    }
    return path;
}

async function runExtraction(
    supabase: Client,
    row: IntakeRow,
    settings: ScheduleSettings,
    input: { text?: string | null; image?: { bytes: Uint8Array; mime: string } | null },
    googleAccessToken: string | null,
    now: Date,
): Promise<ScheduleIntakeView> {
    let current = await patchRow(supabase, row, {
        status: 'extracting',
        error_code: null,
    }, 'extracting', true);

    const quota = await checkQuota(row.user_id);
    if (!quota.allowed) {
        current = await patchRow(supabase, current, {
            status: 'failed',
            error_code: 'quota_exceeded',
        }, 'extract_failed', false, 'quota_exceeded');
        return toView(supabase, current, settings, now);
    }

    await incrementRequestCount(row.user_id);
    try {
        const extracted = await extractSchedule({
            text: input.text,
            image: input.image,
            now,
        });
        recordTokenUsage(row.user_id, extracted.inputTokens, extracted.outputTokens);
        const decision = decideSchedulePolicy(extracted.candidates, {
            now,
            autoRegisterEnabled: settings.autoRegister,
            sourceText: input.text,
            imageNotes: extracted.imageNotes,
        });
        current = await patchRow(supabase, current, {
            status: decision.autoRegister ? 'registering' : 'needs_review',
            candidates: asJson(extracted.candidates),
            reasons: asJson(decision.reasons),
            image_notes: extracted.imageNotes,
            input_tokens: extracted.inputTokens,
            output_tokens: extracted.outputTokens,
            error_code: null,
        }, 'extracted', true, decision.autoRegister ? 'auto' : decision.reasons[0]);

        if (decision.autoRegister && decision.candidate) {
            if (!googleAccessToken) {
                current = await patchRow(supabase, current, {
                    status: 'needs_review',
                    reasons: asJson(['google_auth_required']),
                    error_code: 'google_auth_required',
                }, 'register_skipped', false, 'google_auth_required');
                return toView(supabase, current, settings, now);
            }
            return registerPrepared(supabase, current, settings, decision.candidate, settings.calendarId, googleAccessToken, now);
        }
        return toView(supabase, current, settings, now);
    } catch (error) {
        const code = error instanceof ApiError ? error.message : 'extract_failed';
        console.error('schedule extract failed', { intakeId: row.id, code });
        current = await patchRow(supabase, current, {
            status: 'failed',
            error_code: code,
        }, 'extract_failed', false, code);
        return toView(supabase, current, settings, now);
    }
}

async function createTaskForIntake(
    supabase: Client,
    row: IntakeRow,
    candidate: EditableCandidateInput & { title: string },
    htmlLink: string | null,
    startUtc: Date | null,
    endUtc: Date | null,
): Promise<void> {
    const { data: sectionRows } = await supabase
        .from('sections')
        .select('*')
        .eq('user_id', row.user_id);
    const sections = (sectionRows ?? []).map((section) => mapSection(section));
    const sectionId = candidate.allDay || !candidate.startTime
        ? undefined
        : getPersistedSectionForTime(sections, candidate.startTime);
    const task: Task = {
        id: row.id,
        userId: row.user_id,
        title: candidate.title,
        sectionId: sectionId ?? '',
        date: candidate.date,
        status: 'open',
        estimatedMinutes: startUtc && endUtc ? durationMinutes(startUtc, endUtc) : 0,
        actualMinutes: 0,
        scheduledStart: candidate.allDay ? undefined : candidate.startTime,
        externalLink: htmlLink ?? undefined,
        order: 0,
        memo: INTAKE_MEMO,
    };
    await upsertTask(supabase, task, row.user_id);
}

async function registerPrepared(
    supabase: Client,
    row: IntakeRow,
    settings: ScheduleSettings,
    candidate: NonNullable<ReturnType<typeof validateManualCandidate>['candidate']>,
    calendarId: string,
    googleAccessToken: string,
    now: Date,
): Promise<ScheduleIntakeView> {
    const manualTimes = validateManualCandidate({
        title: candidate.title ?? '',
        date: candidate.date ?? '',
        startTime: candidate.startTime ?? '',
        endTime: candidate.endTime ?? '',
        timeZone: candidate.timeZone || SCHEDULE_TIME_ZONE,
        allDay: candidate.allDay,
    });
    if (!manualTimes.ok || !manualTimes.candidate) {
        const failed = await patchRow(supabase, row, {
            status: 'needs_review',
            error_code: manualTimes.error,
        }, 'register_failed', false, manualTimes.error ?? 'invalid');
        return toView(supabase, failed, settings, now);
    }

    const event = buildGoogleEventWrite(row.id, manualTimes.candidate);
    if (!event || !isCalendarId(calendarId)) {
        const failed = await patchRow(supabase, row, {
            status: 'needs_review',
            error_code: 'invalid_calendar',
        }, 'register_failed', false, 'invalid_calendar');
        return toView(supabase, failed, settings, now);
    }

    let current = await patchRow(supabase, row, {
        status: 'registering',
        google_event_id: event.id,
        google_calendar_id: calendarId,
        error_code: null,
    }, 'registering', true);

    try {
        const written = await upsertGoogleEvent(googleAccessToken, calendarId, event);
        current = await patchRow(supabase, current, {
            google_event_id: written.id,
            google_event_link: written.htmlLink,
            google_calendar_id: calendarId,
        }, 'google_upserted', true);
        await createTaskForIntake(
            supabase,
            current,
            {
                title: manualTimes.candidate.title ?? '',
                date: manualTimes.candidate.date ?? '',
                startTime: manualTimes.candidate.startTime ?? '',
                endTime: manualTimes.candidate.endTime ?? '',
                timeZone: manualTimes.candidate.timeZone,
                allDay: manualTimes.candidate.allDay,
            },
            written.htmlLink,
            manualTimes.startUtc,
            manualTimes.endUtc,
        );
        current = await patchRow(supabase, current, {
            status: 'registered',
            task_id: row.id,
            candidates: asJson([manualTimes.candidate]),
            reasons: [],
            error_code: null,
        }, 'registered', true);
        return toView(supabase, current, settings, now);
    } catch (error) {
        const code = error instanceof GoogleCalendarWriteError
            ? (error.status === 401 || error.status === 403 ? 'google_auth_required' : 'google_write_failed')
            : 'task_create_failed';
        console.error('schedule register failed', { intakeId: row.id, code });
        const failed = await patchRow(supabase, current, {
            status: 'failed',
            error_code: code,
        }, 'register_failed', false, code);
        return toView(supabase, failed, settings, now);
    }
}

export async function createScheduleIntake(
    supabase: Client,
    user: User,
    input: {
        source: IntakeSource;
        text?: string | null;
        image?: { bytes: Uint8Array; mime: string } | null;
        googleAccessToken?: string | null;
    },
): Promise<{ intake: ScheduleIntakeView; reused: boolean }> {
    await ensureProfile(supabase, user);
    const text = input.text?.replace(/\u0000/g, '').trim() ?? '';
    const image = input.image;
    if (!text && !image) {
        throw new ApiError(400, 'empty_intake');
    }
    if (text.length > 4000) {
        throw new ApiError(400, 'text_too_long');
    }
    if (image && (!isImageMime(image.mime) || image.bytes.byteLength > MAX_IMAGE_BYTES || image.bytes.byteLength === 0)) {
        throw new ApiError(400, 'invalid_image');
    }

    const storedImage = image && isImageMime(image.mime)
        ? { bytes: stripImageMetadata(image.bytes, image.mime), mime: image.mime }
        : null;
    const contentHash = storedImage
        ? contentHashForImage(storedImage.bytes)
        : contentHashForText(text);
    const settingsRow = await loadSettings(supabase, user.id);
    const settings = settingsFromRow(settingsRow);
    const now = new Date();

    const existing = await findOpenByHash(supabase, user.id, contentHash);
    if (existing) {
        if (existing.purged_at || !OPEN_FOR_EXTRACT.has(existing.status) || existing.status === 'needs_review' && readCandidates(existing.candidates).length > 0) {
            return { intake: await toView(supabase, existing, settings, now), reused: true };
        }
        if (existing.status === 'registering' || existing.status === 'registered') {
            return { intake: await toView(supabase, existing, settings, now), reused: true };
        }
        const intake = await runExtraction(
            supabase,
            existing,
            settings,
            { text: existing.raw_text ?? text, image: storedImage },
            input.googleAccessToken ?? null,
            now,
        );
        return { intake, reused: false };
    }

    const id = crypto.randomUUID();
    const expires = new Date(now.getTime() + settings.retentionDays * 86_400_000);
    const { data: inserted, error } = await supabase
        .from('schedule_intakes')
        .insert({
            id,
            user_id: user.id,
            source: input.source,
            status: 'received',
            content_hash: contentHash,
            raw_text: text || null,
            expires_at: expires.toISOString(),
            audit: appendAudit([], 'received', true),
        })
        .select('*')
        .single();
    if (error || !inserted) {
        if (error?.code === '23505') {
            const winner = await findOpenByHash(supabase, user.id, contentHash);
            if (winner) {
                return { intake: await toView(supabase, winner, settings, now), reused: true };
            }
        }
        throw new ApiError(500, 'intake_create_failed');
    }

    let current = inserted;
    if (storedImage) {
        try {
            const path = await storeImage(supabase, user.id, id, storedImage.bytes, storedImage.mime);
            current = await patchRow(supabase, current, {
                image_path: path,
                image_mime: storedImage.mime,
            }, 'image_stored', true);
        } catch (storeError) {
            const code = storeError instanceof ApiError ? storeError.message : 'image_store_failed';
            current = await patchRow(supabase, current, {
                status: 'failed',
                error_code: code,
            }, 'image_store_failed', false, code);
            return { intake: await toView(supabase, current, settings, now), reused: false };
        }
    }

    const intake = await runExtraction(
        supabase,
        current,
        settings,
        { text, image: storedImage },
        input.googleAccessToken ?? null,
        now,
    );
    return { intake, reused: false };
}

async function ownedIntake(supabase: Client, userId: string, intakeId: string): Promise<IntakeRow> {
    const { data, error } = await supabase
        .from('schedule_intakes')
        .select('*')
        .eq('id', intakeId)
        .eq('user_id', userId)
        .maybeSingle();
    if (error) {
        throw new ApiError(500, 'intake_read_failed');
    }
    if (!data) {
        throw new ApiError(404, 'intake_not_found');
    }
    return data;
}

export async function retryScheduleExtraction(
    supabase: Client,
    user: User,
    intakeId: string,
    googleAccessToken: string | null,
): Promise<ScheduleIntakeView> {
    await ensureProfile(supabase, user);
    const settings = settingsFromRow(await loadSettings(supabase, user.id));
    const row = await ownedIntake(supabase, user.id, intakeId);
    if (row.purged_at) {
        throw new ApiError(409, 'intake_purged');
    }
    if (row.status === 'registered' || row.status === 'cancelled') {
        throw new ApiError(409, 'intake_closed');
    }
    let image: { bytes: Uint8Array; mime: string } | null = null;
    if (row.image_path) {
        const { data, error } = await supabase.storage.from(SCHEDULE_BUCKET).download(row.image_path);
        if (error || !data) {
            throw new ApiError(500, 'image_read_failed');
        }
        image = {
            bytes: new Uint8Array(await data.arrayBuffer()),
            mime: row.image_mime ?? 'image/jpeg',
        };
    }
    return runExtraction(
        supabase,
        row,
        settings,
        { text: row.raw_text, image },
        googleAccessToken,
        new Date(),
    );
}

export async function registerScheduleIntake(
    supabase: Client,
    user: User,
    intakeId: string,
    input: EditableCandidateInput,
    calendarId: string | null,
    googleAccessToken: string | null,
): Promise<ScheduleIntakeView> {
    await ensureProfile(supabase, user);
    const settings = settingsFromRow(await loadSettings(supabase, user.id));
    const now = new Date();
    let row = await ownedIntake(supabase, user.id, intakeId);
    if (row.status === 'registered' && row.task_id) {
        return toView(supabase, row, settings, now);
    }
    if (row.status === 'cancelled' || row.purged_at) {
        throw new ApiError(409, 'intake_closed');
    }
    const manual = validateManualCandidate(input);
    if (!manual.ok || !manual.candidate) {
        throw new ApiError(400, manual.error ?? 'invalid_candidate');
    }
    const destination = calendarId && isCalendarId(calendarId) ? calendarId : settings.calendarId;
    if (!isCalendarId(destination)) {
        throw new ApiError(400, 'invalid_calendar');
    }
    if (!googleAccessToken) {
        row = await patchRow(supabase, row, {
            status: 'needs_review',
            error_code: 'google_auth_required',
        }, 'register_skipped', false, 'google_auth_required');
        throw new ApiError(401, 'google_auth_required');
    }
    return registerPrepared(supabase, row, settings, manual.candidate, destination, googleAccessToken, now);
}

function taskWasUntouched(task: {
    status: string;
    actual_minutes: number;
    started_at: string | null;
    completed_at: string | null;
    memo: string | null;
}): boolean {
    return task.status === 'open'
        && task.actual_minutes === 0
        && !task.started_at
        && !task.completed_at
        && (task.memo === INTAKE_MEMO || task.memo === null || task.memo === '');
}

export async function cancelScheduleIntake(
    supabase: Client,
    user: User,
    intakeId: string,
    googleAccessToken: string | null,
): Promise<ScheduleIntakeView> {
    await ensureProfile(supabase, user);
    const settings = settingsFromRow(await loadSettings(supabase, user.id));
    const now = new Date();
    let row = await ownedIntake(supabase, user.id, intakeId);
    if (row.status === 'cancelled') {
        return toView(supabase, row, settings, now);
    }
    if (!row.google_event_id || !row.google_calendar_id) {
        throw new ApiError(409, 'nothing_to_cancel');
    }
    if (!googleAccessToken) {
        throw new ApiError(401, 'google_auth_required');
    }
    try {
        await deleteGoogleEvent(googleAccessToken, row.google_calendar_id, row.google_event_id);
    } catch (error) {
        const code = error instanceof GoogleCalendarWriteError ? 'google_cancel_failed' : 'google_cancel_failed';
        console.error('schedule cancel failed', { intakeId: row.id, code });
        row = await patchRow(supabase, row, {
            error_code: code,
        }, 'cancel_failed', false, code);
        return toView(supabase, row, settings, now);
    }

    let taskCode = 'task_missing';
    if (row.task_id) {
        const { data: task } = await supabase
            .from('tasks')
            .select('status, actual_minutes, started_at, completed_at, memo')
            .eq('id', row.task_id)
            .eq('user_id', user.id)
            .maybeSingle();
        if (task && taskWasUntouched(task)) {
            const { error } = await supabase.from('tasks').delete().eq('id', row.task_id).eq('user_id', user.id);
            taskCode = error ? 'task_kept' : 'task_deleted';
        } else if (task) {
            taskCode = 'task_kept';
        }
    }

    row = await patchRow(supabase, row, {
        status: 'cancelled',
        error_code: taskCode === 'task_deleted' ? null : taskCode,
    }, 'cancelled', true, taskCode);
    return toView(supabase, row, settings, now);
}

export async function deleteScheduleIntake(supabase: Client, user: User, intakeId: string): Promise<void> {
    await ensureProfile(supabase, user);
    const row = await ownedIntake(supabase, user.id, intakeId);
    if (row.google_event_id && row.status !== 'cancelled') {
        throw new ApiError(409, 'cancel_first');
    }
    if (row.image_path) {
        await supabase.storage.from(SCHEDULE_BUCKET).remove([row.image_path]);
    }
    const { error } = await supabase
        .from('schedule_intakes')
        .delete()
        .eq('id', row.id)
        .eq('user_id', user.id);
    if (error) {
        throw new ApiError(500, 'intake_delete_failed');
    }
}
