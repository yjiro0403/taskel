import type { McpDaySnapshot } from '@/lib/mcp/db';
import { getPersistedSectionForTime } from '@/lib/sectionUtils';
import type { Section } from '@/types';

/**
 * Picks the section of a task created through MCP.
 *
 * The list view does not render a dated task that has no section, and the
 * hours before the first section are a display-only "interval", so a real
 * section is always chosen when the user has one:
 *
 *   1. a start time is given: the section that covers it;
 *   2. no start time and the task is for today: the section that covers now;
 *   3. that time falls in a gap: the next section to start after it, or, when
 *      none starts later, the section that starts last;
 *   4. no start time and another day: the first section by order;
 *   5. the user has no sections: none.
 */

type SnapshotSection = McpDaySnapshot['sections'][number];

function minutesOf(time: string | null): number {
    if (!time) {
        return 0;
    }
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}

function byOrder(a: SnapshotSection, b: SnapshotSection): number {
    return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function toAppSection(section: SnapshotSection): Section {
    return {
        id: section.id,
        userId: '',
        name: section.name,
        startTime: section.start_time ?? undefined,
        endTime: section.end_time ?? undefined,
        order: section.order,
    };
}

function sectionAt(sections: SnapshotSection[], time: string): string {
    const covering = getPersistedSectionForTime(sections.map(toAppSection), time);
    if (covering) {
        return covering;
    }

    const at = minutesOf(time);
    const byStart = [...sections].sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time) || byOrder(a, b));
    const next = byStart.find((section) => minutesOf(section.start_time) > at);
    return (next ?? byStart[byStart.length - 1]).id;
}

export function chooseSectionId(input: {
    sections: McpDaySnapshot['sections'];
    /** `HH:mm` of the new task, or null. */
    scheduledStart: string | null;
    /** The task's date. */
    date: string;
    /** Today in the token's time zone. */
    today: string;
    /** The current `HH:mm` in the token's time zone. */
    nowTime: string;
}): string | null {
    const { sections } = input;
    if (sections.length === 0) {
        return null;
    }
    if (input.scheduledStart) {
        return sectionAt(sections, input.scheduledStart);
    }
    if (input.date === input.today) {
        return sectionAt(sections, input.nowTime);
    }
    return [...sections].sort(byOrder)[0].id;
}
