'use client';

import { useDndContext } from '@dnd-kit/core';
import clsx from 'clsx';

interface BottomDropZoneProps {
    sectionId: string;
}

export function BottomDropZone({ sectionId }: BottomDropZoneProps) {
    const { active, over } = useDndContext();
    const isOverSection = over?.id === sectionId && active?.id !== over?.id;

    return (
        <div className={clsx(
            "transition-all duration-200 mx-2 mb-2 rounded border-2 border-dashed flex items-center justify-center text-sm font-medium",
            isOverSection
                ? "h-12 bg-blue-50 border-blue-400 text-blue-600 opacity-100"
                : "h-2 border-transparent text-transparent opacity-0"
        )}>
            {isOverSection && "Drop here to add to end"}
        </div>
    );
}
