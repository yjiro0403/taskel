import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
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

/** Paths git lists for these `ls-files` options, or null without git. */
function gitFiles(options: string[]): string[] | null {
    try {
        return execFileSync('git', ['ls-files', '-z', ...options], {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        })
            .split('\0')
            .filter((file) => file.length > 0)
            .map((file) => path.join(repoRoot, file));
    } catch {
        return null;
    }
}

function isRegularFile(file: string): boolean {
    try {
        // A tracked file deleted in the working tree, or a symlink, is not read.
        return lstatSync(file).isFile();
    } catch {
        return false;
    }
}

/**
 * Files a token scan must cover: everything tracked, plus untracked files
 * that are not ignored (they are one `git add` away from a commit). Without
 * git, the whole tree minus build output and dependencies.
 */
function listScannedFiles(): string[] {
    const listed =
        gitFiles(['--cached', '--others', '--exclude-standard']) ??
        walk(repoRoot).filter((file) => !/^android\/(app\/)?build\//.test(relative(file)));
    return [...new Set(listed)].filter(isRegularFile);
}

function walk(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') {
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

    it('scans every tracked file for token literals, not a fixed list of folders', () => {
        const scanned = new Set(listScannedFiles().map(relative));
        expect(scanned.has('README.md')).toBe(true);
        expect(scanned.has('package.json')).toBe(true);
        expect(scanned.has('.github/workflows/ci.yml')).toBe(true);
        expect([...scanned].some((file) => file.startsWith('e2e/'))).toBe(true);
        expect([...scanned].some((file) => file.startsWith('scripts/'))).toBe(true);
        expect([...scanned].some((file) => file.startsWith('node_modules/'))).toBe(false);
    });

    it('does not commit a full MCP token literal', () => {
        const token = /tsk_mcp_[A-Za-z0-9_-]{52}/;
        const hits: string[] = [];
        for (const file of listScannedFiles()) {
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
        expect(hits).toEqual([]);
    });

    it('points every npm script at a script file that is tracked', () => {
        const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        const tracked = gitFiles(['--cached']);
        const isTracked = (target: string) =>
            tracked === null ? isRegularFile(path.join(repoRoot, target)) : tracked.map(relative).includes(target);
        const targets = Object.values(pkg.scripts).flatMap((command) =>
            [...command.matchAll(/(?:^|\s)(scripts\/\S+\.(?:mjs|cjs|js|ts))(?=\s|$)/g)].map((match) => match[1])
        );
        expect(targets).toContain('scripts/mcp-e2e-seed.mjs');
        expect(targets).toContain('scripts/smoke-mcp.mjs');
        expect(targets.filter((target) => !isTracked(target) || !isRegularFile(path.join(repoRoot, target)))).toEqual([]);
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
