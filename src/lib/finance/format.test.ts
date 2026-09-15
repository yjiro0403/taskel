import { describe, expect, it } from 'vitest';

import { formatSignedYen, formatYen } from './format';

describe('formatYen', () => {
    it('formats JPY with Intl and distinguishes expense from income without relying on color', () => {
        expect(formatYen(20000, 'ja')).toMatch(/20,000/);
        expect(formatYen(20000, 'en')).toMatch(/20,000/);
        expect(formatSignedYen(20000, 'expense', 'ja')).toMatch(/^-/);
        expect(formatSignedYen(10000, 'income', 'en')).toMatch(/^\+/);
        expect(formatSignedYen(20000, 'expense', 'ja')).not.toBe(formatSignedYen(20000, 'income', 'ja'));
    });
});
