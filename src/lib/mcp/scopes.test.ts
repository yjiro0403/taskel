import { describe, expect, it } from 'vitest';

import { MCP_TOOL_NAMES, MCP_TOOL_SCOPES, canCallTool, isMcpScope, isMcpToolName, toolsForScopes } from './scopes';

const allToolNames = [
    'taskel_whoami',
    'taskel_list_tasks_for_day',
    'taskel_search_tasks',
    'taskel_get_task',
    'taskel_create_task',
    'taskel_revoke_current_token',
] as const;

describe('toolsForScopes', () => {
    it('returns whoami and revoke when the token has no scopes', () => {
        expect(toolsForScopes([])).toEqual(['taskel_whoami', 'taskel_revoke_current_token']);
    });

    it('adds the read tools for tasks:read', () => {
        expect(toolsForScopes(['tasks:read'])).toEqual([
            'taskel_whoami',
            'taskel_list_tasks_for_day',
            'taskel_search_tasks',
            'taskel_get_task',
            'taskel_revoke_current_token',
        ]);
    });

    it('adds the create tool for tasks:create', () => {
        expect(toolsForScopes(['tasks:create'])).toEqual([
            'taskel_whoami',
            'taskel_create_task',
            'taskel_revoke_current_token',
        ]);
    });

    it('returns every tool in MCP_TOOL_NAMES order when both scopes are present', () => {
        expect(toolsForScopes(['tasks:read', 'tasks:create'])).toEqual([...allToolNames]);
        expect([...MCP_TOOL_NAMES]).toEqual([...allToolNames]);
    });
});

describe('canCallTool', () => {
    it('requires tasks:create for create, refuses get with only create, and allows public tools', () => {
        expect(canCallTool(['tasks:create'], 'taskel_create_task')).toBe(true);
        expect(canCallTool(['tasks:read'], 'taskel_create_task')).toBe(false);
        expect(canCallTool(['tasks:create'], 'taskel_get_task')).toBe(false);
        expect(canCallTool([], 'taskel_whoami')).toBe(true);
        expect(canCallTool([], 'taskel_revoke_current_token')).toBe(true);
    });
});

describe('MCP_TOOL_SCOPES', () => {
    it('has exactly the declared tool names', () => {
        expect(Object.keys(MCP_TOOL_SCOPES).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    });

    it('does not name an update, delete, or complete tool', () => {
        for (const name of MCP_TOOL_NAMES) {
            expect(name).not.toContain('update');
            expect(name).not.toContain('delete');
            expect(name).not.toContain('complete');
        }
    });
});

describe('isMcpScope', () => {
    it('accepts the two scopes and rejects other values', () => {
        expect(isMcpScope('tasks:read')).toBe(true);
        expect(isMcpScope('tasks:create')).toBe(true);
        expect(isMcpScope('tasks:delete')).toBe(false);
        expect(isMcpScope('')).toBe(false);
        expect(isMcpScope(42)).toBe(false);
        expect(isMcpScope(null)).toBe(false);
    });
});

describe('isMcpToolName', () => {
    it('accepts a declared tool and rejects an unknown name or a number', () => {
        expect(isMcpToolName('taskel_whoami')).toBe(true);
        expect(isMcpToolName('taskel_delete_task')).toBe(false);
        expect(isMcpToolName(7)).toBe(false);
    });
});
