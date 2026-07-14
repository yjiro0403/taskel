'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { ensureProfile, createDefaultWorkspace } from '@/lib/supabase/data';
import { mapSupabaseUser } from '@/lib/supabase/auth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useStore } from '@/store/useStore';

function isPublicPath(normalizedPath: string) {
    const publicRoutes = ['/', '/login', '/signup', '/join'];
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
                try {
                    const { data, error } = await supabase.auth.getUser();
                    if (error || !data.user) {
                        setUser(null);
                        return;
                    }

                    await ensureProfile(supabase, data.user);
                    await createDefaultWorkspace(supabase, data.user.id);
                    setUser(mapSupabaseUser(data.user));
                } catch (error) {
                    console.error('Auth sync failed:', error);
                    setUser(null);
                }
            };

            void syncAuthState();

            const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
                try {
                    if (!session?.user) {
                        setUser(null);
                    } else {
                        await ensureProfile(supabase, session.user);
                        await createDefaultWorkspace(supabase, session.user.id);
                        setUser(mapSupabaseUser(session.user));
                    }
                } catch (error) {
                    console.error('Auth state change failed:', error);
                    setUser(null);
                }

                if (!session?.user && !isPublicPath(normalizedPath)) {
                    router.push('/login');
                }
            });
            subscription = data.subscription;
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

    return <>{children}</>;
}
