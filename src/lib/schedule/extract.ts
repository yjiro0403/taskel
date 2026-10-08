import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';

import { ApiError } from '@/lib/api/errors';
import { BILLING_ACK_ENV, SCHEDULE_MODEL, SCHEDULE_TIME_ZONE } from '@/lib/schedule/constants';
import { normalizeScheduleItems } from '@/lib/schedule/normalize';
import { buildExtractionPrompt } from '@/lib/schedule/prompt';
import { extractionSchema } from '@/lib/schedule/schema';
import type { ScheduleCandidate } from '@/lib/schedule/types';

export interface ExtractionResult {
    candidates: ScheduleCandidate[];
    imageNotes: string | null;
    inputTokens: number;
    outputTokens: number;
}

export function scheduleAiBlock(): 'billing' | 'missing_key' | null {
    if (process.env[BILLING_ACK_ENV] !== 'true') {
        return 'billing';
    }
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
        return 'missing_key';
    }
    return null;
}

/**
 * Image and text go to the paid Gemini path only after the billing acknowledgement.
 * The model returns candidates. It does not receive a calendar token.
 */
export async function extractSchedule(input: {
    text?: string | null;
    image?: { bytes: Uint8Array; mime: string } | null;
    now: Date;
}): Promise<ExtractionResult> {
    const block = scheduleAiBlock();
    if (block === 'billing') {
        throw new ApiError(503, 'ai_billing_not_acknowledged');
    }
    if (block === 'missing_key') {
        throw new ApiError(503, 'ai_not_configured');
    }

    const instruction = input.text?.trim()
        ? `Source text:\n${input.text.trim().slice(0, 4000)}`
        : 'Extract the schedule from this image.';
    const content = input.image
        ? [
            { type: 'text' as const, text: instruction },
            {
                type: 'image' as const,
                image: input.image.bytes,
                mediaType: input.image.mime,
            },
        ]
        : instruction;

    const result = await generateObject({
        model: google(SCHEDULE_MODEL),
        schema: extractionSchema,
        system: buildExtractionPrompt(input.now.toISOString(), SCHEDULE_TIME_ZONE),
        temperature: 0,
        maxRetries: 1,
        maxOutputTokens: 2000,
        providerOptions: {
            google: {
                thinkingConfig: { thinkingBudget: 0 },
            },
        },
        messages: [{ role: 'user', content }],
    });

    const notes = result.object.imageNotes.replace(/\s+/g, ' ').trim().slice(0, 500);
    return {
        candidates: normalizeScheduleItems(result.object.items),
        imageNotes: notes || null,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
    };
}
