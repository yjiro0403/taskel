import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/api/request';
import { createClient } from '@/lib/supabase/server';
import { userLookupRequestSchema } from '@/lib/validations/project';

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const { email, projectId } = await parseJsonBody(request, userLookupRequestSchema);
    const supabase = await createClient();

    const { data: membership, error: membershipError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return NextResponse.json({ found: false });
    }

    const { data: existingMember } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', profile.id)
      .maybeSingle();

    return NextResponse.json({
      found: true,
      user: {
        uid: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        photoURL: profile.avatar_url,
        alreadyMember: Boolean(existingMember),
      },
    });
  } catch (error) {
    return handleApiError('User lookup error', error);
  }
}
