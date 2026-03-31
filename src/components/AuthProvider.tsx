'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { ensureProfile, createDefaultWorkspace } from '@/lib/supabase/data';
import { mapSupabaseUser } from '@/lib/supabase/auth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useStore } from '@/store/useStore';

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const setUser = useStore((state) => state.setUser);
    const router = useRouter();
    const pathname = usePathname();

    useKeyboardShortcuts();

    useEffect(() => {
        const supabase = createClient();

        const syncAuthState = async () => {
            const { data, error } = await supabase.auth.getUser();
            if (error || !data.user) {
                setUser(null);
                return;
            }

            await ensureProfile(supabase, data.user);
            await createDefaultWorkspace(supabase, data.user.id);
            setUser(mapSupabaseUser(data.user));
        };

        void syncAuthState();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!session?.user) {
                setUser(null);
            } else {
                await ensureProfile(supabase, session.user);
                await createDefaultWorkspace(supabase, session.user.id);
                setUser(mapSupabaseUser(session.user));
            }

            const publicRoutes = ['/', '/login', '/signup', '/join'];
            const normalizedPath = pathname.replace(/^\/(en|ja)/, '') || '/';

            if (!session?.user && !publicRoutes.includes(normalizedPath) && !normalizedPath.startsWith('/join')) {
                router.push('/login');
            }
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [pathname, router, setUser]);

    return <>{children}</>;
}
