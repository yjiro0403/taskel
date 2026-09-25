/**
 * Hit-testing for week drags. DayTimeline tags its DOM with these attributes;
 * the pointer position is resolved to the day under it with elementFromPoint,
 * so nothing has to be registered and columns can scroll independently.
 */
export const TIMELINE_GRID_ATTR = 'data-timeline-grid';
export const TIMELINE_UNSCHEDULED_ATTR = 'data-timeline-unscheduled';
export const TIMELINE_UNSCHEDULED_SECTION_ATTR = 'data-timeline-unscheduled-section';
export const TIMELINE_COLUMN_ATTR = 'data-timeline-column';

export type WeekDropHit =
    | {
          kind: 'grid';
          date: string;
          /** Unsnapped minutes at the pointer on that grid's axis. */
          pointerMin: number;
          axisStartMin: number;
          axisEndMin: number;
      }
    | {
          kind: 'unscheduled';
          date: string;
          /** The section group under the pointer; null between groups. */
          sectionId: string | null;
      };

function readNumber(value: string | undefined): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function resolveWeekDropHit(
    clientX: number,
    clientY: number,
    options: { columnFallback: boolean }
): WeekDropHit | null {
    if (typeof document === 'undefined') return null;
    const hit = document.elementFromPoint(clientX, clientY);
    if (!(hit instanceof Element)) return null;

    const unscheduledEl = hit.closest<HTMLElement>(`[${TIMELINE_UNSCHEDULED_ATTR}]`);
    const unscheduledDate = unscheduledEl?.getAttribute(TIMELINE_UNSCHEDULED_ATTR);
    if (unscheduledDate) {
        const groupEl = hit.closest<HTMLElement>(`[${TIMELINE_UNSCHEDULED_SECTION_ATTR}]`);
        const sectionId = groupEl?.getAttribute(TIMELINE_UNSCHEDULED_SECTION_ATTR) || null;
        return { kind: 'unscheduled', date: unscheduledDate, sectionId };
    }

    let gridEl = hit.closest<HTMLElement>(`[${TIMELINE_GRID_ATTR}]`);
    if (!gridEl && options.columnFallback) {
        // Header or padding of a column: a moving block still targets that day's grid.
        gridEl = hit.closest<HTMLElement>(`[${TIMELINE_COLUMN_ATTR}]`)?.querySelector<HTMLElement>(`[${TIMELINE_GRID_ATTR}]`) ?? null;
    }
    if (!gridEl) return null;

    const date = gridEl.getAttribute(TIMELINE_GRID_ATTR);
    const axisStartMin = readNumber(gridEl.dataset.timelineStartMin);
    const axisEndMin = readNumber(gridEl.dataset.timelineEndMin);
    const pixelsPerMinute = readNumber(gridEl.dataset.timelinePpm);
    if (!date || axisStartMin == null || axisEndMin == null || !pixelsPerMinute) return null;

    const rect = gridEl.getBoundingClientRect();
    const pointerMin = axisStartMin + (clientY - rect.top + gridEl.scrollTop) / pixelsPerMinute;
    return { kind: 'grid', date, pointerMin, axisStartMin, axisEndMin };
}
