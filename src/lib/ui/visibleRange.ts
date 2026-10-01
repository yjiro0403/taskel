/** Prefix sums: offsets[i] is the top of item i, offsets[count] is the total height. */
export function buildOffsets(ids: readonly string[], heights: ReadonlyMap<string, number>, estimate: number): number[] {
    const offsets = new Array<number>(ids.length + 1);
    offsets[0] = 0;
    for (let index = 0; index < ids.length; index += 1) {
        offsets[index + 1] = offsets[index] + (heights.get(ids[index]) ?? estimate);
    }
    return offsets;
}

export function visibleRange(
    offsets: readonly number[],
    scrollTop: number,
    viewport: number,
    overscanPx: number
): { start: number; end: number } {
    const count = Math.max(0, offsets.length - 1);
    const top = scrollTop - overscanPx;
    const bottom = scrollTop + viewport + overscanPx;
    let start = 0;
    while (start < count && offsets[start + 1] < top) start += 1;
    let end = start;
    // Include a row whose top sits on the viewport edge so the last pixel is not blank.
    while (end < count && offsets[end] <= bottom) end += 1;
    return { start, end };
}
