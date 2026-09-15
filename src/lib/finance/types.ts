export type FinanceEntryType = 'expense' | 'income';

export interface FinanceCategory {
    id: string;
    userId: string;
    label: string;
    normalizedLabel: string;
    createdAt: string;
    updatedAt: string;
}

export interface FinanceEntry {
    id: string;
    userId: string;
    taskId: string | null;
    taskTitleSnapshot: string;
    occurredOn: string;
    entryType: FinanceEntryType;
    amountYen: number;
    categoryId: string;
    categoryLabelSnapshot: string;
    memo: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface FinanceSummary {
    start: string;
    end: string;
    expenseTotal: number;
    incomeTotal: number;
    expenseCount: number;
    incomeCount: number;
}

export interface FinanceDraftRow {
    clientId: string;
    entryType: FinanceEntryType;
    categoryLabel: string;
    amountInput: string;
    memo: string;
}

export interface FinanceReplacePayloadEntry {
    entry_type: FinanceEntryType;
    category_label: string;
    amount_yen: number;
    memo: string | null;
}

export interface FinanceCategoryGroup {
    label: string;
    total: number;
    count: number;
    entries: FinanceEntry[];
}

export interface FinanceTypeGroup {
    entryType: FinanceEntryType;
    total: number;
    count: number;
    categories: FinanceCategoryGroup[];
}

export const FINANCE_MAX_ROWS = 50;
export const FINANCE_MAX_CATEGORY_LENGTH = 80;
export const FINANCE_MAX_MEMO_LENGTH = 500;
export const FINANCE_MAX_AMOUNT_YEN = 1_000_000_000_000;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
