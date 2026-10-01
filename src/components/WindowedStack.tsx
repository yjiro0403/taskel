'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { buildOffsets, visibleRange } from '@/lib/ui/visibleRange';

const ESTIMATE_PX = 88;
const OVERSCAN_PX = 240;

interface WindowedStackProps<T extends { id: string }> {
    items: readonly T[];
    className?: string;
    highlightedId?: string | null;
    renderItem: (item: T) => ReactNode;
}

export function WindowedStack<T extends { id: string }>({
    items,
    className,
    highlightedId,
    renderItem,
}: WindowedStackProps<T>) {
    const scrollerRef = useRef<HTMLDivElement>(null);
    const heightsRef = useRef(new Map<string, number>());
    const frameRef = useRef<number | null>(null);
    const [heightVersion, setHeightVersion] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState(480);

    const ids = useMemo(() => items.map((item) => item.id), [items]);
    const offsets = useMemo(
        () => buildOffsets(ids, heightsRef.current, ESTIMATE_PX),
        // heightVersion is the signal that heightsRef changed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ids, heightVersion]
    );
    const range = visibleRange(offsets, scrollTop, viewport, OVERSCAN_PX);

    useEffect(() => {
        const element = scrollerRef.current;
        if (!element) return;
        const measure = () => setViewport(element.clientHeight || 480);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const scrolledHighlightRef = useRef<string | null>(null);
    useEffect(() => {
        if (!highlightedId) {
            scrolledHighlightRef.current = null;
            return;
        }
        if (!scrollerRef.current || scrolledHighlightRef.current === highlightedId) return;
        const index = ids.indexOf(highlightedId);
        if (index < 0) return;
        const top = offsets[index] ?? 0;
        const nextTop = offsets[index + 1] ?? top + ESTIMATE_PX;
        const height = Math.max(nextTop - top, 1);
        const view = scrollerRef.current.clientHeight || viewport;
        scrollerRef.current.scrollTop = Math.max(0, top - (view - height) / 2);
        scrolledHighlightRef.current = highlightedId;
    }, [highlightedId, ids, offsets, viewport]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    const scheduleMeasure = () => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setHeightVersion((version) => version + 1);
        });
    };

    const rangeRef = useRef(range);
    rangeRef.current = range;

    const onScroll = (event: UIEvent<HTMLDivElement>) => {
        const next = event.currentTarget.scrollTop;
        const nextRange = visibleRange(offsets, next, viewport, OVERSCAN_PX);
        const current = rangeRef.current;
        if (nextRange.start === current.start && nextRange.end === current.end) return;
        setScrollTop(next);
    };

    return (
        <div ref={scrollerRef} className={className} onScroll={onScroll}>
            <div style={{ height: offsets[ids.length] ?? 0, position: 'relative' }}>
                {items.slice(range.start, range.end).map((item, offset) => {
                    const index = range.start + offset;
                    return (
                        <div
                            key={item.id}
                            ref={(node) => {
                                if (!node) return;
                                const height = node.getBoundingClientRect().height;
                                if (height > 0 && Math.abs((heightsRef.current.get(item.id) ?? 0) - height) >= 1) {
                                    heightsRef.current.set(item.id, height);
                                    scheduleMeasure();
                                }
                            }}
                            style={{ position: 'absolute', top: offsets[index] ?? 0, left: 0, right: 0 }}
                            className="px-2"
                        >
                            {renderItem(item)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
