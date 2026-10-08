import type { Json } from '@/types/supabase';
import type { Database } from '@/types/supabase';

import { REVIEW_REASONS, type ReviewReason, type ScheduleCandidate, type ScheduleIntakeView, type ScheduleSettings } from '@/lib/schedule/types';

export type IntakeRow = Database['public']['Tables']['schedule_intakes']['Row'];
export type SettingsRow = Database['public']['Tables']['schedule_intake_settings']['Row'];

export function asJson(value: unknown): Json {
    return JSON.parse(JSON.stringify(value)) as Json;
}

export function readCandidates(value: Json): ScheduleCandidate[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const items: ScheduleCandidate[] = [];
    for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item) && 'explicit' in item) {
            items.push(item as unknown as ScheduleCandidate);
        }
    }
    return items;
}

export function readReasons(value: Json): ReviewReason[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is ReviewReason =>
        typeof item === 'string' && (REVIEW_REASONS as readonly string[]).includes(item)
    );
}

export function appendAudit(current: Json, action: string, ok: boolean, code?: string): Json {
    const list = Array.isArray(current) ? current.slice(-49) : [];
    list.push({
        t: new Date().toISOString(),
        action,
        ok,
        ...(code ? { code } : {}),
    });
    return list as Json;
}

export function settingsFromRow(row: SettingsRow): ScheduleSettings {
    return {
        autoRegister: row.auto_register,
        retentionDays: row.retention_days,
        calendarId: row.calendar_id,
        defaultDurationMinutes: row.default_duration_minutes,
    };
}

export function intakeView(
    row: IntakeRow,
    imageUrl: string | null,
    eligibleForAuto: boolean,
): ScheduleIntakeView {
    return {
        id: row.id,
        source: row.source as ScheduleIntakeView['source'],
        status: row.status as ScheduleIntakeView['status'],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        imageUrl: row.purged_at ? null : imageUrl,
        rawText: row.purged_at ? null : row.raw_text,
        candidates: row.purged_at ? [] : readCandidates(row.candidates),
        reasons: readReasons(row.reasons),
        imageNotes: row.purged_at ? null : row.image_notes,
        errorCode: row.error_code,
        googleEventLink: row.google_event_link,
        googleCalendarId: row.google_calendar_id,
        taskId: row.task_id,
        hasGoogleEvent: Boolean(row.google_event_id),
        eligibleForAuto,
        purged: Boolean(row.purged_at),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
    };
}
