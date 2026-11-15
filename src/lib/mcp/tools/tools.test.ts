import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContext, type McpContext } from '@/lib/mcp/auth';
import { McpDbError, type McpAuth, type McpDaySnapshot, type McpDb, type McpTaskRow } from '@/lib/mcp/db';
import type { McpToolResult } from '@/lib/mcp/errors';
import type { McpScope } from '@/lib/mcp/scopes';
import { callTaskelMcpTool } from '@/lib/mcp/serverFactory';

import { mcpCreateRequestHash } from './createTask';
import { MCP_TOOL_MESSAGES } from './shared';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const AUTH: McpAuth = {
    userId: uuid(1),
    tokenId: uuid(2),
    tokenName: 'Beacon',
    tokenPrefix: 'tsk_mcp_AbCdEfGh',
    scopes: ['tasks:read', 'tasks:create'],
    timezone: 'Asia/Tokyo',
    expiresAt: '2027-02-13T01:00:00+00:00',
};

const SECTIONS: McpDaySnapshot['sections'] = [
    { id: uuid(11), name: 'Morning', start_time: '06:00', end_time: null, order: 0 },
    { id: uuid(12), name: 'Lunch', start_time: '12:00', end_time: null, order: 1 },
    { id: uuid(13), name: 'Afternoon', start_time: '13:00', end_time: null, order: 2 },
    { id: uuid(14), name: 'Evening', start_time: '18:00', end_time: null, order: 3 },
    { id: uuid(15), name: 'Night', start_time: '21:00', end_time: null, order: 4 },
];

function row(overrides: Partial<McpTaskRow> = {}): McpTaskRow {
    return {
        id: uuid(100),
        title: 'A社へ請求書を送る',
        status: 'done',
        date: '2026-11-05',
        scheduled_start: null,
        section_id: uuid(13),
        section: 'Afternoon',
        estimated_minutes: 15,
        actual_minutes: 12,
        routine_id: null,
        completed_at: '2026-11-04T16:30:00+00:00',
        ...overrides,
    };
}

function fakeDb() {
    return {
        daySnapshot: vi.fn<McpDb['daySnapshot']>(async () => ({
            tasks: [],
            tasks_truncated: false,
            goals: [],
            routines: [],
            sections: SECTIONS,
        })),
        sectionsForCreate: vi.fn<McpDb['sectionsForCreate']>(async () => SECTIONS),
        search: vi.fn<McpDb['search']>(async () => ({ tasks: [row()], truncated: false, routine_matches: [] })),
        getTask: vi.fn<McpDb['getTask']>(async () => null),
        createTask: vi.fn<McpDb['createTask']>(async (input) => ({
            ok: true as const,
            created: true,
            task: row({
                id: uuid(500),
                title: input.title,
                status: 'open',
                date: input.date,
                scheduled_start: input.scheduledStart,
                section_id: input.sectionId,
                section: SECTIONS.find((section) => section.id === input.sectionId)?.name ?? null,
                estimated_minutes: input.estimatedMinutes ?? 15,
                actual_minutes: 0,
                completed_at: null,
            }),
        })),
        revokeSelf: vi.fn<McpDb['revokeSelf']>(async () => ({ ok: true as const })),
        logEvent: vi.fn<McpDb['logEvent']>(async () => undefined),
    };
}

let db: ReturnType<typeof fakeDb>;
let ctx: McpContext;

function context(overrides: Partial<McpAuth> = {}): McpContext {
    return buildMcpContext({ ...AUTH, ...overrides }, 'req-1', db as unknown as McpDb);
}

function call(name: string, args?: unknown, scopes?: McpScope[]): Promise<McpToolResult> {
    return callTaskelMcpTool(scopes ? context({ scopes }) : ctx, name, args);
}

function data(result: McpToolResult): Record<string, unknown> {
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.ok).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
    return result.structuredContent.data as Record<string, unknown>;
}

function expectFailure(result: McpToolResult, code: keyof typeof MCP_TOOL_MESSAGES) {
    const retryable = code === 'RATE_LIMITED' || code === 'INTERNAL_ERROR';
    expect(result).toEqual({
        isError: true,
        content: [{ type: 'text', text: `[${code}] ${MCP_TOOL_MESSAGES[code]}` }],
        structuredContent: { ok: false, error: { code, message: MCP_TOOL_MESSAGES[code], retryable } },
    });
}

