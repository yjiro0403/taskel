import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { routineOccursOn } from './routineUtils';

/**
 * A "custom every N days" routine must land on the same calendar days in
 * every process time zone: the app runs routineOccursOn in the browser's zone,
 * the MCP day view in the server's. The zone-sensitive runs happen in a child
 * process, because TZ cannot be changed reliably inside a running test.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TSX_CLI = path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs');
const PROBE = path.join(repoRoot, 'src/lib/__fixtures__/routineTimeZoneProbe.ts');

// Every 7 days from 2026-03-01 (US spring-forward is 03-08) and from
// 2026-10-25 (US fall-back is 11-01).
const EXPECTED = [
    {
        startDate: '2026-03-01',
        occurs: {
            '2026-03-08': true,
            '2026-03-14': false,
            '2026-03-15': true,
            '2026-03-16': false,
            '2026-03-22': true,
            '2026-03-23': false,
            '2026-07-05': true,
        },
    },
    {
        startDate: '2026-10-25',
        occurs: {
            '2026-10-31': false,
            '2026-11-01': true,
            '2026-11-02': false,
            '2026-11-07': false,
            '2026-11-08': true,
            '2026-11-09': false,
        },
    },
];

type ProbeResult = {
    marchOffsetMinutes: number;
    januaryOffsetMinutes: number;
    cases: { startDate: string; occurs: Record<string, boolean>; dayView: Record<string, number> }[];
};

function runProbe(timeZone: string): ProbeResult {
    const child = spawnSync(process.execPath, [TSX_CLI, PROBE], {
        cwd: repoRoot,
        env: { ...process.env, TZ: timeZone },
        encoding: 'utf8',
        timeout: 60_000,
    });
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout) as ProbeResult;
}

describe('routineOccursOn for custom intervals across daylight-saving changes', () => {
    it('counts calendar days in this process', () => {
        for (const { startDate, occurs } of EXPECTED) {
            for (const [date, expected] of Object.entries(occurs)) {
                expect(
                    routineOccursOn({ frequency: 'custom', interval: 7, startDate, nextRun: startDate }, date),
                    `${startDate} -> ${date}`
                ).toBe(expected);
            }
        }
    });

    it.each([
        ['America/New_York', 240, 300],
        ['Europe/London', 0, 0],
        ['UTC', 0, 0],
        ['Asia/Tokyo', -540, -540],
    ])('gives the same days in %s, for the app and the MCP day view', (timeZone, marchOffset, januaryOffset) => {
        const result = runProbe(timeZone);
        // The child really ran in that zone (New York is already on DST on 03-15).
        expect(result.marchOffsetMinutes).toBe(marchOffset);
        expect(result.januaryOffsetMinutes).toBe(januaryOffset);
        expect(result.cases.map(({ startDate, occurs }) => ({ startDate, occurs }))).toEqual(EXPECTED);
        for (const { startDate, occurs, dayView } of result.cases) {
            for (const [date, expected] of Object.entries(occurs)) {
                expect(dayView[date], `day view ${startDate} -> ${date}`).toBe(expected ? 1 : 0);
            }
        }
    }, 120_000);
});
