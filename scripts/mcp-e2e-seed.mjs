import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

/**
 * Local MCP fixture seed. The loopback guard runs before any client is created.
 * Tokens and passwords are generated at run time and are never printed.
 */

const USER_SECTIONS = [
    { name: 'Morning', startTime: '06:00', order: 0 },
    { name: 'Lunch', startTime: '12:00', order: 1 },
    { name: 'Afternoon', startTime: '13:00', order: 2 },
    { name: 'Evening', startTime: '18:00', order: 3 },
    { name: 'Night', startTime: '21:00', order: 4 },
];

export function assertLoopbackUrl(value, label) {
    let parsed = null;
    try {
        parsed = new URL(value);
    } catch {
        parsed = null;
    }

    const hostOk =
        parsed !== null &&
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');

    if (!hostOk) {
        console.error(`Refusing to run: the ${label} host is not 127.0.0.1 or localhost.`);
        process.exit(2);
    }

    if (label === 'MCP URL' && parsed.pathname !== '/api/mcp') {
        console.error('Refusing to run: the MCP URL path is not /api/mcp.');
        process.exit(2);
    }
}

export function generateToken() {
    const token = `tsk_mcp_${randomBytes(6).toString('base64url')}_${randomBytes(32).toString('base64url')}`;
    const prefix = token.slice(0, 16);
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    if (token.length !== 60 || prefix.length !== 16 || !/^[0-9a-f]{64}$/.test(hash)) {
        throw new Error('generated token has an unexpected shape');
    }
    return { token, prefix, hash };
}

export function todayIn(timeZone) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(formatted);
    if (!match) {
        throw new Error('Could not format today');
    }
    return match[1];
}

export function addDays(dateStr, n) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) {
        throw new Error('Invalid date');
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + n));
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function previousIsoWednesday(today) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
    if (!match) {
        throw new Error('Invalid date');
    }
    const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    return addDays(today, -(daysSinceMonday + 5));
}

function isNotFound(error) {
    if (!error) {
        return false;
    }
    if (error.status === 404 || error.code === 'user_not_found') {
        return true;
    }
    return typeof error.message === 'string' && /not found/i.test(error.message);
}

function randomPassword() {
    return `${randomBytes(18).toString('base64url')}aA1!`;
}

async function deleteUserByEmail(admin, email) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
        throw new Error(`list users: ${error.message}`);
    }
    const existing = (data?.users ?? []).find((user) => user.email === email);
    if (!existing) {
        return;
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
    if (deleteError && !isNotFound(deleteError)) {
        throw new Error(`delete user: ${deleteError.message}`);
    }
}

async function createFixtureUser(admin, email) {
    await deleteUserByEmail(admin, email);
    const password = randomPassword();
    const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (error || !data?.user?.id) {
        throw new Error(`create user: ${error?.message ?? 'no user'}`);
    }
    return { id: data.user.id, email, password };
}

async function insertRow(admin, table, values, step) {
    const { data, error } = await admin.from(table).insert(values).select('id').single();
    if (error) {
        throw new Error(`${step}: ${error.message}`);
    }
    return data.id;
}

async function ensureSections(admin, userId, defs) {
    const { data, error } = await admin.from('sections').select('id, name').eq('user_id', userId);
    if (error) {
        throw new Error(`list sections: ${error.message}`);
    }
    const byName = new Map((data ?? []).map((row) => [row.name, row.id]));
    const ids = {};
    for (const def of defs) {
        const existing = byName.get(def.name);
        if (existing) {
            ids[def.name] = existing;
            continue;
        }
        ids[def.name] = await insertRow(
            admin,
            'sections',
            {
                user_id: userId,
                name: def.name,
                start_time: def.startTime,
                order: def.order,
            },
            `insert section ${def.name}`
        );
    }
    return ids;
}

export async function issueToken(admin, { userId, name, scopes, days, timezone }) {
    const generated = generateToken();
    const { data, error } = await admin.rpc('mcp_issue_token', {
        p_user_id: userId,
        p_name: name,
        p_token_hash: generated.hash,
        p_token_prefix: generated.prefix,
        p_scopes: scopes,
        p_expires_days: days,
        p_timezone: timezone,
    });
    if (error) {
        const failure = new Error(`mcp_issue_token: ${error.message}`);
        failure.code = error.code;
        throw failure;
    }
    let result = data;
    if (typeof result === 'string') {
        try {
            result = JSON.parse(result);
        } catch {
            throw new Error('mcp_issue_token returned unreadable data');
        }
    }
    return { result, token: generated.token, prefix: generated.prefix, hash: generated.hash };
}

