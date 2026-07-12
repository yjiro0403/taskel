import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getSupabaseConfig } from '@/lib/supabase/config';
import type { Database } from '@/types/supabase';

export async function updateSession(request: NextRequest, response = NextResponse.next({ request })) {
    const { url, anonKey } = getSupabaseConfig();
    const nextResponse = response;

    const supabase = createServerClient<Database>(url, anonKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => {
                    request.cookies.set(name, value);
                });

                cookiesToSet.forEach(({ name, value, options }) => {
                    nextResponse.cookies.set(name, value, options);
                });
            },
        },
    });

    await supabase.auth.getUser();

    return nextResponse;
}
