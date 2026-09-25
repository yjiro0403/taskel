import { describe, expect, it } from 'vitest';

import type { Section } from '../../types';
import {
    buildTimelineDropUpdate,
    isSameDropTarget,
    isSameWeekTimelineDrag,
    snapDropStart,
    type WeekTimelineDrag,
} from './weekDrag';

const sections: Section[] = [
    { id: 'morning', userId: 'u1', name: 'Morning', startTime: '06:00', order: 0 },
    { id: 'work', userId: 'u1', name: 'Work', startTime: '09:00', order: 1 },
    { id: 'night', userId: 'u1', name: 'Night', startTime: '18:00', endTime: '24:00', order: 2 },
];

describe('snapDropStart', () => {
    it('keeps the grab offset of a scheduled block so it stays under the pointer', () => {
        // Grabbed 20 minutes below the top of a 9:00 block, pointer now at 10:23 on the other day.
        const start = snapDropStart({
            source: 'scheduled',
            pointerMin: 10 * 60 + 23,
            grabOffsetMin: 20,
            axisStartMin: 0,
            axisEndMin: 24 * 60,
            duration: 60,
        });
        expect(start).toBe(10 * 60 + 5);
    });

    it('clamps a scheduled block so it still fits inside the axis', () => {
        const start = snapDropStart({
            source: 'scheduled',
            pointerMin: 23 * 60 + 50,
            grabOffsetMin: 0,
            axisStartMin: 6 * 60,
            axisEndMin: 24 * 60,
            duration: 90,
        });
        expect(start).toBe(22 * 60 + 30);
        expect(
            snapDropStart({ source: 'scheduled', pointerMin: 60, grabOffsetMin: 0, axisStartMin: 6 * 60, axisEndMin: 22 * 60, duration: 30 })
        ).toBe(6 * 60);
    });

    it('places a chip with its top edge at the pointer, snapped to 5 minutes', () => {
        expect(
            snapDropStart({ source: 'unscheduled', pointerMin: 9 * 60 + 58, grabOffsetMin: 45, axisStartMin: 0, axisEndMin: 24 * 60, duration: 120 })
        ).toBe(10 * 60);
        // Only the minimum block has to fit, like the same-day chip drop.
        expect(
            snapDropStart({ source: 'unscheduled', pointerMin: 23 * 60 + 59, grabOffsetMin: 0, axisStartMin: 0, axisEndMin: 24 * 60, duration: 120 })
        ).toBe(23 * 60 + 45);
    });
});

describe('buildTimelineDropUpdate', () => {
    it('moves a block to another day and time and follows the section of the new time', () => {
        const update = buildTimelineDropUpdate({
            source: 'scheduled',
            target: { kind: 'grid', date: '2026-09-24', startMin: 10 * 60 },
            duration: 45,
            sections,
        });
        expect(update).toEqual({
            date: '2026-09-24',
            scheduledStart: '10:00',
            estimatedMinutes: 45,
            sectionId: 'work',
        });
    });

    it('schedules a chip dropped on another day without touching the section when none covers the time', () => {
        const update = buildTimelineDropUpdate({
            source: 'unscheduled',
            target: { kind: 'grid', date: '2026-09-25', startMin: 5 * 60 },
            duration: 15,
            sections: [{ id: 'work', userId: 'u1', name: 'Work', startTime: '09:00', order: 0 }],
        });
        expect(update).toEqual({ date: '2026-09-25', scheduledStart: '05:00', estimatedMinutes: 15 });
        expect('sectionId' in update).toBe(false);
    });

    it('clears the start time when a block is dropped on an unscheduled area', () => {
        const update = buildTimelineDropUpdate({
            source: 'scheduled',
            target: { kind: 'unscheduled', date: '2026-09-24' },
            duration: 60,
            sections,
        });
        expect(update).toEqual({ date: '2026-09-24', scheduledStart: undefined });
        // The key must be present: the store turns an explicit undefined into null.
        expect(Object.prototype.hasOwnProperty.call(update, 'scheduledStart')).toBe(true);
    });

    it('only changes the date when a chip moves between unscheduled areas', () => {
        const update = buildTimelineDropUpdate({
            source: 'unscheduled',
            target: { kind: 'unscheduled', date: '2026-09-25' },
            duration: 15,
            sections,
        });
        expect(update).toEqual({ date: '2026-09-25' });
    });

    it('moves a task into the section group it was dropped on', () => {
        expect(
            buildTimelineDropUpdate({
                source: 'unscheduled',
                target: { kind: 'unscheduled', date: '2026-09-24', sectionId: 'night' },
                duration: 15,
                sections,
            })
        ).toEqual({ date: '2026-09-24', sectionId: 'night' });
        expect(
            buildTimelineDropUpdate({
                source: 'scheduled',
                target: { kind: 'unscheduled', date: '2026-09-24', sectionId: 'morning' },
                duration: 30,
                sections,
            })
        ).toEqual({ date: '2026-09-24', scheduledStart: undefined, sectionId: 'morning' });
    });
});

describe('drag equality', () => {
    const base: WeekTimelineDrag = {
        taskId: 't1',
        title: 'Write report',
        source: 'scheduled',
        fromDate: '2026-09-23',
        duration: 60,
        target: { kind: 'grid', date: '2026-09-24', startMin: 600 },
    };

    it('treats the same target as unchanged so pointer moves do not re-render the week', () => {
        expect(isSameWeekTimelineDrag(base, { ...base, title: 'Write report' })).toBe(true);
        expect(isSameDropTarget({ kind: 'unscheduled', date: 'd' }, { kind: 'unscheduled', date: 'd' })).toBe(true);
        expect(isSameDropTarget({ kind: 'unscheduled', date: 'd', sectionId: null }, { kind: 'unscheduled', date: 'd' })).toBe(true);
        expect(isSameDropTarget({ kind: 'unscheduled', date: 'd', sectionId: 'a' }, { kind: 'unscheduled', date: 'd', sectionId: 'b' })).toBe(false);
    });

    it('detects a new slot, day, kind or task', () => {
        expect(isSameWeekTimelineDrag(base, { ...base, target: { kind: 'grid', date: '2026-09-24', startMin: 605 } })).toBe(false);
        expect(isSameWeekTimelineDrag(base, { ...base, target: { kind: 'grid', date: '2026-09-25', startMin: 600 } })).toBe(false);
        expect(isSameWeekTimelineDrag(base, { ...base, target: { kind: 'unscheduled', date: '2026-09-24' } })).toBe(false);
        expect(isSameWeekTimelineDrag(base, { ...base, taskId: 't2' })).toBe(false);
        expect(isSameWeekTimelineDrag(base, null)).toBe(false);
        expect(isSameWeekTimelineDrag(null, null)).toBe(true);
    });
});
