import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { deleteScheduleIntake } from '@/lib/schedule/service';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
    _request: Request,
    context: { params: Promise<{ id: string }> },
) {
    try {
        const user = await requireAuth();
        const { id } = await context.params;
        const supabase = await createClient();
        await deleteScheduleIntake(supabase, user, id);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return handleApiError('schedule intake delete', error);
    }
}
