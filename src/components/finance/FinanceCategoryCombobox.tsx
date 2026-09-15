'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { FinanceCategory } from '@/lib/finance/types';
import { FINANCE_MAX_CATEGORY_LENGTH } from '@/lib/finance/types';
import { normalizeCategoryLabel, trimCategoryLabel } from '@/lib/finance/validation';

interface FinanceCategoryComboboxProps {
    id?: string;
    value: string;
    categories: FinanceCategory[];
    onChange: (value: string) => void;
    disabled?: boolean;
    maxLength?: number;
}

export function FinanceCategoryCombobox({
    id,
    value,
    categories,
    onChange,
    disabled = false,
    maxLength = FINANCE_MAX_CATEGORY_LENGTH,
}: FinanceCategoryComboboxProps) {
    const t = useTranslations('Finance');
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const listboxId = `${inputId}-listbox`;
    const inputRef = useRef<HTMLInputElement>(null);
    const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [isComposing, setIsComposing] = useState(false);

    const trimmed = trimCategoryLabel(value);
    const normalizedInput = normalizeCategoryLabel(value);

    const options = useMemo(() => {
        const filtered = categories.filter((category) => {
            if (!normalizedInput) {
                return true;
            }
            return (
                category.normalizedLabel.includes(normalizedInput) ||
                category.label.toLowerCase().includes(value.trim().toLowerCase())
            );
        });
        return filtered.slice(0, 20);
    }, [categories, normalizedInput, value]);

    const exactMatch = categories.some((category) => category.normalizedLabel === normalizedInput);
    const canCreate = trimmed.length > 0 && trimmed.length <= maxLength && !exactMatch;

    const items = useMemo(() => {
        const rows: Array<{ key: string; label: string; value: string }> = options.map(
            (category) => ({
                key: category.id,
                label: category.label,
                value: category.label,
            })
        );
        if (canCreate) {
            rows.unshift({
                key: `create:${normalizedInput}`,
                label: t('categoryCreate', { label: trimmed }),
                value: trimmed,
            });
        }
        return rows;
    }, [canCreate, normalizedInput, options, t, trimmed]);

    const activeIndex = items.length === 0 ? 0 : Math.min(highlightedIndex, items.length - 1);

    useEffect(() => {
        if (open) {
            optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
        }
    }, [activeIndex, open]);

    const selectItem = (itemValue: string) => {
        onChange(itemValue);
        setOpen(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (isComposing) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const wasOpen = open;
            setOpen(true);
            setHighlightedIndex((index) =>
                items.length === 0 ? 0 : wasOpen ? (index + 1) % items.length : 0
            );
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            const wasOpen = open;
            setOpen(true);
            setHighlightedIndex((index) =>
                items.length === 0
                    ? 0
                    : wasOpen
                        ? (index - 1 + items.length) % items.length
                        : items.length - 1
            );
            return;
        }
        if (event.key === 'Enter' && open && items[activeIndex]) {
            event.preventDefault();
            selectItem(items[activeIndex].value);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div className="relative">
            <input
                ref={inputRef}
                id={inputId}
                type="text"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-activedescendant={open && items[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                value={value}
                disabled={disabled}
                maxLength={maxLength}
                autoComplete="off"
                placeholder={t('categoryPlaceholder')}
                onChange={(event) => {
                    onChange(event.target.value);
                    setOpen(true);
                    setHighlightedIndex(0);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => {
                    window.setTimeout(() => setOpen(false), 120);
                }}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-gray-900 placeholder:text-gray-400"
            />
            {open && (
                <ul
                    id={listboxId}
                    role="listbox"
                    className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto"
                >
                    {items.length === 0 ? (
                        <li role="option" aria-selected="false" aria-disabled="true" className="px-3 py-2 text-sm text-gray-500">
                            {t('categoryNoMatches')}
                        </li>
                    ) : (
                        items.map((item, index) => (
                            <li
                                key={item.key}
                                ref={(element) => {
                                    optionRefs.current[index] = element;
                                }}
                                id={`${listboxId}-${index}`}
                                role="option"
                                aria-selected={index === activeIndex}
                            >
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    className={`w-full text-left px-3 py-2 text-sm ${
                                        index === activeIndex
                                            ? 'bg-blue-50 text-blue-800'
                                            : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => selectItem(item.value)}
                                >
                                    {item.label}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}
