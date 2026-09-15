import {
    FINANCE_MAX_AMOUNT_YEN,
    FINANCE_MAX_CATEGORY_LENGTH,
    FINANCE_MAX_MEMO_LENGTH,
    FINANCE_MAX_ROWS,
    type FinanceDraftRow,
    type FinanceReplacePayloadEntry,
} from './types';

export type YenParseFailure = 'empty' | 'invalid' | 'zero' | 'too_large';

export type YenParseResult =
    | { ok: true; value: number }
    | { ok: false; reason: YenParseFailure };

export function normalizeCategoryLabel(raw: string): string {
    return raw
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function trimCategoryLabel(raw: string): string {
    return raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * Accept only a positive integer yen amount.
 * Rejects decimals, exponents, signs, zero, leading zeros, and non-digits.
 * Thousand separators are allowed only as well-formed groups of three digits.
 */
export function parseYenAmount(raw: string | number | null | undefined): YenParseResult {
    if (raw === null || raw === undefined) {
        return { ok: false, reason: 'empty' };
    }

    if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || Object.is(raw, -0)) {
            return { ok: false, reason: 'invalid' };
        }
        if (raw === 0) {
            return { ok: false, reason: 'zero' };
        }
        if (raw < 0) {
            return { ok: false, reason: 'invalid' };
        }
        if (raw > FINANCE_MAX_AMOUNT_YEN) {
            return { ok: false, reason: 'too_large' };
        }
        return { ok: true, value: raw };
    }

    const trimmed = raw.trim();
    if (trimmed === '') {
        return { ok: false, reason: 'empty' };
    }

    if (/[eE.+-]/.test(trimmed)) {
        return { ok: false, reason: 'invalid' };
    }

    let digits = trimmed;
    if (trimmed.includes(',')) {
        if (!/^[1-9]\d{0,2}(,\d{3})+$/.test(trimmed)) {
            return { ok: false, reason: 'invalid' };
        }
        digits = trimmed.replace(/,/g, '');
    }

    if (!/^[1-9][0-9]*$/.test(digits)) {
        if (/^0+$/.test(digits)) {
            return { ok: false, reason: 'zero' };
        }
        return { ok: false, reason: 'invalid' };
    }

    if (digits.length > 15) {
        return { ok: false, reason: 'too_large' };
    }

    const value = Number(digits);
    if (!Number.isSafeInteger(value)) {
        return { ok: false, reason: 'too_large' };
    }
    if (value > FINANCE_MAX_AMOUNT_YEN) {
        return { ok: false, reason: 'too_large' };
    }

    return { ok: true, value };
}

export function isBlankFinanceDraft(row: FinanceDraftRow): boolean {
    return row.categoryLabel.trim() === '' && row.amountInput.trim() === '' && row.memo.trim() === '';
}

export type FinanceRowsValidationFailure =
    | { code: 'too_many'; max: number }
    | { code: 'category'; index: number }
    | { code: 'amount'; index: number; reason: YenParseFailure }
    | { code: 'memo'; index: number };

export type FinanceRowsValidationResult =
    | { ok: true; entries: FinanceReplacePayloadEntry[] }
    | { ok: false; error: FinanceRowsValidationFailure };

export function serializeFinanceDraftRows(rows: FinanceDraftRow[]): FinanceRowsValidationResult {
    const filled = rows.filter((row) => !isBlankFinanceDraft(row));
    if (filled.length > FINANCE_MAX_ROWS) {
        return { ok: false, error: { code: 'too_many', max: FINANCE_MAX_ROWS } };
    }

    const entries: FinanceReplacePayloadEntry[] = [];

    for (let index = 0; index < filled.length; index += 1) {
        const row = filled[index];
        const label = trimCategoryLabel(row.categoryLabel);
        const normalized = normalizeCategoryLabel(row.categoryLabel);
        if (!label || !normalized || label.length > FINANCE_MAX_CATEGORY_LENGTH) {
            return { ok: false, error: { code: 'category', index } };
        }

        const amount = parseYenAmount(row.amountInput);
        if (!amount.ok) {
            return { ok: false, error: { code: 'amount', index, reason: amount.reason } };
        }

        const memo = row.memo.trim();
        if (memo.length > FINANCE_MAX_MEMO_LENGTH) {
            return { ok: false, error: { code: 'memo', index } };
        }

        entries.push({
            entry_type: row.entryType === 'income' ? 'income' : 'expense',
            category_label: label,
            amount_yen: amount.value,
            memo: memo === '' ? null : memo,
        });
    }

    return { ok: true, entries };
}
