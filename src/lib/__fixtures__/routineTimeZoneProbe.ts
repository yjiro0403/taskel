/**
 * Run by routineUtils.timezone.test.ts in a child process with TZ set, because
 * the process time zone cannot be changed reliably inside a running test.
 * Prints the occurrences of a "custom every 7 days" routine across both
 * daylight-saving changes, as the app and the MCP day view compute them.
 */
import { buildDayView } from '@/lib/mcp/dayView';
import type { McpDaySnapshot } from '@/lib/mcp/db';
import { routineOccursOn } from '@/lib/routineUtils';

const PROBE_CASES = [
    { startDate: '2026-03-01', dates: ['2026-03-08', '2026-03-14', '2026-03-15', '2026-03-16', '2026-03-22', '2026-03-23', '2026-07-05'] },
    { startDate: '2026-10-25', dates: ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-07', '2026-11-08', '2026-11-09'] },
] as const;

const ROUTINE_ID = '00000000-0000-4000-8000-000000000001';
const SECTION_ID = '00000000-0000-4000-8000-000000000002';

function snapshot(startDate: string): McpDaySnapshot {
    return {
        tasks: [],
        tasks_truncated: false,
        goals: [],
        routines: [
            {
                id: ROUTINE_ID,
                title: 'Weekly review',
                frequency: 'custom',
                days_of_week: null,
                interval: 7,
                start_date: startDate,
                next_run: startDate,
                start_time: null,
                section_id: SECTION_ID,
                estimated_minutes: 30,
                in_scope: true,
            },
        ],
        sections: [{ id: SECTION_ID, name: 'Morning', start_time: '06:00', end_time: null, order: 0 }],
    } as McpDaySnapshot;
}

const result = {
    marchOffsetMinutes: new Date(2026, 2, 15).getTimezoneOffset(),
    januaryOffsetMinutes: new Date(2026, 0, 15).getTimezoneOffset(),
    cases: PROBE_CASES.map(({ startDate, dates }) => ({
        startDate,
        occurs: Object.fromEntries(
            dates.map((date) => [
                date,
                routineOccursOn({ frequency: 'custom', interval: 7, startDate, nextRun: startDate }, date),
            ])
        ),
        dayView: Object.fromEntries(
            dates.map((date) => [date, buildDayView({ snapshot: snapshot(startDate), date }).tasks.length])
        ),
    })),
};

process.stdout.write(JSON.stringify(result));
