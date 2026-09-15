import { describe, expect, it } from 'vitest';

import { FINANCE_MAX_ROWS, type FinanceDraftRow } from './types';
import {
    isBlankFinanceDraft,
    normalizeCategoryLabel,
    parseYenAmount,
    serializeFinanceDraftRows,
    trimCategoryLabel,
} from './validation';

function draft(overrides: Partial<FinanceDraftRow> = {}): FinanceDraftRow {
    return {
        clientId: 'row-1',
        entryType: 'expense',
        categoryLabel: '食費',
        amountInput: '20000',
        memo: '',
        ...overrides,
    };
}

describe('normalizeCategoryLabel', () => {
    it('trims, collapses whitespace, NFKC-normalizes, and lowercases', () => {
        expect(normalizeCategoryLabel('  Ｆｏｏ   BAR  ')).toBe('foo bar');
        expect(trimCategoryLabel('  Ｆｏｏ   BAR  ')).toBe('Foo BAR');
    });
});

describe('parseYenAmount', () => {
    it('accepts positive integers and well-formed thousand separators', () => {
        expect(parseYenAmount('20000')).toEqual({ ok: true, value: 20000 });
        expect(parseYenAmount('20,000')).toEqual({ ok: true, value: 20000 });
        expect(parseYenAmount(1)).toEqual({ ok: true, value: 1 });
    });

    it('rejects empty, zero, decimals, exponents, signs, and leading zeros', () => {
        expect(parseYenAmount('')).toEqual({ ok: false, reason: 'empty' });
        expect(parseYenAmount('   ')).toEqual({ ok: false, reason: 'empty' });
        expect(parseYenAmount('0')).toEqual({ ok: false, reason: 'zero' });
        expect(parseYenAmount(0)).toEqual({ ok: false, reason: 'zero' });
        expect(parseYenAmount('0.5')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('1.0')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('1e3')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('1E3')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('-1')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('+1')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('01')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount(1.5)).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount(-20)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects malformed comma grouping and oversized values', () => {
        expect(parseYenAmount('20,00')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('1,0000')).toEqual({ ok: false, reason: 'invalid' });
        expect(parseYenAmount('1000000000001')).toEqual({ ok: false, reason: 'too_large' });
    });
});

describe('serializeFinanceDraftRows', () => {
    it('skips blank rows and serializes mixed expense/income', () => {
        const result = serializeFinanceDraftRows([
            draft(),
            draft({
                clientId: 'blank',
                categoryLabel: '',
                amountInput: '',
                memo: '   ',
            }),
            draft({
                clientId: 'income',
                entryType: 'income',
                categoryLabel: '  給与  ',
                amountInput: '10,000',
                memo: 'bonus',
            }),
        ]);

        expect(result).toEqual({
            ok: true,
            entries: [
                {
                    entry_type: 'expense',
                    category_label: '食費',
                    amount_yen: 20000,
                    memo: null,
                },
                {
                    entry_type: 'income',
                    category_label: '給与',
                    amount_yen: 10000,
                    memo: 'bonus',
                },
            ],
        });
    });

    it('fails on invalid category, amount, or too many rows', () => {
        expect(serializeFinanceDraftRows([draft({ categoryLabel: '   ' })])).toMatchObject({
            ok: false,
            error: { code: 'category' },
        });
        expect(serializeFinanceDraftRows([draft({ amountInput: '0' })])).toMatchObject({
            ok: false,
            error: { code: 'amount', reason: 'zero' },
        });

        const tooMany = Array.from({ length: FINANCE_MAX_ROWS + 1 }, (_, index) =>
            draft({ clientId: `row-${index}` })
        );
        expect(serializeFinanceDraftRows(tooMany)).toEqual({
            ok: false,
            error: { code: 'too_many', max: FINANCE_MAX_ROWS },
        });
    });

    it('treats whitespace-only drafts as blank', () => {
        expect(isBlankFinanceDraft(draft({ categoryLabel: ' ', amountInput: '', memo: '' }))).toBe(true);
        expect(isBlankFinanceDraft(draft({ categoryLabel: '', amountInput: '', memo: '' }))).toBe(true);
    });
});
