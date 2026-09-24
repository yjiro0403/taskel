export function hoursInputToMinutes(input: string): number | null {
    const trimmed = input.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    const minutes = Math.round(parsed * 60);
    if (minutes > 10_000_000) return null;
    return minutes;
}

export function minutesToHoursInput(minutes: number | null | undefined): string {
    if (minutes == null) return '';
    const hours = minutes / 60;
    if (Number.isInteger(hours)) return String(hours);
    return hours.toFixed(1).replace(/\.0$/, '');
}

export function formatDurationMinutes(totalMinutes: number, locale: string): string {
    const rounded = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    if (locale.startsWith('ja')) {
        if (hours > 0 && minutes > 0) return `${hours}時間${minutes}分`;
        if (hours > 0) return `${hours}時間`;
        return `${minutes}分`;
    }
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
}

export function parseYenInput(input: string): number | null {
    const trimmed = input.trim().replace(/,/g, '');
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000_000) {
        return null;
    }
    return parsed;
}
