import type { User } from '@supabase/supabase-js';

import type { Database } from '@/types/supabase';
import type { AppUser } from '@/types/auth';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

function pickDisplayName(user: User, profile?: ProfileRow | null) {
    return (
        profile?.display_name ||
        user.user_metadata?.display_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        null
    );
}

function pickPhotoUrl(user: User, profile?: ProfileRow | null) {
    return (
        profile?.avatar_url ||
        user.user_metadata?.avatar_url ||
        user.user_metadata?.picture ||
        null
    );
}

export function mapSupabaseUser(user: User, profile?: ProfileRow | null): AppUser {
    return {
        id: user.id,
        uid: user.id,
        email: user.email ?? profile?.email ?? null,
        displayName: pickDisplayName(user, profile),
        photoURL: pickPhotoUrl(user, profile),
    };
}
