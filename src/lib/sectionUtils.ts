import { Section } from '@/types';
import { format } from 'date-fns';

export const INTERVAL_SECTION_PREFIX = 'interval-';

export function isIntervalSection(sectionId: string) {
    return sectionId.startsWith(INTERVAL_SECTION_PREFIX);
}

const toMinutes = (timeStr?: string) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

const fromMinutes = (totalMinutes: number) => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function generateDisplaySections(sections: Section[]): Section[] {
    const sorted = [...sections].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || a.order - b.order);
    const displaySections: Section[] = [];
    let currentMinutes = 0;

    for (let i = 0; i < sorted.length; i++) {
        const section = sorted[i];
        const startMins = toMinutes(section.startTime);

        // Gap before? (Including from 00:00)
        if (currentMinutes < startMins) {
            const startStr = fromMinutes(currentMinutes);
            const endStr = section.startTime!;
            displaySections.push({
                id: `${INTERVAL_SECTION_PREFIX}${startStr}`,
                userId: section.userId,
                name: 'Interval',
                startTime: startStr,
                endTime: endStr,
                order: -1 // Virtual order
            });
        }

        displaySections.push(section);

        // If section has explicit end, update currentMinutes
        // If not, it extends to next section
        if (section.endTime) {
            currentMinutes = toMinutes(section.endTime);
        } else if (i < sorted.length - 1) {
            currentMinutes = toMinutes(sorted[i + 1].startTime);
        } else {
            currentMinutes = 24 * 60; // Last section covers rest of day
        }
    }

    // Gap after last? (Optional, usually covered by last section logic above)
    if (currentMinutes < 24 * 60) {
        const startStr = fromMinutes(currentMinutes);
        displaySections.push({
            id: `${INTERVAL_SECTION_PREFIX}${startStr}`,
            userId: 'system',
            name: 'Interval',
            startTime: startStr,
            endTime: '24:00',
            order: -1
        });
    }

    return displaySections;
}

export function getSectionForTime(sections: Section[], time: Date | string): string {
    const timeStr = typeof time === 'string' ? time : format(time, 'HH:mm');
    const displaySections = generateDisplaySections(sections);

    // Find section that covers this time
    for (let i = 0; i < displaySections.length; i++) {
        const section = displaySections[i];
        const start = section.startTime || '00:00';
        const end = section.endTime || (i < displaySections.length - 1 ? displaySections[i + 1].startTime : '24:00');

        if (timeStr >= start && timeStr < (end === '24:00' ? '24:01' : end!)) {
            return section.id;
        }
    }

    return displaySections[displaySections.length - 1]?.id || '';
}
