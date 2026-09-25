import type { Section, Task } from '../../types';
import { isIntervalSection } from '../sectionUtils';
import { hhmmToMinutes } from './time';

export interface UnscheduledGroup {
    /** null: tasks whose section is empty or unknown. */
    sectionId: string | null;
    name: string;
    startTime?: string;
    endTime?: string;
    tasks: Task[];
}

/** User sections in display order (by start time, then order), without the synthetic gaps. */
export function sortSectionsForDisplay(sections: Section[]): Section[] {
    return sections
        .filter((section) => !isIntervalSection(section.id))
        .sort(
            (a, b) =>
                (hhmmToMinutes(a.startTime) ?? 0) - (hhmmToMinutes(b.startTime) ?? 0) || a.order - b.order
        );
}

function byOrder(list: Task[]): Task[] {
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
}

/**
 * Group the no-start-time tasks of a day by section so they can be read and
 * dropped per section. Sections without tasks are left out unless
 * `includeEmpty` is set (drop slots while dragging). Tasks with no valid
 * section come last in a group with `sectionId: null`.
 */
export function groupUnscheduledBySection(
    tasks: Task[],
    sections: Section[],
    options: { includeEmpty?: boolean } = {}
): UnscheduledGroup[] {
    const ordered = sortSectionsForDisplay(sections);
    const buckets = new Map<string, Task[]>();
    ordered.forEach((section) => buckets.set(section.id, []));
    const other: Task[] = [];

    for (const task of tasks) {
        const bucket = task.sectionId ? buckets.get(task.sectionId) : undefined;
        (bucket ?? other).push(task);
    }

    const groups: UnscheduledGroup[] = [];
    ordered.forEach((section, index) => {
        const bucket = buckets.get(section.id) ?? [];
        if (bucket.length === 0 && !options.includeEmpty) return;
        const next = ordered[index + 1];
        groups.push({
            sectionId: section.id,
            name: section.name,
            startTime: section.startTime,
            endTime: section.endTime || next?.startTime || (section.startTime ? '24:00' : undefined),
            tasks: byOrder(bucket),
        });
    });
    if (other.length > 0) {
        groups.push({ sectionId: null, name: '', tasks: byOrder(other) });
    }
    return groups;
}
