import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { userLookupRequestSchema } from '@/lib/validations/project';

export async function POST(request: Request) {
  try {
    // メールアドレス列挙の緩和。招待相手の存在確認は認可済みメンバーにしか許さないが、
    // それでも総当たりを抑止する。
    const rateLimitResponse = applyRateLimit(request, {
      key: '/api/users/lookup',
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const user = await requireAuth();
    const { email, projectId } = await parseJsonBody(request, userLookupRequestSchema);
    const supabase = await createClient();

    // 認可チェックは「呼び出し元ユーザーの権限」で行う必要があるため、
    // ユーザースコープのクライアントのまま維持する。
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

    // ここから先は「呼び出し元が当該プロジェクトのメンバーである」ことが確定している。
    // profiles の SELECT RLS（migration 003）は本人または既存の共有プロジェクトメンバー
    // のみを許可するため、ユーザースコープのクライアントでは「まだ共有関係のない招待相手」
    // が常に見えず found:false になり、招待機能が成立しない。
    // 認可は上で済ませているので、ここだけ service_role で RLS をバイパスする。
    const admin = createAdminClient();

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .ilike('email', email)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return NextResponse.json({ found: false });
    }

    const { data: existingMember } = await admin
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
