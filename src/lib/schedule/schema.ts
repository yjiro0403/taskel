import { z } from 'zod';

import type { RawScheduleItem } from '@/lib/schedule/normalize';

const explicitSchema = z.object({
    year: z.boolean(),
    month: z.boolean(),
    day: z.boolean(),
    startTime: z.boolean(),
    endTime: z.boolean(),
    title: z.boolean(),
    timezone: z.boolean(),
});

const itemSchema = z.object({
    title: z.string().nullable(),
    date: z.string().nullable(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    timezone: z.string().nullable(),
    allDay: z.boolean(),
    status: z.enum(['confirmed', 'candidate', 'unknown']),
    explicit: explicitSchema,
    sourceEvidence: z.string(),
    uncertainties: z.array(z.string()),
    weekdayLabel: z.string().nullable(),
});

export const extractionSchema = z.object({
    items: z.array(itemSchema),
    imageNotes: z.string(),
});

export type ExtractionObject = z.infer<typeof extractionSchema>;

export function extractionItems(object: ExtractionObject): RawScheduleItem[] {
    return object.items;
}
