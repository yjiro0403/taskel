import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/api/errors';

export async function requireAuth(): Promise<User> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
        console.error('Auth verification failed:', error);
        throw new ApiError(401, 'Unauthorized');
    }

    return data.user;
}
