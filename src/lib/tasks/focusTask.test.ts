import { describe, expect, it } from 'vitest';

import { isUndatedTask, resolveTaskFocusLocation } from './focusTask';

describe('focusTask', () => {
    it('treats empty / blank dates as undated', () => {
        expect(isUndatedTask({ id: '1', date: '' })).toBe(true);
        expect(isUndatedTask({ id: '1', date: '   ' })).toBe(true);
        expect(isUndatedTask({ id: '1', date: null })).toBe(true);
        expect(isUndatedTask({ id: '1' })).toBe(true);
        expect(isUndatedTask({ id: '1', date: '2026-07-13' })).toBe(false);
    });

    it('opens the day list for dated tasks', () => {
        expect(resolveTaskFocusLocation({ id: 't1', date: '2026-07-13' })).toEqual({
            taskId: 't1',
            date: '2026-07-13',
            openRightSidebar: false,
        });
        expect(resolveTaskFocusLocation({ id: 't2', date: ' 2026-01-01 ' })).toEqual({
            taskId: 't2',
            date: '2026-01-01',
            openRightSidebar: false,
        });
    });

    it('opens the unscheduled sidebar for undated tasks', () => {
        expect(resolveTaskFocusLocation({ id: 'u1', date: '' })).toEqual({
            taskId: 'u1',
            date: null,
            openRightSidebar: true,
        });
    });
});
