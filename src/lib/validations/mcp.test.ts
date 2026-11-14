import { describe, expect, it } from 'vitest';

import {
    mcpCreateTaskSchema,
    mcpGetTaskSchema,
    mcpListTasksForDaySchema,
    mcpNoArgsSchema,
    mcpSearchTasksSchema,
    splitMcpSearchTerms,
} from './mcp';
import { mcpTokenIdSchema, mcpTokenIssueSchema, MCP_TOKEN_ACCESS_SCOPES } from './mcpToken';

const ok = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) => schema.safeParse(value).success;

describe('MCP tool argument schemas', () => {
    it('every schema refuses an unknown key', () => {
        const extra = { user_id: '00000000-0000-4000-8000-000000000001' };
        expect(ok(mcpNoArgsSchema, extra)).toBe(false);
        expect(ok(mcpListTasksForDaySchema, extra)).toBe(false);
        expect(ok(mcpSearchTasksSchema, { query: 'x', ...extra })).toBe(false);
        expect(ok(mcpGetTaskSchema, { id: extra.user_id, ...extra })).toBe(false);
        expect(ok(mcpCreateTaskSchema, { title: 'x', ...extra })).toBe(false);
    });

    it('every schema refuses a value that is not an object', () => {
        for (const schema of [mcpNoArgsSchema, mcpListTasksForDaySchema, mcpSearchTasksSchema, mcpGetTaskSchema, mcpCreateTaskSchema]) {
            for (const value of [null, undefined, 'x', 1, [], true]) {
                expect(ok(schema, value)).toBe(false);
            }
        }
    });

    it('accepts the documented example requests', () => {
        expect(ok(mcpNoArgsSchema, {})).toBe(true);
        expect(ok(mcpListTasksForDaySchema, {})).toBe(true);
        expect(ok(mcpListTasksForDaySchema, { date: '2026-11-15' })).toBe(true);
        expect(ok(mcpSearchTasksSchema, { query: '請求書', range: 'last_week' })).toBe(true);
        expect(ok(mcpGetTaskSchema, { id: '6f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b' })).toBe(true);
        expect(ok(mcpCreateTaskSchema, { title: '請求書を送る', day: 'today', scheduled_start: '10:00', idempotency_key: 'k'.repeat(43) })).toBe(true);
    });

    it('accepts an id without RFC version bits (older rows)', () => {
        expect(ok(mcpGetTaskSchema, { id: '00000000-0000-0000-0000-000000000001' })).toBe(true);
    });

    it('create accepts only today and tomorrow as day words', () => {
        expect(ok(mcpCreateTaskSchema, { title: 'x', day: 'tomorrow' })).toBe(true);
        expect(ok(mcpCreateTaskSchema, { title: 'x', day: 'yesterday' })).toBe(false);
        expect(ok(mcpListTasksForDaySchema, { day: 'yesterday' })).toBe(true);
    });
});

describe('splitMcpSearchTerms', () => {
    it('splits on any whitespace', () => {
        expect(splitMcpSearchTerms('a b')).toEqual(['a', 'b']);
        expect(splitMcpSearchTerms(' 請求書　A社 \n send\t')).toEqual(['請求書', 'A社', 'send']);
    });

    it('allows five terms of fifty characters', () => {
        const term = 'あ'.repeat(50);
        expect(splitMcpSearchTerms([term, 'b', 'c', 'd', 'e'].join(' '))).toHaveLength(5);
    });

    it.each(['', '   ', '　', 'a b c d e f', 'x'.repeat(51)])('refuses %j', (query) => {
        expect(splitMcpSearchTerms(query)).toBeNull();
    });
});

describe('MCP token request schemas', () => {
    const valid = { name: 'Beacon', access: 'read_create', expiresInDays: 90, timezone: 'Asia/Tokyo' };

    it('accepts the dialog defaults', () => {
        expect(mcpTokenIssueSchema.parse(valid)).toEqual(valid);
    });

    it('read access never includes create', () => {
        expect(MCP_TOKEN_ACCESS_SCOPES.read).toEqual(['tasks:read']);
        expect(MCP_TOKEN_ACCESS_SCOPES.read_create).toEqual(['tasks:read', 'tasks:create']);
    });

    it('has no non-expiring choice', () => {
        for (const expiresInDays of [0, -1, 366, 1000, Infinity, null, undefined]) {
            expect(ok(mcpTokenIssueSchema, { ...valid, expiresInDays })).toBe(false);
        }
    });

    it('checks the token id shape', () => {
        expect(ok(mcpTokenIdSchema, '22222222-2222-4222-8222-222222222222')).toBe(true);
        expect(ok(mcpTokenIdSchema, '22222222-2222-4222-8222-22222222222')).toBe(false);
        expect(ok(mcpTokenIdSchema, "x' or 1=1")).toBe(false);
    });
});
