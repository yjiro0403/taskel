'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { ensureProfile, createDefaultWorkspace } from '@/lib/supabase/data';
import { mapSupabaseUser } from '@/lib/supabase/auth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useStore } from '@/store/useStore';
import TaskSearchModal from '@/components/TaskSearchModal';

function isPublicPath(normalizedPath: string) {
    // /reset-password must stay public so invalid-link messaging can render
    // before a session is established (otherwise AuthProvider bounces to /login).
    const publicRoutes = ['/', '/login', '/signup', '/join', '/reset-password'];
    return publicRoutes.includes(normalizedPath) || normalizedPath.startsWith('/join');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const setUser = useStore((state) => state.setUser);
    const router = useRouter();
    const pathname = usePathname();

    useKeyboardShortcuts();

    useEffect(() => {
        let subscription: { unsubscribe: () => void } | null = null;
        const normalizedPath = pathname.replace(/^\/(en|ja)/, '') || '/';

        try {
            const supabase = createClient();

            const syncAuthState = async () => {
                const { data, error } = await supabase.auth.getUser();
                if (error || !data.user) {
                    setUser(null);
                    return;
                }

                // Profile/workspace init failures (transient network, RLS, UNIQUE races)
                // must not clear the session — that causes login ↔ app redirect loops.
                try {
                    await ensureProfile(supabase, data.user);
                    await createDefaultWorkspace(supabase, data.user.id);
                } catch (initError) {
                    console.error('Profile/workspace init failed (session preserved):', initError);
                }
                setUser(mapSupabaseUser(data.user));
            };

            void syncAuthState();

            const {
                data: { subscription: authSubscription },
            } = supabase.auth.onAuthStateChange(async (_event, session) => {
                if (!session?.user) {
                    setUser(null);
                } else {
                    try {
                        await ensureProfile(supabase, session.user);
                        await createDefaultWorkspace(supabase, session.user.id);
                    } catch (initError) {
                        console.error('Profile/workspace init failed (session preserved):', initError);
                    }
                    setUser(mapSupabaseUser(session.user));
                }

                if (!session?.user && !isPublicPath(normalizedPath)) {
                    router.push('/login');
                }
            });
            subscription = authSubscription;
        } catch (error) {
            // Misconfigured client must not white-screen the app, but must not leave
            // protected routes accessible without auth either.
            console.error('Failed to initialize auth client:', error);
            setUser(null);
            if (!isPublicPath(normalizedPath)) {
                router.push('/login');
            }
        }

        return () => {
            subscription?.unsubscribe();
        };
    }, [pathname, router, setUser]);

    return (
        <>
            {children}
            <TaskSearchModal />
        </>
    );
}
