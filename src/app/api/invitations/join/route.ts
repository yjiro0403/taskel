import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { invitationJoinRequestSchema } from '@/lib/validations/invitation';

export async function POST(request: Request) {
    try {
        await requireAuth();
        const { inviteToken } = await parseJsonBody(request, invitationJoinRequestSchema);
        const supabase = await createClient();

        const { data: projectId, error } = await supabase.rpc('accept_invitation', {
            invite_token: inviteToken,
        });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            projectId,
            message: 'Successfully joined project',
        });
    } catch (error) {
        return handleApiError('Error joining project', error);
    }
}