export async function seedFixture(admin, { tag, timezone }) {
    const today = todayIn(timezone);
    const lastWeekDate = previousIsoWednesday(today);
    const createdIds = [];

    try {
        const userA = await createFixtureUser(admin, `mcp-e2e-${tag}-a@example.test`);
        createdIds.push(userA.id);
        const userB = await createFixtureUser(admin, `mcp-e2e-${tag}-b@example.test`);
        createdIds.push(userB.id);

        const sections = await ensureSections(admin, userA.id, USER_SECTIONS);
        const bSections = await ensureSections(admin, userB.id, [{ name: 'B-Morning', startTime: '06:00', order: 0 }]);

        const routineDaily = await insertRow(
            admin,
            'routines',
            {
                user_id: userA.id,
                title: '日報',
                frequency: 'daily',
                start_date: '2026-01-01',
                next_run: '2026-01-01',
                section_id: sections.Evening,
                estimated_minutes: 30,
                active: true,
                memo: 'MEMO-MARKER-ROUTINE',
            },
            'insert routine daily'
        );
        const routineSkipped = await insertRow(
            admin,
            'routines',
            {
                user_id: userA.id,
                title: '消したルーチン',
                frequency: 'daily',
                start_date: '2026-01-01',
                next_run: '2026-01-01',
                section_id: sections.Morning,
                estimated_minutes: 10,
                active: true,
            },
            'insert routine skipped'
        );
        const open = await insertRow(
            admin,
            'tasks',
            {
                user_id: userA.id,
                title: '請求書を送る',
                date: today,
                status: 'open',
                section_id: sections.Morning,
                scheduled_start: '10:00',
                estimated_minutes: 15,
                actual_minutes: 0,
                order: 1,
                memo: 'MEMO-MARKER-TASK',
            },
            'insert open task'
        );
        const tombstone = await insertRow(
            admin,
            'tasks',
            {
                user_id: userA.id,
                title: '消したルーチン',
                date: today,
                status: 'skipped',
                section_id: sections.Morning,
                routine_id: routineSkipped,
                estimated_minutes: 10,
                actual_minutes: 0,
                order: 2,
            },
            'insert tombstone'
        );
        const doneLastWeek = await insertRow(
            admin,
            'tasks',
            {
                user_id: userA.id,
                title: '歯医者の予約',
                status: 'done',
                section_id: sections.Afternoon,
                estimated_minutes: 15,
                actual_minutes: 12,
                order: 1,
                date: lastWeekDate,
                completed_at: `${lastWeekDate}T03:00:00Z`,
            },
            'insert done task'
        );
        const project = await insertRow(
            admin,
            'projects',
            {
                owner_id: userA.id,
                title: 'Shared e2e',
            },
            'insert project'
        );

        // project_members has no id column. The owner is not inserted here: a trigger
        // that already added the owner must not be given a second row.
        const { error: memberError } = await admin.from('project_members').insert({
            project_id: project,
            user_id: userB.id,
            role: 'member',
        });
        if (memberError && memberError.code !== '23505') {
            throw new Error(`insert project member: ${memberError.message}`);
        }

        const shared = await insertRow(
            admin,
            'tasks',
            {
                user_id: userA.id,
                title: 'SHARED-MARKER 共有タスク',
                date: today,
                status: 'open',
                section_id: sections.Morning,
                project_id: project,
                estimated_minutes: 60,
                actual_minutes: 0,
                order: 3,
            },
            'insert shared task'
        );
        const bTask = await insertRow(
            admin,
            'tasks',
            {
                user_id: userB.id,
                title: 'B-SECRET 歯医者',
                date: today,
                status: 'open',
                section_id: bSections['B-Morning'],
                estimated_minutes: 15,
                actual_minutes: 0,
                order: 1,
            },
            'insert user B task'
        );

        return {
            timezone,
            today,
            userA,
            userB,
            sections,
            ids: {
                routineDaily,
                routineSkipped,
                open,
                tombstone,
                doneLastWeek,
                project,
                shared,
                bTask,
            },
            lastWeekDate,
        };
    } catch (error) {
        try {
            await deleteFixtureUsers(admin, createdIds);
        } catch {
            // Report the seed failure. Cleanup is best-effort.
        }
        throw error;
    }
}

export async function deleteFixtureUsers(admin, userIds) {
    for (const userId of userIds) {
        if (!userId) {
            continue;
        }
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error && !isNotFound(error)) {
            throw new Error(`delete user: ${error.message}`);
        }
    }
}

function readSupabaseConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const missing = [];
    if (!url) {
        missing.push('NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!anonKey) {
        missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    if (!serviceRoleKey) {
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    if (missing.length > 0) {
        for (const name of missing) {
            console.error(`Missing ${name}`);
        }
        process.exit(2);
    }
    assertLoopbackUrl(url, 'Supabase URL');
    return { url, anonKey, serviceRoleKey };
}

function takeOption(argv, index, name) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        console.error(`Missing value for ${name}`);
        process.exit(2);
    }
    return value;
}

function parseArgs(argv) {
    const args = {
        tokenFile: null,
        loginFile: null,
        timezone: 'Asia/Tokyo',
        tag: 'seed',
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--token-file') {
            args.tokenFile = takeOption(argv, index, '--token-file');
            index += 1;
        } else if (arg === '--login-file') {
            args.loginFile = takeOption(argv, index, '--login-file');
            index += 1;
        } else if (arg === '--timezone') {
            args.timezone = takeOption(argv, index, '--timezone');
            index += 1;
        } else if (arg === '--tag') {
            args.tag = takeOption(argv, index, '--tag');
            index += 1;
        } else {
            console.error('Unknown argument');
            process.exit(2);
        }
    }
    return args;
}

function writeSecretFile(filePath, contents) {
    let stat = null;
    try {
        stat = lstatSync(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    if (stat && !stat.isFile()) {
        console.error('Refusing to write: the path exists and is not a regular file.');
        process.exit(2);
    }

    const tempPath = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tempPath, contents, { mode: 0o600, flag: 'wx' });
    try {
        chmodSync(tempPath, 0o600);
        renameSync(tempPath, filePath);
        chmodSync(filePath, 0o600);
    } catch (error) {
        try {
            unlinkSync(tempPath);
        } catch {
            // The temporary file is removed when the rename can be undone.
        }
        throw error;
    }
}

function safeReason(error) {
    const message = error instanceof Error ? error.message : 'failed';
    return message.replace(/tsk_mcp_[A-Za-z0-9_-]*/g, '[redacted]').replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]');
}

function disconnect(client) {
    if (client?.realtime && typeof client.realtime.disconnect === 'function') {
        client.realtime.disconnect();
    }
}

async function main() {
    const { url, serviceRoleKey } = readSupabaseConfig();
    const args = parseArgs(process.argv.slice(2));
    if (!args.tokenFile) {
        console.error('Missing --token-file');
        process.exit(2);
    }
    if (!/^[a-z0-9-]{1,20}$/.test(args.tag)) {
        console.error('Invalid --tag');
        process.exit(2);
    }
    if (typeof args.timezone !== 'string' || args.timezone.length < 1 || args.timezone.length > 64) {
        console.error('Invalid --timezone');
        process.exit(2);
    }

    const admin = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        const fixture = await seedFixture(admin, { tag: args.tag, timezone: args.timezone });
        let issued;
        try {
            issued = await issueToken(admin, {
                userId: fixture.userA.id,
                name: 'Beacon e2e',
                scopes: ['tasks:read', 'tasks:create'],
                days: 90,
                timezone: args.timezone,
            });
        } catch (error) {
            if (error?.code === 'PGRST202' || error?.code === '42883') {
                console.error('The MCP migration is not applied to this database.');
                process.exit(1);
            }
            throw error;
        }
        if (!issued.result?.ok) {
            console.error(`Token issue failed: ${issued.result?.code ?? 'none'}`);
            process.exit(1);
        }
        if (issued.token.length !== 60) {
            throw new Error('generated token has an unexpected shape');
        }

        writeSecretFile(args.tokenFile, `${issued.token}\n`);
        if (args.loginFile) {
            writeSecretFile(
                args.loginFile,
                `${JSON.stringify({ email: fixture.userA.email, password: fixture.userA.password })}\n`
            );
        }

        console.log(`user A ${fixture.userA.id}`);
        console.log(`user B ${fixture.userB.id}`);
        console.log(`token prefix ${issued.prefix}`);
        console.log(`today ${fixture.today}`);
        console.log(`timezone ${fixture.timezone}`);
        console.log(`token file ${args.tokenFile}`);
        if (args.loginFile) {
            console.log(`login file ${args.loginFile}`);
        }
    } finally {
        disconnect(admin);
    }
    process.exit(0);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    main().catch((error) => {
        console.error(safeReason(error));
        process.exit(1);
    });
}
