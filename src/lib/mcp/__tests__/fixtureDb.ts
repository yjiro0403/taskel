/**
 * Deterministic McpDb and auth context shared by the protocol and contract tests.
 * FIXTURE_NOW is 10:00 on Sunday 2026-11-15 in Asia/Tokyo.
 */

import { buildMcpContext, type McpContext } from '@/lib/mcp/auth';
import type {
    McpAuth,
    McpCreateInput,
    McpCreateResult,
    McpDaySnapshot,
    McpDb,
    McpRevokeResult,
    McpSearchInput,
    McpSearchResult,
    McpTaskRow,
} from '@/lib/mcp/db';
import type { McpScope } from '@/lib/mcp/scopes';

export const FIXTURE_NOW = new Date('2026-11-15T01:00:00Z');

export const FIXTURE_AUTH: McpAuth = {
    userId: '11111111-1111-4111-8111-111111111111',
    tokenId: '22222222-2222-4222-8222-222222222222',
    tokenName: 'Beacon',
    tokenPrefix: 'tsk_mcp_AbCdEfGh',
    scopes: ['tasks:read', 'tasks:create'],
    timezone: 'Asia/Tokyo',
    expiresAt: '2027-02-13T01:00:00+00:00',
};

const SECTION_MORNING = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECTION_LUNCH = 'aaaaaaaa-0000-4000-8000-000000000002';
const SECTION_AFTERNOON = 'aaaaaaaa-0000-4000-8000-000000000003';
const SECTION_EVENING = 'aaaaaaaa-0000-4000-8000-000000000004';
const SECTION_NIGHT = 'aaaaaaaa-0000-4000-8000-000000000005';

const TASK_STRETCH_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
export const FIXTURE_INVOICE_TASK_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const TASK_TOMBSTONE_ID = 'bbbbbbbb-0000-4000-8000-000000000003';
const TASK_HIDDEN_ID = 'bbbbbbbb-0000-4000-8000-000000000004';

const ROUTINE_STRETCH_ID = 'cccccccc-0000-4000-8000-000000000001';
const ROUTINE_DELETED_ID = 'cccccccc-0000-4000-8000-000000000002';
export const FIXTURE_ROUTINE_REPORT_ID = 'cccccccc-0000-4000-8000-000000000003';

const GOAL_ID = 'dddddddd-0000-4000-8000-000000000001';
const SEARCH_TASK_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const CREATED_TASK_ID = 'ffffffff-0000-4000-8000-000000000001';

const SECTIONS: McpDaySnapshot['sections'] = [
    { id: SECTION_MORNING, name: 'Morning', start_time: '06:00', end_time: null, order: 0 },
    { id: SECTION_LUNCH, name: 'Lunch', start_time: '12:00', end_time: null, order: 1 },
    { id: SECTION_AFTERNOON, name: 'Afternoon', start_time: '13:00', end_time: null, order: 2 },
    { id: SECTION_EVENING, name: 'Evening', start_time: '18:00', end_time: null, order: 3 },
    { id: SECTION_NIGHT, name: 'Night', start_time: '21:00', end_time: null, order: 4 },
];

type FixtureCall = { method: string; args: unknown[] };

function copySections(): McpDaySnapshot['sections'] {
    return SECTIONS.map((section) => ({ ...section }));
}

function sectionName(sectionId: string | null): string | null {
    if (sectionId === null) {
        return null;
    }
    return SECTIONS.find((section) => section.id === sectionId)?.name ?? null;
}

