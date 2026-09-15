export function formatYen(amount: number, locale: string): string {
    const intlLocale = locale.startsWith('ja') ? 'ja-JP' : 'en-US';
    return new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: 'JPY',
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatSignedYen(amount: number, entryType: 'expense' | 'income', locale: string): string {
    const formatted = formatYen(amount, locale);
    return entryType === 'income' ? `+${formatted}` : `-${formatted}`;
}
