import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { BILLING_ACK_ENV } from '@/lib/schedule/constants';
import { getScheduleSettings, saveScheduleSettings } from '@/lib/schedule/service';
import { createClient } from '@/lib/supabase/server';

const settingsSchema = z.object({
    autoRegister: z.boolean(),
    retentionDays: z.number().int().min(1).max(365),
    calendarId: z.string().min(1).max(256),
    defaultDurationMinutes: z.number().int().min(5).max(1440).nullable(),
});

export async function GET() {
    try {
        const user = await requireAuth();
        const supabase = await createClient();
        const settings = await getScheduleSettings(supabase, user);
        return NextResponse.json({
            settings,
            billingAcknowledged: process.env[BILLING_ACK_ENV] === 'true',
        });
    } catch (error) {
        return handleApiError('schedule settings get', error);
    }
}

export async function PUT(request: Request) {
    try {
        const user = await requireAuth();
        const input = await parseJsonBody(request, settingsSchema);
        const supabase = await createClient();
        const settings = await saveScheduleSettings(supabase, user, input);
        return NextResponse.json({
            settings,
            billingAcknowledged: process.env[BILLING_ACK_ENV] === 'true',
        });
    } catch (error) {
        return handleApiError('schedule settings put', error);
    }
}
