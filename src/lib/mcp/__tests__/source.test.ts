import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MCP_TOOL_NAMES } from '@/lib/mcp/scopes';
import { MCP_TOOLS } from '@/lib/mcp/tools';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const contractPath = path.join(repoRoot, 'contracts/taskel-mcp.v1.json');

const BINARY_EXT = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.otf',
    '.webp',
    '.avif',
    '.pdf',
    '.zip',
    '.gz',
    '.jar',
    '.mp4',
    '.mp3',
    '.webm',
    '.wasm',
    '.icns',
    '.bmp',
]);

const FORBIDDEN_INPUT_KEYS = [
    'user',
    'user_id',
    'userId',
    'project',
    'project_id',
    'projectId',
    'section',
    'section_id',
    'sectionId',
];

const FORBIDDEN_CONTRACT_KEYS = ['memo', 'checklist', 'tags', 'project_id', 'user_id', 'section_id', 'routine_id'];

type InputSchema = {
    properties: Record<string, unknown>;
    additionalProperties: boolean;
};

function walk(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(full));
        } else if (entry.isFile()) {
            files.push(full);
        }
    }
    return files;
}

function relative(file: string): string {
    return path.relative(repoRoot, file).split(path.sep).join('/');
}

function isSourceFile(file: string): boolean {
    const ext = path.extname(file);
    if (ext !== '.ts' && ext !== '.tsx') {
        return false;
    }
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
        return false;
    }
    return !file.split(path.sep).includes('__tests__');
}

function sourceFilesUnder(dir: string): string[] {
    return walk(dir).filter(isSourceFile);
}

function assertInputShape(name: string, schema: InputSchema) {
    const keys = Object.keys(schema.properties);
    for (const key of FORBIDDEN_INPUT_KEYS) {
        expect(keys).not.toContain(key);
    }
    if (name === 'taskel_create_task') {
        expect(keys).not.toContain('status');
        expect(keys).toEqual(['title', 'day', 'date', 'scheduled_start', 'estimated_minutes', 'idempotency_key']);
    }
    if (name === 'taskel_get_task') {
        expect(keys).toContain('id');
    } else {
        expect(keys).not.toContain('id');
    }
    expect(schema.additionalProperties).toBe(false);
}

function collectKeys(value: unknown, found: string[]) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectKeys(item, found);
        }
        return;
    }
    if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (FORBIDDEN_CONTRACT_KEYS.includes(key)) {
                found.push(key);
            }
            collectKeys(child, found);
        }
    }
}

describe('MCP source requirements', () => {
    it('keeps the service-role client inside src/lib/mcp/db.ts', () => {
        const roots = [path.join(repoRoot, 'src/lib/mcp'), path.join(repoRoot, 'src/app/api/mcp')];
        const sources = roots.flatMap((dir) => sourceFilesUnder(dir));
        const adminImport = /from\s+['"]@\/lib\/supabase\/admin['"]/;
        const importers: string[] = [];
        const otherAdminClients: string[] = [];

        for (const file of sources) {
            const text = readFileSync(file, 'utf8');
            const name = relative(file);
            if (adminImport.test(text)) {
                importers.push(name);
            }
            if (name !== 'src/lib/mcp/db.ts' && /\bcreateAdminClient\b/.test(text)) {
                otherAdminClients.push(name);
            }
        }

        expect(importers).toEqual(['src/lib/mcp/db.ts']);
        expect(otherAdminClients).toEqual([]);
    });

    it('calls SQL functions and does not query tables from db.ts', () => {
        const text = readFileSync(path.join(repoRoot, 'src/lib/mcp/db.ts'), 'utf8');
        expect(text).toContain('.rpc(');
        expect(text).not.toContain('.from(');
    });

    it('does not import Supabase from the tool handlers', () => {
        const files = sourceFilesUnder(path.join(repoRoot, 'src/lib/mcp/tools'));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            expect(text).not.toMatch(/from\s+['"]@\/lib\/supabase/);
            expect(text).not.toContain('@supabase/supabase-js');
        }
    });

    it('does not read cookies or next/headers in the MCP route', () => {
        const text = readFileSync(path.join(repoRoot, 'src/app/api/mcp/route.ts'), 'utf8');
        expect(text).not.toContain('next/headers');
        expect(text).not.toContain('cookies(');
    });

    it('keeps caller-controlled owner, project, section, and status out of tool inputs', () => {
        const parsed = JSON.parse(readFileSync(contractPath, 'utf8')) as {
            tools: { name: string; inputSchema: InputSchema }[];
        };
        expect(parsed.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);

        for (const tool of parsed.tools) {
            assertInputShape(tool.name, tool.inputSchema);
            const live = MCP_TOOLS[tool.name as (typeof MCP_TOOL_NAMES)[number]].definition.inputSchema;
            assertInputShape(tool.name, live);
            expect(tool.inputSchema).toEqual(live);
        }
    });

    it('does not hand the browser session to the settings page', () => {
        const page = readFileSync(path.join(repoRoot, 'src/app/[locale]/settings/integrations/page.tsx'), 'utf8');
        expect(page).not.toContain('refresh_token');
        expect(page).not.toContain('access_token');
        expect(page).not.toContain('NEXT_PUBLIC_FIREBASE');
    });

    it('does not commit a full MCP token literal', () => {
        const token = /tsk_mcp_[A-Za-z0-9_-]{52}/;
        const hits: string[] = [];
        for (const root of ['src', 'contracts', 'scripts', 'docs', 'supabase']) {
            for (const file of walk(path.join(repoRoot, root))) {
                if (BINARY_EXT.has(path.extname(file).toLowerCase())) {
                    continue;
                }
                const bytes = readFileSync(file);
                if (bytes.includes(0)) {
                    continue;
                }
                if (token.test(bytes.toString('utf8'))) {
                    hits.push(relative(file));
                }
            }
        }
        expect(hits).toEqual([]);
    });

    it('does not leak memo, checklist, tags, or project_id in the contract', () => {
        const text = readFileSync(contractPath, 'utf8');
        expect(text).not.toContain('"memo"');
        expect(text).not.toContain('"checklist"');
        expect(text).not.toContain('"tags"');
        expect(text).not.toContain('"project_id"');
        const found: string[] = [];
        collectKeys(JSON.parse(text), found);
        expect(found).toEqual([]);
    });
});
