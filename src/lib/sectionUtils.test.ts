import { describe, expect, it } from 'vitest';

import type { Section } from '@/types';
import { getPersistedSectionForTime } from './sectionUtils';

const sections: Section[] = [
    { id: 'morning', userId: 'user-1', name: 'Morning', startTime: '06:00', order: 0 },
    { id: 'work', userId: 'user-1', name: 'Work', startTime: '09:00', order: 1 },
    { id: 'afternoon', userId: 'user-1', name: 'Afternoon', startTime: '13:00', order: 2 },
    { id: 'evening', userId: 'user-1', name: 'Evening', startTime: '18:00', order: 3 },
];

describe('getPersistedSectionForTime', () => {
    it('21:00をMorningではなくEveningへ分類する', () => {
        expect(getPersistedSectionForTime(sections, '21:00')).toBe('evening');
    });

    it('DBのHH:mm:ss形式でも境界時刻を次のセクションへ分類する', () => {
        const databaseSections = sections.map((section) => ({
            ...section,
            startTime: `${section.startTime}:00`,
        }));

        expect(getPersistedSectionForTime(databaseSections, '09:00')).toBe('work');
        expect(getPersistedSectionForTime(databaseSections, '18:00')).toBe('evening');
    });

    it('セクション間の空白は画面専用intervalのため保存対象にしない', () => {
        const sectionsWithGap: Section[] = [
            { ...sections[0], endTime: '08:00' },
            sections[1],
        ];

        expect(getPersistedSectionForTime(sectionsWithGap, '08:30')).toBeUndefined();
    });
});
