export const SCHEDULE_TIME_ZONE = 'Asia/Tokyo';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type ScheduleImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export const SCHEDULE_BUCKET = 'schedule-intakes';

export const INTAKE_MEMO = '予定の取り込みから作成';

/** Write events, and keep the existing read-only import scope. */
export const GOOGLE_CALENDAR_WRITE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export const LOCAL_INBOX_DB = 'taskel-schedule-inbox';
export const LOCAL_INBOX_STORE = 'captures';

export const DEFAULT_RETENTION_DAYS = 30;

export const BILLING_ACK_ENV = 'SCHEDULE_INTAKE_AI_BILLING_ACK';

export const SCHEDULE_MODEL = 'gemini-2.5-flash';
