import { describe, expect, it } from 'vitest';
import { buildOffsets, visibleRange } from './visibleRange';

describe('visibleRange', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const offsets = buildOffsets(ids, new Map([['b', 40], ['d', 20]]), 10);

    it('builds prefix sums from measured heights and the estimate', () => {
        expect(offsets).toEqual([0, 10, 50, 60, 80, 90]);
    });

    it('returns the items that intersect the viewport plus overscan', () => {
        expect(visibleRange(offsets, 50, 20, 0)).toEqual({ start: 1, end: 4 });
        expect(visibleRange(offsets, 0, 10, 0)).toEqual({ start: 0, end: 2 });
        expect(visibleRange(offsets, 0, 10, 100)).toEqual({ start: 0, end: 5 });
    });
});