import { describe, expect, it } from 'vitest';

import { autoScrollStep } from './autoScroll';

describe('autoScrollStep', () => {
    it('does nothing away from the edges', () => {
        expect(autoScrollStep(300, 0, 600)).toBe(0);
        expect(autoScrollStep(41, 0, 600)).toBe(0);
    });

    it('scrolls up near the top and down near the bottom, faster at the edge', () => {
        expect(autoScrollStep(35, 0, 600)).toBeLessThan(0);
        expect(autoScrollStep(0, 0, 600)).toBe(-14);
        expect(autoScrollStep(570, 0, 600)).toBeGreaterThan(0);
        expect(autoScrollStep(700, 0, 600)).toBe(14);
        expect(Math.abs(autoScrollStep(2, 0, 600))).toBeGreaterThan(Math.abs(autoScrollStep(30, 0, 600)));
    });

    it('ignores containers too small to have edge zones', () => {
        expect(autoScrollStep(5, 0, 70)).toBe(0);
    });
});