function expectNoDataCall() {
    for (const name of ['daySnapshot', 'sectionsForCreate', 'search', 'getTask', 'createTask', 'revokeSelf'] as const) {
        expect(db[name]).not.toHaveBeenCalled();
    }
}

beforeEach(() => {
    // 00:30 on Sunday 2026-11-15 in Asia/Tokyo; still the 14th in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T15:30:00Z'));
    db = fakeDb();
    ctx = context();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('dispatch', () => {
    it('refuses an unknown tool and records the denial', async () => {
        expectFailure(await call('taskel_delete_task', {}), 'TOOL_UNKNOWN');
        expect(db.logEvent).toHaveBeenCalledWith('taskel_delete_task', 'TOOL_UNKNOWN');
        expectNoDataCall();
    });

    it('does not store a tool name that is not an identifier', async () => {
        expectFailure(await call('drop table; --', {}), 'TOOL_UNKNOWN');
        expect(db.logEvent).toHaveBeenCalledWith(null, 'TOOL_UNKNOWN');
        expectFailure(await callTaskelMcpTool(ctx, 42, {}), 'TOOL_UNKNOWN');
    });

    it.each([
        ['taskel_create_task', { title: 'x' }, ['tasks:read']],
        ['taskel_list_tasks_for_day', {}, ['tasks:create']],
        ['taskel_search_tasks', { query: 'x' }, ['tasks:create']],
        ['taskel_get_task', { id: uuid(100) }, ['tasks:create']],
    ] as const)('refuses %s without its scope, before any data call', async (name, args, scopes) => {
        expectFailure(await call(name, args, [...scopes]), 'SCOPE_FORBIDDEN');
        expect(db.logEvent).toHaveBeenCalledWith(name, 'SCOPE_FORBIDDEN');
        expectNoDataCall();
    });

    it('still answers the denial when the audit row cannot be written', async () => {
        db.logEvent.mockRejectedValue(new Error('audit down'));
        expectFailure(await call('nope', {}), 'TOOL_UNKNOWN');
        expectFailure(await call('taskel_create_task', { title: 'x' }, ['tasks:read']), 'SCOPE_FORBIDDEN');
    });

    it('maps the SQL scope check to SCOPE_FORBIDDEN', async () => {
        db.daySnapshot.mockRejectedValue(new McpDbError('scope_forbidden'));
        expectFailure(await call('taskel_list_tasks_for_day', {}), 'SCOPE_FORBIDDEN');
    });

    it.each([
        new Error('relation "secret_table" does not exist'),
        new McpDbError('internal', { message: 'duplicate key value secret_table' }),
        new McpDbError('token_not_active'),
        new McpDbError('not_ready'),
    ])('answers a thrown error with fixed text only', async (error) => {
        db.search.mockRejectedValue(error);
        const result = await call('taskel_search_tasks', { query: 'x' });
        expectFailure(result, 'INTERNAL_ERROR');
        expect(JSON.stringify(result)).not.toContain('secret_table');
    });

    it('treats missing arguments as an empty object', async () => {
        data(await call('taskel_whoami', undefined));
        data(await call('taskel_list_tasks_for_day', undefined));
    });

    it.each([null, [], 'x', 7])('refuses arguments that are not an object: %j', async (args) => {
        expectFailure(await callTaskelMcpTool(ctx, 'taskel_list_tasks_for_day', args === null ? [] : args), 'INVALID_INPUT');
    });
});

describe('taskel_whoami', () => {
    it('answers from the token alone', async () => {
        expect(data(await call('taskel_whoami', {}))).toEqual({
            token: {
                name: 'Beacon',
                prefix: 'tsk_mcp_AbCdEfGh',
                scopes: ['tasks:read', 'tasks:create'],
                expires_at: '2027-02-13T01:00:00.000Z',
                days_until_expiry: 91,
            },
            timezone: 'Asia/Tokyo',
            today: '2026-11-15',
            server: { name: 'taskel-mcp-server', version: '1.0.0', contract: 1 },
        });
        expectNoDataCall();
        expect(db.logEvent).not.toHaveBeenCalled();
    });

    it('works with any scope and counts the days down to zero', async () => {
        vi.setSystemTime(new Date('2027-02-12T01:00:00Z'));
        expect((data(await call('taskel_whoami', {}, ['tasks:create'])).token as { days_until_expiry: number }).days_until_expiry).toBe(1);
        vi.setSystemTime(new Date('2027-02-13T00:59:00Z'));
        expect((data(await call('taskel_whoami', {})).token as { days_until_expiry: number }).days_until_expiry).toBe(1);
    });

    it('refuses any argument', async () => {
        expectFailure(await call('taskel_whoami', { user_id: uuid(9) }), 'INVALID_INPUT');
    });
});

describe('taskel_list_tasks_for_day', () => {
    it('defaults to today in the token time zone, not the server date', async () => {
        const result = data(await call('taskel_list_tasks_for_day', {}));
        expect(db.daySnapshot).toHaveBeenCalledWith('2026-11-15', []);
        expect(result).toMatchObject({
            date: '2026-11-15',
            weekday: 'Sun',
            timezone: 'Asia/Tokyo',
            today: '2026-11-15',
            tasks: [],
            daily_goals: [],
            hidden_shared_count: 0,
            truncated: false,
        });
    });

    it('uses the time zone of the token', async () => {
        await callTaskelMcpTool(context({ timezone: 'America/Los_Angeles' }), 'taskel_list_tasks_for_day', {});
        expect(db.daySnapshot).toHaveBeenCalledWith('2026-11-14', []);
    });

    it.each([
        [{ day: 'today' }, '2026-11-15', ['day']],
        [{ day: 'tomorrow' }, '2026-11-16', ['day']],
        [{ day: 'yesterday' }, '2026-11-14', ['day']],
        [{ date: '2026-12-31' }, '2026-12-31', ['date']],
    ])('%j reads %s', async (args, date, keys) => {
        expect(data(await call('taskel_list_tasks_for_day', args)).date).toBe(date);
        expect(db.daySnapshot).toHaveBeenCalledWith(date, keys);
    });

    it.each([
        { day: 'today', date: '2026-11-15' },
        { day: '明日' },
        { day: 'next monday' },
        { date: '2026-02-30' },
        { date: '2026-13-01' },
        { date: 'tomorrow' },
        { date: '2026-11-15T00:00:00Z' },
        { date: 20261115 },
        { date: '2026-11-15', user_id: uuid(9) },
        { project_id: uuid(9) },
    ])('refuses %j without reading anything', async (args) => {
        expectFailure(await call('taskel_list_tasks_for_day', args), 'INVALID_INPUT');
        expectNoDataCall();
    });

    it('returns the merged day view of the snapshot', async () => {
        db.daySnapshot.mockResolvedValue({
            tasks: [
                { id: uuid(30), title: '請求書を送る', status: 'open', date: '2026-11-15', scheduled_start: '10:00', section_id: uuid(11), estimated_minutes: 15, actual_minutes: 0, routine_id: null, order: 1, in_scope: true },
                { id: uuid(31), title: null, status: 'open', date: '2026-11-15', scheduled_start: null, section_id: uuid(11), estimated_minutes: 60, actual_minutes: 0, routine_id: null, order: 2, in_scope: false },
            ],
            tasks_truncated: false,
            goals: [{ id: uuid(40), title: '提案書の骨子', status: 'open' }],
            routines: [
                { id: uuid(50), title: '日報', frequency: 'daily', days_of_week: null, interval: null, start_date: '2026-01-01', next_run: '2026-01-01', start_time: null, section_id: uuid(14), estimated_minutes: 30, in_scope: true },
            ],
            sections: SECTIONS,
        });
        const result = data(await call('taskel_list_tasks_for_day', { date: '2026-11-15' }));
        expect((result.tasks as { title: string; is_virtual: boolean }[]).map((item) => [item.title, item.is_virtual])).toEqual([
            ['請求書を送る', false],
            ['日報', true],
        ]);
        expect(result.summary).toMatchObject({ total: 2, open: 2, estimated_minutes_total: 45 });
        expect(result.daily_goals).toEqual([{ id: uuid(40), title: '提案書の骨子', status: 'open' }]);
        expect(result.hidden_shared_count).toBe(1);
        expect(JSON.stringify(result)).not.toMatch(/section_id|routine_id|in_scope|"order"/);
    });
});

describe('taskel_search_tasks', () => {
    const searchInput = () => db.search.mock.calls[0][0];

    it('with only a query: no date bound, undated rows included, defaults applied', async () => {
        const result = data(await call('taskel_search_tasks', { query: '請求書' }));
        expect(searchInput()).toEqual({
            argKeys: ['query'],
            terms: ['請求書'],
            dateFrom: null,
            dateTo: null,
            statuses: ['open', 'in_progress', 'done'],
            includeUndated: true,
            limit: 20,
        });
        expect(result).toMatchObject({ query: '請求書', date_from: null, date_to: null, timezone: 'Asia/Tokyo', today: '2026-11-15', count: 1, truncated: false });
        expect(result.note).toBe('Untouched past routine occurrences are not stored and cannot be found.');
    });

    it('resolves a range in the token time zone and excludes undated rows', async () => {
        const result = data(await call('taskel_search_tasks', { query: '請求書', range: 'last_week' }));
        expect(searchInput()).toMatchObject({ dateFrom: '2026-11-02', dateTo: '2026-11-08', includeUndated: false, argKeys: ['query', 'range'] });
        expect(result).toMatchObject({ date_from: '2026-11-02', date_to: '2026-11-08' });

        db.search.mockClear();
        // The same instant is still Saturday the 14th in Los Angeles.
        await callTaskelMcpTool(context({ timezone: 'America/Los_Angeles' }), 'taskel_search_tasks', { range: 'today' });
        expect(searchInput()).toMatchObject({ dateFrom: '2026-11-14', dateTo: '2026-11-14', terms: [] });
    });

    it('accepts a range or dates without a query', async () => {
        data(await call('taskel_search_tasks', { range: 'this_month' }));
        expect(searchInput()).toMatchObject({ terms: [], dateFrom: '2026-11-01', dateTo: '2026-11-30' });
        db.search.mockClear();
        const result = data(await call('taskel_search_tasks', { date_from: '2026-10-01' }));
        expect(searchInput()).toMatchObject({ dateFrom: '2026-10-01', dateTo: null, includeUndated: false });
        expect(result.query).toBeNull();
    });

    it('passes explicit status, limit and include_undated', async () => {
        await call('taskel_search_tasks', { date_from: '2026-11-01', date_to: '2026-11-30', status: ['done'], limit: 50, include_undated: true });
        expect(searchInput()).toMatchObject({ statuses: ['done'], limit: 50, includeUndated: true, dateFrom: '2026-11-01', dateTo: '2026-11-30' });
    });

    it('splits the query on whitespace, the ideographic space included', async () => {
        await call('taskel_search_tasks', { query: '  請求書　A社\tsend  ' });
        expect(searchInput().terms).toEqual(['請求書', 'A社', 'send']);
    });

    it('accepts a span of exactly 366 days', async () => {
        data(await call('taskel_search_tasks', { date_from: '2025-11-14', date_to: '2026-11-15' }));
    });

    it.each([
        [{}, 'no filter'],
        [{ status: ['done'] }, 'status alone is not a filter'],
        [{ limit: 10, include_undated: true }, 'limit alone is not a filter'],
        [{ query: '' }, 'empty query'],
        [{ query: '   　 ' }, 'query of spaces'],
        [{ query: 'a b c d e f' }, 'six terms'],
        [{ query: 'x'.repeat(51) }, 'a term over 50 chars'],
        [{ query: 'x'.repeat(101) }, 'query over 100 chars'],
        [{ range: 'last_week', date_from: '2026-11-01' }, 'range with date_from'],
        [{ range: 'last_week', date_to: '2026-11-01' }, 'range with date_to'],
        [{ range: 'next_week' }, 'unknown range'],
        [{ range: '先週' }, 'range in free text'],
        [{ date_from: '2026-02-30' }, 'impossible date_from'],
        [{ date_to: '2026-13-01' }, 'impossible date_to'],
        [{ date_from: '2026-11-15', date_to: '2026-11-14' }, 'from after to'],
        [{ date_from: '2025-11-13', date_to: '2026-11-15' }, 'span of 367 days'],
        [{ query: 'x', status: [] }, 'empty status'],
        [{ query: 'x', status: ['skipped'] }, 'status skipped'],
        [{ query: 'x', status: ['done', 'done'] }, 'duplicate status'],
        [{ query: 'x', limit: 0 }, 'limit 0'],
        [{ query: 'x', limit: 51 }, 'limit 51'],
        [{ query: 'x', limit: 1.5 }, 'fractional limit'],
        [{ query: 'x', include_undated: 'yes' }, 'non-boolean flag'],
        [{ query: 'x', user_id: uuid(9) }, 'user_id'],
        [{ query: 'x', project_id: uuid(9) }, 'project_id'],
        [{ query: 'x', memo: 'y' }, 'memo'],
    ])('refuses %j (%s) without searching', async (args, reason) => {
        expect(typeof reason).toBe('string');
        expectFailure(await call('taskel_search_tasks', args), 'INVALID_INPUT');
        expectNoDataCall();
    });

    it('returns contract task items with the completion day in the token time zone', async () => {
        db.search.mockResolvedValue({
            tasks: [row(), row({ id: uuid(101), title: 'open one', status: 'open', date: null, section: null, section_id: null, completed_at: null, routine_id: uuid(77) })],
            truncated: true,
            routine_matches: [{ title: '請求書チェック', frequency: 'weekly', active: true }],
        });
        const result = data(await call('taskel_search_tasks', { query: '請求書' }));
        expect(result.tasks).toEqual([
            { id: uuid(100), title: 'A社へ請求書を送る', status: 'done', date: '2026-11-05', scheduled_start: null, section: 'Afternoon', estimated_minutes: 15, actual_minutes: 12, is_routine: false, is_virtual: false, completed_on: '2026-11-05' },
            { id: uuid(101), title: 'open one', status: 'open', date: null, scheduled_start: null, section: null, estimated_minutes: 15, actual_minutes: 12, is_routine: true, is_virtual: false, completed_on: null },
        ]);
        expect(result).toMatchObject({ count: 2, truncated: true, routine_matches: [{ title: '請求書チェック', frequency: 'weekly', active: true }] });
    });
});

describe('taskel_get_task', () => {
    it('returns the task', async () => {
        db.getTask.mockResolvedValue(row({ status: 'open', completed_at: null }));
        const result = data(await call('taskel_get_task', { id: uuid(100) }));
        expect(db.getTask).toHaveBeenCalledWith(uuid(100));
        expect(result).toEqual({
            task: { id: uuid(100), title: 'A社へ請求書を送る', status: 'open', date: '2026-11-05', scheduled_start: null, section: 'Afternoon', estimated_minutes: 15, actual_minutes: 12, is_routine: false, is_virtual: false, completed_on: null },
        });
    });

    it('answers NOT_FOUND when the database returns nothing', async () => {
        expectFailure(await call('taskel_get_task', { id: uuid(999) }), 'NOT_FOUND');
    });

    it.each([{}, { id: 'not-a-uuid' }, { id: 7 }, { id: uuid(1), user_id: uuid(2) }, { id: `${uuid(1)}' or '1'='1` }])(
        'refuses %j without reading',
        async (args) => {
            expectFailure(await call('taskel_get_task', args), 'INVALID_INPUT');
            expectNoDataCall();
        }
    );
});

describe('taskel_create_task', () => {
    const created = () => db.createTask.mock.calls[0][0];

    it('creates for today with the defaults and a section picked from the current time', async () => {
        // 00:30 local: before the first section, so the next one (Morning).
        const result = data(await call('taskel_create_task', { title: '  牛乳を買う  ' }));
        expect(db.sectionsForCreate).toHaveBeenCalledWith('2026-11-15');
        expect(created()).toEqual({
            idempotencyKey: null,
            requestHash: mcpCreateRequestHash('牛乳を買う', '2026-11-15', null),
            title: '牛乳を買う',
            date: '2026-11-15',
            scheduledStart: null,
            estimatedMinutes: null,
            sectionId: uuid(11),
        });
        expect(result).toEqual({
            created: true,
            task: { id: uuid(500), title: '牛乳を買う', status: 'open', date: '2026-11-15', scheduled_start: null, section: 'Morning', estimated_minutes: 15, actual_minutes: 0, is_routine: false, is_virtual: false },
        });
    });

    it('uses the current local time for an untimed task of today', async () => {
        vi.setSystemTime(new Date('2026-11-15T05:20:00Z')); // 14:20 in Tokyo
        await call('taskel_create_task', { title: 'x' });
        expect(created().sectionId).toBe(uuid(13));
    });

    it('places a timed task in the section that covers the start time', async () => {
        await call('taskel_create_task', { title: '請求書を送る', day: 'today', scheduled_start: '10:00', estimated_minutes: 45, idempotency_key: 'k'.repeat(43) });
        expect(created()).toMatchObject({ scheduledStart: '10:00', sectionId: uuid(11), estimatedMinutes: 45, idempotencyKey: 'k'.repeat(43), date: '2026-11-15' });
    });

    it('places an untimed task of another day in the first section', async () => {
        await call('taskel_create_task', { title: 'x', day: 'tomorrow' });
        expect(created()).toMatchObject({ date: '2026-11-16', sectionId: uuid(11) });
    });

    it('creates without a section when the user has none', async () => {
        db.sectionsForCreate.mockResolvedValue([]);
        const result = data(await call('taskel_create_task', { title: 'x', scheduled_start: '10:00' }));
        expect(created().sectionId).toBeNull();
        expect((result.task as { section: unknown }).section).toBeNull();
    });

    it('hashes title, date and start time, never the estimate', async () => {
        await call('taskel_create_task', { title: 'x', date: '2026-11-20', scheduled_start: '09:00', estimated_minutes: 30 });
        await call('taskel_create_task', { title: 'x', date: '2026-11-20', scheduled_start: '09:00', estimated_minutes: 60 });
        await call('taskel_create_task', { title: 'x', date: '2026-11-20', scheduled_start: '09:30' });
        const [a, b, c] = db.createTask.mock.calls.map(([input]) => input.requestHash);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(b).toBe(a);
        expect(c).not.toBe(a);
        expect(mcpCreateRequestHash('x', '2026-11-20', null)).not.toBe(mcpCreateRequestHash('x', '2026-11-21', null));
    });

    it('accepts the edges of the date window and refuses one day beyond', async () => {
        data(await call('taskel_create_task', { title: 'x', date: '2026-10-15' })); // today - 31
        data(await call('taskel_create_task', { title: 'x', date: '2028-11-15' })); // today + 731
        expect(db.createTask).toHaveBeenCalledTimes(2);
        db.createTask.mockClear();
        db.sectionsForCreate.mockClear();
        expectFailure(await call('taskel_create_task', { title: 'x', date: '2026-10-14' }), 'INVALID_INPUT');
        expectFailure(await call('taskel_create_task', { title: 'x', date: '2028-11-16' }), 'INVALID_INPUT');
        expectNoDataCall();
    });

    it.each([
        [{}, 'no title'],
        [{ title: '' }, 'empty title'],
        [{ title: '   ' }, 'blank title'],
        [{ title: 'あ'.repeat(201) }, 'title over 200'],
        [{ title: 7 }, 'non-string title'],
        [{ title: 'pay\u0000invoice' }, 'NUL in title'],
        [{ title: 'line one\nline two' }, 'newline in title'],
        [{ title: 'tab\there' }, 'tab in title'],
        [{ title: 'esc\u001b[31m' }, 'escape sequence in title'],
        [{ title: 'c1\u0085x' }, 'C1 control in title'],
        [{ title: 'zero​width' }, 'zero-width space in title'],
        [{ title: 'join‍er' }, 'zero-width joiner in title'],
        [{ title: 'bom﻿x' }, 'byte order mark in title'],
        [{ title: 'safe‮txt.exe' }, 'bidi override in title'],
        [{ title: 'iso⁦late⁩' }, 'bidi isolate in title'],
        [{ title: 'mark‏x' }, 'right-to-left mark in title'],
        [{ title: 'x', day: 'yesterday' }, 'day yesterday'],
        [{ title: 'x', day: '明日' }, 'free-text day'],
        [{ title: 'x', day: 'today', date: '2026-11-15' }, 'day and date'],
        [{ title: 'x', date: '2026-02-30' }, 'impossible date'],
        [{ title: 'x', date: 'tomorrow' }, 'word in date'],
        [{ title: 'x', scheduled_start: '24:00' }, 'hour 24'],
        [{ title: 'x', scheduled_start: '9:00' }, 'one-digit hour'],
        [{ title: 'x', scheduled_start: '09:60' }, 'minute 60'],
        [{ title: 'x', scheduled_start: '09:00:00' }, 'seconds'],
        [{ title: 'x', estimated_minutes: -1 }, 'negative estimate'],
        [{ title: 'x', estimated_minutes: 1441 }, 'estimate over a day'],
        [{ title: 'x', estimated_minutes: 1.5 }, 'fractional estimate'],
        [{ title: 'x', estimated_minutes: '15' }, 'string estimate'],
        [{ title: 'x', idempotency_key: 'short' }, 'short key'],
        [{ title: 'x', idempotency_key: 'k'.repeat(65) }, 'long key'],
        [{ title: 'x', idempotency_key: 'has space in the key!' }, 'key with other characters'],
        [{ title: 'x', id: uuid(9) }, 'caller-chosen id'],
        [{ title: 'x', user_id: uuid(9) }, 'user_id'],
        [{ title: 'x', project_id: uuid(9) }, 'project_id'],
        [{ title: 'x', section_id: uuid(11) }, 'section_id'],
        [{ title: 'x', section: 'Morning' }, 'section'],
        [{ title: 'x', status: 'done' }, 'status'],
        [{ title: 'x', memo: 'note' }, 'memo'],
        [{ title: 'x', tags: ['a'] }, 'tags'],
        [{ title: 'x', actual_minutes: 5 }, 'actual_minutes'],
    ])('refuses %j (%s) and writes nothing', async (args, reason) => {
        expect(typeof reason).toBe('string');
        expectFailure(await call('taskel_create_task', args), 'INVALID_INPUT');
        expectNoDataCall();
    });

    it('reports a replay as created:false', async () => {
        db.createTask.mockResolvedValue({ ok: true, created: false, task: row({ status: 'open', completed_at: null }) });
        expect(data(await call('taskel_create_task', { title: 'x', idempotency_key: 'k'.repeat(20) })).created).toBe(false);
    });

    it.each(['CONFLICT', 'RATE_LIMITED', 'INVALID_INPUT'] as const)('maps the database answer %s', async (code) => {
        db.createTask.mockResolvedValue({ ok: false, code });
        expectFailure(await call('taskel_create_task', { title: 'x' }), code);
    });

    it('says the creation limit was reached, and that it can be retried', async () => {
        db.createTask.mockResolvedValue({ ok: false, code: 'RATE_LIMITED' });
        const result = await call('taskel_create_task', { title: 'x' });
        expect(result.structuredContent).toEqual({ ok: false, error: { code: 'RATE_LIMITED', message: 'Task creation limit reached.', retryable: true } });
    });

    it('needs tasks:create only: a create-only token can create', async () => {
        data(await call('taskel_create_task', { title: 'x' }, ['tasks:create']));
        expect(db.daySnapshot).not.toHaveBeenCalled();
    });

    it('does not expose row ids of other tables', async () => {
        const result = await call('taskel_create_task', { title: 'x' });
        expect(JSON.stringify(result)).not.toMatch(/section_id|routine_id|completed_at/);
    });
});

describe('taskel_revoke_current_token', () => {
    it('revokes the presenting token', async () => {
        expect(data(await call('taskel_revoke_current_token', {}))).toEqual({ revoked: true });
        expect(db.revokeSelf).toHaveBeenCalledTimes(1);
        expect(db.revokeSelf).toHaveBeenCalledWith();
    });

    it('works with any scope', async () => {
        expect(data(await call('taskel_revoke_current_token', {}, ['tasks:read']))).toEqual({ revoked: true });
    });

    it('treats a token revoked a moment ago as revoked', async () => {
        db.revokeSelf.mockResolvedValue({ ok: false, code: 'ALREADY_REVOKED' });
        expect(data(await call('taskel_revoke_current_token', {}))).toEqual({ revoked: true });
    });

    it('does not claim success when the token row is gone', async () => {
        db.revokeSelf.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
        expectFailure(await call('taskel_revoke_current_token', {}), 'INTERNAL_ERROR');
    });

    it('cannot be pointed at another token', async () => {
        expectFailure(await call('taskel_revoke_current_token', { token_id: uuid(9) }), 'INVALID_INPUT');
        expect(db.revokeSelf).not.toHaveBeenCalled();
    });
});
