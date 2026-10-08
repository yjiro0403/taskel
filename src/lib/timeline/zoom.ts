/**
 * Vertical scale of the day timeline.
 *
 * Index 1 is the historical default (2.4px per minute: 5 minutes is 12px).
 * The day view keeps that length. Zooming in lengthens the axis so a short
 * block grows tall enough to tap. Index 3 is 9.6px/min, so 5 minutes is 48px.
 * Index 5 is 22px/min, so 2 minutes is 44px.
 */
export const DAY_ZOOM_LEVELS = [1.2, 2.4, 4.8, 9.6, 14.4, 22] as const;

export const DEFAULT_DAY_ZOOM_INDEX = 1;

export const DEFAULT_DAY_PIXELS_PER_MINUTE = DAY_ZOOM_LEVELS[DEFAULT_DAY_ZOOM_INDEX];

/** A block at least this tall can hold a play / copy control. Shorter blocks open an action sheet. */
export const TOUCH_TARGET_PX = 44;

export const DAY_ZOOM_STORAGE_KEY = 'taskel.timeline.dayZoomIndex';

export function clampZoomIndex(index: number): number {
    if (!Number.isFinite(index)) return DEFAULT_DAY_ZOOM_INDEX;
    return Math.max(0, Math.min(DAY_ZOOM_LEVELS.length - 1, Math.round(index)));
}

export function zoomPixelsPerMinute(index: number): number {
    return DAY_ZOOM_LEVELS[clampZoomIndex(index)] ?? DEFAULT_DAY_PIXELS_PER_MINUTE;
}

export function blockHeightPx(minutes: number, zoomIndex: number): number {
    return minutes * zoomPixelsPerMinute(zoomIndex);
}

/** One zoom step per 1.5× change in pinch distance. A tiny span is not a pinch. */
export function zoomIndexForPinch(startIndex: number, startDistance: number, distance: number): number {
    if (!(startDistance >= 24) || !(distance > 0)) return clampZoomIndex(startIndex);
    const steps = Math.round(Math.log(distance / startDistance) / Math.log(1.5));
    return clampZoomIndex(startIndex + steps);
}

/**
 * Keep the minute at the top of the viewport fixed while the scale changes.
 * Zooming in from the top of the day stays on that morning instead of jumping
 * to whatever sat in the middle of the box. The caller clamps the result.
 */
export function anchoredScrollTop(input: {
    scrollTop: number;
    fromPpm: number;
    toPpm: number;
}): number {
    if (!(input.fromPpm > 0) || !(input.toPpm > 0)) return input.scrollTop;
    return input.scrollTop * (input.toPpm / input.fromPpm);
}

export function readDayZoomIndex(storage: Pick<Storage, 'getItem'> | null | undefined): number {
    try {
        const raw = storage?.getItem(DAY_ZOOM_STORAGE_KEY);
        if (raw == null || raw === '') return DEFAULT_DAY_ZOOM_INDEX;
        return clampZoomIndex(Number(raw));
    } catch {
        return DEFAULT_DAY_ZOOM_INDEX;
    }
}
