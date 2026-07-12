import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/supabase';

function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required Supabase environment variable: ${name}`);
    }
    return value;
}

export function createAdminClient() {
    return createSupabaseClient<Database>(
        requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
        requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        }
    );
}
