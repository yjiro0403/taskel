import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { readGoogleAccessToken } from '@/lib/schedule/http';
import { createScheduleIntake, listScheduleIntakes } from '@/lib/schedule/service';
import type { IntakeSource } from '@/lib/schedule/types';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function sourceOf(value: FormDataEntryValue | null, hasImage: boolean): IntakeSource {
    if (value === 'image_share') return 'image_share';
    if (value === 'text') return 'text';
    if (value === 'image_upload') return 'image_upload';
    return hasImage ? 'image_upload' : 'text';
}

export async function GET(request: Request) {
    try {
        const rateLimitResponse = applyRateLimit(request, {
            key: '/api/schedule/intake',
            limit: 60,
            windowMs: 60_000,
        });
        if (rateLimitResponse) {
            return rateLimitResponse;
        }
        const user = await requireAuth();
        const supabase = await createClient();
        const result = await listScheduleIntakes(supabase, user);
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError('schedule intake list', error);
    }
}

export async function POST(request: Request) {
    try {
        const rateLimitResponse = applyRateLimit(request, {
            key: '/api/schedule/intake:write',
            limit: 10,
            windowMs: 60_000,
        });
        if (rateLimitResponse) {
            return rateLimitResponse;
        }
        const user = await requireAuth();
        const form = await request.formData();
        const textValue = form.get('text');
        const text = typeof textValue === 'string' ? textValue : '';
        const file = form.get('image');
        const image = file instanceof File && file.size > 0
            ? { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/octet-stream' }
            : null;
        const supabase = await createClient();
        const result = await createScheduleIntake(supabase, user, {
            source: sourceOf(form.get('source'), Boolean(image)),
            text,
            image,
            googleAccessToken: readGoogleAccessToken(request),
        });
        return NextResponse.json(result);
    } catch (error) {
        return handleApiError('schedule intake create', error);
    }
}
