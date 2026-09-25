import { describe, expect, it } from 'vitest';

import type { Section, Task } from '../../types';
import { groupUnscheduledBySection, sortSectionsForDisplay } from './unscheduledGroups';

const sections: Section[] = [
    { id: 'night', userId: 'u1', name: 'Night', startTime: '18:00', endTime: '23:00', order: 2 },
    { id: 'morning', userId: 'u1', name: 'Morning', startTime: '06:00', order: 0 },
    { id: 'work', userId: 'u1', name: 'Work', startTime: '09:00', order: 1 },
    { id: 'interval-1', userId: 'u1', name: 'gap', startTime: '23:00', order: 9 },
];

function task(id: string, sectionId: string, order = 0): Task {
    return { id, userId: 'u1', title: id, sectionId, date: '2026-09-24', status: 'open', estimatedMinutes: 30, actualMinutes: 0, order };
}

describe('sortSectionsForDisplay', () => {
    it('orders by start time and drops synthetic gap sections', () => {
        expect(sortSectionsForDisplay(sections).map((s) => s.id)).toEqual(['morning', 'work', 'night']);
    });
});

describe('groupUnscheduledBySection', () => {
    it('groups tasks under their section in display order and skips empty sections', () => {
        const groups = groupUnscheduledBySection(
            [task('b', 'work', 2), task('a', 'work', 1), task('n', 'night')],
            sections
        );
        expect(groups.map((g) => g.sectionId)).toEqual(['work', 'night']);
        expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
        expect(groups[0].endTime).toBe('18:00');
        expect(groups[1].endTime).toBe('23:00');
    });

    it('lists every section as a slot when includeEmpty is set', () => {
        const groups = groupUnscheduledBySection([task('n', 'night')], sections, { includeEmpty: true });
        expect(groups.map((g) => g.sectionId)).toEqual(['morning', 'work', 'night']);
        expect(groups[0].tasks).toEqual([]);
    });

    it('collects tasks with a missing or unknown section in a trailing group', () => {
        const groups = groupUnscheduledBySection([task('x', ''), task('y', 'gone'), task('m', 'morning')], sections);
        expect(groups.map((g) => g.sectionId)).toEqual(['morning', null]);
        expect(groups[1].tasks.map((t) => t.id)).toEqual(['x', 'y']);
    });

    it('returns no groups for an empty day', () => {
        expect(groupUnscheduledBySection([], sections)).toEqual([]);
    });
});
