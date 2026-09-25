/** Distance from a scroll edge (px) inside which a drag scrolls the container. */
export const AUTO_SCROLL_ZONE = 40;
/** Scroll speed at the very edge, in px per animation frame. */
export const AUTO_SCROLL_MAX_STEP = 14;

/**
 * How far to scroll this frame for a pointer at `pointer` over a viewport that
 * spans [top, bottom]: nothing in the middle, faster the closer to an edge.
 */
export function autoScrollStep(
    pointer: number,
    top: number,
    bottom: number,
    zone = AUTO_SCROLL_ZONE,
    maxStep = AUTO_SCROLL_MAX_STEP
): number {
    if (bottom - top <= zone * 2) return 0;
    if (pointer < top + zone) {
        const ratio = Math.min(1, (top + zone - pointer) / zone);
        return -Math.ceil(ratio * maxStep);
    }
    if (pointer > bottom - zone) {
        const ratio = Math.min(1, (pointer - (bottom - zone)) / zone);
        return Math.ceil(ratio * maxStep);
    }
    return 0;
}
