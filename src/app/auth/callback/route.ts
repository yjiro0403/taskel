import { NextResponse } from 'next/server';

import { getSafeRedirectPath } from '@/lib/api/url';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get('code');
    const next = getSafeRedirectPath(searchParams.get('next'), origin, '/');

    if (code) {
        const supabase = await createClient();
        await supabase.auth.exchangeCodeForSession(code);
    }

    return NextResponse.redirect(new URL(next, origin));
}
