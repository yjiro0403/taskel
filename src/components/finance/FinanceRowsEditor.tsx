'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { FinanceCategory, FinanceDraftRow, FinanceEntryType } from '@/lib/finance/types';
import {
    FINANCE_MAX_CATEGORY_LENGTH,
    FINANCE_MAX_MEMO_LENGTH,
    FINANCE_MAX_ROWS,
} from '@/lib/finance/types';
import { createEmptyFinanceDraft } from '@/lib/finance/mapping';
import { FinanceCategoryCombobox } from './FinanceCategoryCombobox';

interface FinanceRowsEditorProps {
    rows: FinanceDraftRow[];
    categories: FinanceCategory[];
    disabled?: boolean;
    loading?: boolean;
    loadError?: boolean;
    occurrenceDate: string | null;
    onChange: (rows: FinanceDraftRow[]) => void;
    onRetryLoad?: () => void;
}

export function FinanceRowsEditor({
    rows,
    categories,
    disabled = false,
    loading = false,
    loadError = false,
    occurrenceDate,
    onChange,
    onRetryLoad,
}: FinanceRowsEditorProps) {
    const t = useTranslations('Finance');

    const updateRow = (clientId: string, patch: Partial<FinanceDraftRow>) => {
        onChange(rows.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)));
    };

    const addRow = () => {
        if (rows.length >= FINANCE_MAX_ROWS) {
            return;
        }
        onChange([...rows, createEmptyFinanceDraft()]);
    };

    const removeRow = (clientId: string) => {
        onChange(rows.filter((row) => row.clientId !== clientId));
    };

    if (loading || loadError) {
        return (
            <section className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
                <h3 className="text-sm font-medium text-gray-800">{t('sectionTitle')}</h3>
                {loading ? (
                    <p role="status" className="text-sm text-gray-500">{t('loadFinanceLoading')}</p>
                ) : (
                    <div className="space-y-2">
                        <p role="alert" className="text-sm text-red-600 font-medium">{t('loadFinanceFailed')}</p>
                        {onRetryLoad && (
                            <button
                                type="button"
                                onClick={onRetryLoad}
                                className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                {t('loadFinanceRetry')}
                            </button>
                        )}
                    </div>
                )}
            </section>
        );
    }

    if (!occurrenceDate) {
        return (
            <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <h3 className="text-sm font-medium text-gray-800">{t('sectionTitle')}</h3>
                <p className="mt-1 text-xs text-gray-500">{t('needDate')}</p>
            </section>
        );
    }

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
            <div>
                <h3 className="text-sm font-medium text-gray-800">{t('sectionTitle')}</h3>
                <p className="mt-0.5 text-xs text-gray-500">{t('sectionDescription')}</p>
            </div>

            {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('emptyRows')}</p>
            ) : (
                <div className="space-y-3">
                    {rows.map((row, index) => (
                        <FinanceRowCard
                            key={row.clientId}
                            row={row}
                            index={index}
                            categories={categories}
                            disabled={disabled}
                            onChange={(patch) => updateRow(row.clientId, patch)}
                            onRemove={() => removeRow(row.clientId)}
                        />
                    ))}
                </div>
            )}

            <button
                type="button"
                onClick={addRow}
                disabled={disabled || rows.length >= FINANCE_MAX_ROWS}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <Plus size={14} />
                {t('addRow')}
            </button>
        </section>
    );
}

function FinanceRowCard({
    row,
    index,
    categories,
    disabled,
    onChange,
    onRemove,
}: {
    row: FinanceDraftRow;
    index: number;
    categories: FinanceCategory[];
    disabled: boolean;
    onChange: (patch: Partial<FinanceDraftRow>) => void;
    onRemove: () => void;
}) {
    const t = useTranslations('Finance');
    const categoryId = `finance-category-${row.clientId}`;
    const amountId = `finance-amount-${row.clientId}`;
    const memoId = `finance-memo-${row.clientId}`;

    const setType = (entryType: FinanceEntryType) => onChange({ entryType });

    return (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div
                    className="inline-flex bg-gray-100 p-1 rounded-lg"
                    role="group"
                    aria-label={t('entryType')}
                >
                    {(['expense', 'income'] as const).map((entryType) => (
                        <button
                            key={entryType}
                            type="button"
                            aria-pressed={row.entryType === entryType}
                            onClick={() => setType(entryType)}
                            disabled={disabled}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                                row.entryType === entryType
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {entryType === 'expense' ? t('expense') : t('income')}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={onRemove}
                    disabled={disabled}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    aria-label={t('removeRow')}
                >
                    <Trash2 size={14} />
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label htmlFor={categoryId} className="block text-xs font-medium text-gray-600 mb-1">
                        {t('category')}
                    </label>
                    <FinanceCategoryCombobox
                        id={categoryId}
                        value={row.categoryLabel}
                        categories={categories}
                        onChange={(categoryLabel) => onChange({ categoryLabel })}
                        disabled={disabled}
                        maxLength={FINANCE_MAX_CATEGORY_LENGTH}
                    />
                </div>
                <div>
                    <label htmlFor={amountId} className="block text-xs font-medium text-gray-600 mb-1">
                        {t('amount')}
                    </label>
                    <input
                        id={amountId}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={t('amountPlaceholder')}
                        value={row.amountInput}
                        disabled={disabled}
                        maxLength={17}
                        pattern="[0-9,]*"
                        onChange={(event) => onChange({ amountInput: event.target.value })}
                        aria-label={`${t('amount')} ${index + 1}`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400"
                    />
                </div>
            </div>

            <div>
                <label htmlFor={memoId} className="block text-xs font-medium text-gray-600 mb-1">
                    {t('memo')}
                </label>
                <input
                    id={memoId}
                    type="text"
                    value={row.memo}
                    disabled={disabled}
                    maxLength={FINANCE_MAX_MEMO_LENGTH}
                    placeholder={t('memoPlaceholder')}
                    onChange={(event) => onChange({ memo: event.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400"
                />
            </div>
        </div>
    );
}