function daySnapshot(date: string): McpDaySnapshot {
    const tasks: McpDaySnapshot['tasks'] = [
        {
            id: TASK_STRETCH_ID,
            title: '朝のストレッチ',
            status: 'done',
            date,
            scheduled_start: '06:30',
            section_id: SECTION_MORNING,
            estimated_minutes: 30,
            actual_minutes: 32,
            routine_id: ROUTINE_STRETCH_ID,
            order: 1,
            in_scope: true,
        },
        {
            id: FIXTURE_INVOICE_TASK_ID,
            title: '請求書を送る',
            status: 'open',
            date,
            scheduled_start: '10:00',
            section_id: SECTION_MORNING,
            estimated_minutes: 15,
            actual_minutes: 0,
            routine_id: null,
            order: 2,
            in_scope: true,
        },
        {
            id: TASK_TOMBSTONE_ID,
            title: 'deleted occurrence',
            status: 'skipped',
            date,
            scheduled_start: null,
            section_id: SECTION_EVENING,
            estimated_minutes: 30,
            actual_minutes: 0,
            routine_id: ROUTINE_DELETED_ID,
            order: 1,
            in_scope: true,
        },
        {
            id: TASK_HIDDEN_ID,
            title: null,
            status: 'open',
            date,
            scheduled_start: null,
            section_id: null,
            estimated_minutes: 0,
            actual_minutes: 0,
            routine_id: null,
            order: 0,
            in_scope: false,
        },
    ];

    const routines: McpDaySnapshot['routines'] = [
        {
            id: ROUTINE_STRETCH_ID,
            title: '朝のストレッチ',
            frequency: 'daily',
            days_of_week: null,
            interval: null,
            start_date: '2026-01-01',
            next_run: '2026-01-01',
            start_time: '06:30',
            section_id: SECTION_MORNING,
            estimated_minutes: 30,
            in_scope: true,
        },
        {
            id: ROUTINE_DELETED_ID,
            title: 'deleted occurrence',
            frequency: 'daily',
            days_of_week: null,
            interval: null,
            start_date: '2026-01-01',
            next_run: '2026-01-01',
            start_time: null,
            section_id: SECTION_EVENING,
            estimated_minutes: 30,
            in_scope: true,
        },
        {
            id: FIXTURE_ROUTINE_REPORT_ID,
            title: '日報',
            frequency: 'daily',
            days_of_week: null,
            interval: null,
            start_date: '2026-01-01',
            next_run: '2026-01-01',
            start_time: null,
            section_id: SECTION_EVENING,
            estimated_minutes: 30,
            in_scope: true,
        },
    ];

    return {
        tasks,
        tasks_truncated: false,
        goals: [{ id: GOAL_ID, title: '提案書の骨子', status: 'open' }],
        routines,
        sections: copySections(),
    };
}

function searchTask(): McpTaskRow {
    return {
        id: SEARCH_TASK_ID,
        title: 'A社へ請求書を送る',
        status: 'done',
        date: '2026-11-05',
        scheduled_start: null,
        section_id: SECTION_AFTERNOON,
        section: 'Afternoon',
        estimated_minutes: 15,
        actual_minutes: 12,
        routine_id: null,
        completed_at: '2026-11-05T03:00:00+00:00',
    };
}

function invoiceRow(): McpTaskRow {
    return {
        id: FIXTURE_INVOICE_TASK_ID,
        title: '請求書を送る',
        status: 'open',
        date: '2026-11-15',
        scheduled_start: '10:00',
        section_id: SECTION_MORNING,
        section: 'Morning',
        estimated_minutes: 15,
        actual_minutes: 0,
        routine_id: null,
        completed_at: null,
    };
}

export function createFixtureDb(): McpDb & { calls: FixtureCall[] } {
    const calls: FixtureCall[] = [];

    const db: McpDb & { calls: FixtureCall[] } = {
        calls,

        daySnapshot(date: string, argKeys: string[]) {
            calls.push({ method: 'daySnapshot', args: [date, argKeys] });
            return Promise.resolve(daySnapshot(date));
        },

        sectionsForCreate(date: string) {
            calls.push({ method: 'sectionsForCreate', args: [date] });
            return Promise.resolve(copySections());
        },

        search(input: McpSearchInput): Promise<McpSearchResult> {
            calls.push({ method: 'search', args: [input] });
            return Promise.resolve({
                tasks: [searchTask()],
                truncated: false,
                routine_matches: [],
            });
        },

        getTask(id: string) {
            calls.push({ method: 'getTask', args: [id] });
            return Promise.resolve(id === FIXTURE_INVOICE_TASK_ID ? invoiceRow() : null);
        },

        createTask(input: McpCreateInput): Promise<McpCreateResult> {
            calls.push({ method: 'createTask', args: [input] });
            return Promise.resolve({
                ok: true,
                created: true,
                task: {
                    id: CREATED_TASK_ID,
                    title: input.title,
                    status: 'open',
                    date: input.date,
                    scheduled_start: input.scheduledStart,
                    section_id: input.sectionId,
                    section: sectionName(input.sectionId),
                    estimated_minutes: input.estimatedMinutes ?? 15,
                    actual_minutes: 0,
                    routine_id: null,
                    completed_at: null,
                },
            });
        },

        revokeSelf(): Promise<McpRevokeResult> {
            calls.push({ method: 'revokeSelf', args: [] });
            return Promise.resolve({ ok: true });
        },

        logEvent(tool, errorCode) {
            calls.push({ method: 'logEvent', args: [tool, errorCode] });
            return Promise.resolve();
        },
    };

    return db;
}

export function createFixtureContext(scopes: McpScope[] = [...FIXTURE_AUTH.scopes]): {
    ctx: McpContext;
    db: ReturnType<typeof createFixtureDb>;
} {
    const db = createFixtureDb();
    const ctx = buildMcpContext({ ...FIXTURE_AUTH, scopes }, 'fixture-request', db);
    return { ctx, db };
}
