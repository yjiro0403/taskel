import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { getAppUrl } from '@/lib/api/url';
import { createClient } from '@/lib/supabase/server';
import { invitationCreateRequestSchema } from '@/lib/validations/invitation';

export async function POST(request: Request) {
    try {
        const rateLimitResponse = applyRateLimit(request, {
            key: '/api/invitations',
            limit: 10,
            windowMs: 60_000,
        });
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const user = await requireAuth();
        const { projectId, email, role } = await parseJsonBody(request, invitationCreateRequestSchema);
        const supabase = await createClient();

        const { data: canManageProject, error: permissionError } = await supabase.rpc('can_manage_project', {
            project_uuid: projectId,
        });

        if (permissionError) {
            throw permissionError;
        }

        if (!canManageProject) {
            return NextResponse.json({ error: 'Insufficient permissions to invite' }, { status: 403 });
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const isReusable = !email;

        const { data: invitation, error: insertError } = await supabase
            .from('invitations')
            .insert({
                project_id: projectId,
                email: email ?? null,
                role: role || 'member',
                inviter_id: user.id,
                status: 'pending',
                expires_at: expiresAt,
                is_reusable: isReusable,
            })
            .select('id')
            .single();

        if (insertError) {
            throw insertError;
        }

        const joinLink = `${getAppUrl()}/join?token=${invitation.id}`;
        return NextResponse.json({ success: true, joinLink });
    } catch (error) {
        return handleApiError('Error generating invitation', error);
    }
}
