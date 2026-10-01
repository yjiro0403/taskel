import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { readGoogleAccessToken } from '@/lib/schedule/http';
import { registerScheduleIntake } from '@/lib/schedule/service';
import { createClient } from '@/lib/supabase/server';

const registerSchema = z.object({
    title: z.string(),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    timeZone: z.string(),
    allDay: z.boolean(),
    calendarId: z.string().optional(),
});

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireAuth();
        const { id } = await context.params;
        const body = await parseJsonBody(request, registerSchema);
        const supabase = await createClient();
        const intake = await registerScheduleIntake(
            supabase,
            user,
            id,
            body,
            body.calendarId ?? null,
            readGoogleAccessToken(request),
        );
        return NextResponse.json({ intake });
    } catch (error) {
        return handleApiError('schedule intake register', error);
    }
}
