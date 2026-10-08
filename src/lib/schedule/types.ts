export const INTAKE_SOURCES = ['text', 'image_upload', 'image_share'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export const INTAKE_STATUSES = [
    'received',
    'extracting',
    'needs_review',
    'registering',
    'registered',
    'failed',
    'cancelled',
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export const REVIEW_REASONS = [
    'multiple_items',
    'not_confirmed',
    'missing_title',
    'missing_year',
    'missing_date',
    'missing_start',
    'missing_end',
    'ambiguous_time',
    'weekday_mismatch',
    'past_date',
    'end_not_after_start',
    'timezone_uncertain',
    'dst_gap',
    'relative_expression',
    'conversation_change',
    'tentative',
    'all_day',
    'unreadable',
    'auto_register_off',
    'google_auth_required',
    'notification_time',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface ExplicitFields {
    year: boolean;
    month: boolean;
    day: boolean;
    startTime: boolean;
    endTime: boolean;
    title: boolean;
    timezone: boolean;
}

/** One schedule candidate after the server has checked the model output. */
export interface ScheduleCandidate {
    title: string | null;
    suggestedTitle: string | null;
    date: string | null;
    suggestedDate: string | null;
    startTime: string | null;
    suggestedStartTime: string | null;
    endTime: string | null;
    suggestedEndTime: string | null;
    timeZone: string;
    timeZoneSource: 'explicit' | 'default';
    allDay: boolean;
    status: 'confirmed' | 'candidate' | 'unknown';
    explicit: ExplicitFields;
    sourceEvidence: string;
    uncertainties: string[];
    weekdayLabel: string | null;
}

export interface SchedulePolicy {
    eligibleForAuto: boolean;
    autoRegister: boolean;
    reasons: ReviewReason[];
    /** The single candidate when there is exactly one. */
    candidate: ScheduleCandidate | null;
}

export interface EditableCandidateInput {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    allDay: boolean;
}

export interface ScheduleSettings {
    autoRegister: boolean;
    retentionDays: number;
    calendarId: string;
    defaultDurationMinutes: number | null;
}

export interface ScheduleIntakeView {
    id: string;
    source: IntakeSource;
    status: IntakeStatus;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    imageUrl: string | null;
    rawText: string | null;
    candidates: ScheduleCandidate[];
    reasons: ReviewReason[];
    imageNotes: string | null;
    errorCode: string | null;
    googleEventLink: string | null;
    googleCalendarId: string | null;
    taskId: string | null;
    hasGoogleEvent: boolean;
    eligibleForAuto: boolean;
    purged: boolean;
    inputTokens: number | null;
    outputTokens: number | null;
}
