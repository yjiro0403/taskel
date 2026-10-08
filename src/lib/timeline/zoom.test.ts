import { describe, expect, it } from 'vitest';

import {
    DAY_ZOOM_LEVELS,
    DEFAULT_DAY_ZOOM_INDEX,
    TOUCH_TARGET_PX,
    anchoredScrollTop,
    blockHeightPx,
    clampZoomIndex,
    readDayZoomIndex,
    zoomIndexForPinch,
    zoomPixelsPerMinute,
} from './zoom';

describe('day timeline zoom', () => {
    it('keeps the historical default scale at index 1', () => {
        expect(zoomPixelsPerMinute(DEFAULT_DAY_ZOOM_INDEX)).toBe(2.4);
        expect(blockHeightPx(5, DEFAULT_DAY_ZOOM_INDEX)).toBe(12);
        expect(blockHeightPx(10, DEFAULT_DAY_ZOOM_INDEX)).toBe(24);
    });

    it('makes a 5-minute block a touch target from the fourth step, and a 2-minute block at the last', () => {
        expect(blockHeightPx(5, 2)).toBe(24);
        expect(blockHeightPx(5, 2)).toBeLessThan(TOUCH_TARGET_PX);
        expect(blockHeightPx(5, 3)).toBe(48);
        expect(blockHeightPx(5, 3)).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
        expect(blockHeightPx(2, DAY_ZOOM_LEVELS.length - 1)).toBe(44);
        expect(blockHeightPx(3, DAY_ZOOM_LEVELS.length - 1)).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    });

    it('clamps the index and ignores garbage', () => {
        expect(clampZoomIndex(-4)).toBe(0);
        expect(clampZoomIndex(99)).toBe(DAY_ZOOM_LEVELS.length - 1);
        expect(clampZoomIndex(Number.NaN)).toBe(DEFAULT_DAY_ZOOM_INDEX);
        expect(zoomPixelsPerMinute(99)).toBe(DAY_ZOOM_LEVELS[DAY_ZOOM_LEVELS.length - 1]);
    });

    it('keeps the top minute fixed when the scale changes', () => {
        expect(anchoredScrollTop({ scrollTop: 0, fromPpm: 2.4, toPpm: 9.6 })).toBe(0);
        expect(anchoredScrollTop({ scrollTop: 120, fromPpm: 2.4, toPpm: 4.8 })).toBeCloseTo(240);
        expect(anchoredScrollTop({ scrollTop: 240, fromPpm: 4.8, toPpm: 2.4 })).toBeCloseTo(120);
    });

    it('leaves scroll alone when the scale is not usable', () => {
        expect(anchoredScrollTop({ scrollTop: 40, fromPpm: 0, toPpm: 9.6 })).toBe(40);
    });

    it('steps one zoom level per 1.5× pinch', () => {
        expect(zoomIndexForPinch(1, 100, 100)).toBe(1);
        expect(zoomIndexForPinch(1, 100, 150)).toBe(2);
        expect(zoomIndexForPinch(1, 100, 225)).toBe(3);
        expect(zoomIndexForPinch(1, 10, 40)).toBe(1);
        expect(zoomIndexForPinch(0, 200, 40)).toBe(0);
    });

    it('reads a stored index and falls back when storage is empty or throws', () => {
        expect(readDayZoomIndex({ getItem: () => '3' })).toBe(3);
        expect(readDayZoomIndex({ getItem: () => null })).toBe(DEFAULT_DAY_ZOOM_INDEX);
        expect(readDayZoomIndex({ getItem: () => 'nope' })).toBe(DEFAULT_DAY_ZOOM_INDEX);
        expect(readDayZoomIndex({
            getItem: () => {
                throw new Error('denied');
            },
        })).toBe(DEFAULT_DAY_ZOOM_INDEX);
    });
});
