import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { readGoogleAccessToken } from '@/lib/schedule/http';
import { cancelScheduleIntake } from '@/lib/schedule/service';
import { createClient } from '@/lib/supabase/server';

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireAuth();
        const { id } = await context.params;
        const supabase = await createClient();
        const intake = await cancelScheduleIntake(
            supabase,
            user,
            id,
            readGoogleAccessToken(request),
        );
        return NextResponse.json({ intake });
    } catch (error) {
        return handleApiError('schedule intake cancel', error);
    }
}
