import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { createDefaultWorkspace } from '@/lib/supabase/data';

export async function POST(request: Request) {
    try {
        const user = await requireAuth();
        await parseJsonBody(request, z.object({}));

        const supabase = await createClient();
        await createDefaultWorkspace(supabase, user.id);

        return NextResponse.json({ success: true, message: 'Onboarding data created' });
    } catch (error) {
        return handleApiError('Onboarding error', error);
    }
}
