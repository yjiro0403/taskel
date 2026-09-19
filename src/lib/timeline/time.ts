import type { Section } from '../../types';
import { isIntervalSection } from '../sectionUtils';

export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_VISIBLE_START_MIN = 6 * 60;
export const DEFAULT_VISIBLE_END_MIN = 22 * 60;
export const SNAP_MINUTES = 5;
export const MIN_BLOCK_MINUTES = 15;

const HHMM_RE = /^(\d{1,2}):(\d{2})/;

export function hhmmToMinutes(value: string | undefined | null): number | null {
    if (!value) return null;
    const match = HHMM_RE.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours === 24 && minutes === 0) return MINUTES_PER_DAY;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

export function minutesToHHMM(total: number): string {
    const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(total)));
    if (clamped >= MINUTES_PER_DAY) return '24:00';
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function snapMinutes(value: number, step = SNAP_MINUTES): number {
    if (step <= 0) return Math.round(value);
    return Math.round(value / step) * step;
}

export function clampMinutes(value: number, start: number, end: number): number {
    return Math.max(start, Math.min(end, value));
}

export function sectionStartMinutes(section: Section): number | null {
    return hhmmToMinutes(section.startTime);
}

export function sectionEndMinutes(section: Section, fallback = MINUTES_PER_DAY): number {
    return hhmmToMinutes(section.endTime) ?? fallback;
}

export function computeVisibleRange(input: {
    sections: Section[];
    scheduledStarts: number[];
    hideEmptyIntervals: boolean;
}): { startMin: number; endMin: number } {
    const userSections = input.sections.filter((section) => !isIntervalSection(section.id));
    const userStarts = userSections
        .map((section) => sectionStartMinutes(section))
        .filter((value): value is number => value != null);
    const userEnds = userSections.map((section, index) => {
        const next = userSections[index + 1];
        const fallback = next ? (sectionStartMinutes(next) ?? MINUTES_PER_DAY) : MINUTES_PER_DAY;
        return sectionEndMinutes(section, fallback);
    });

    if (!input.hideEmptyIntervals) {
        return { startMin: 0, endMin: MINUTES_PER_DAY };
    }

    const candidatesStart = [...userStarts, ...input.scheduledStarts];
    const candidatesEnd = [...userEnds, ...input.scheduledStarts.map((start) => start + MIN_BLOCK_MINUTES)];

    if (candidatesStart.length === 0) {
        return { startMin: DEFAULT_VISIBLE_START_MIN, endMin: DEFAULT_VISIBLE_END_MIN };
    }

    const startMin = Math.max(0, Math.min(...candidatesStart));
    const endMin = Math.min(MINUTES_PER_DAY, Math.max(...candidatesEnd, startMin + 60));
    return { startMin, endMin };
}
