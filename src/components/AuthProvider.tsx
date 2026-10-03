'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { ensureProfile, createDefaultWorkspace } from '@/lib/supabase/data';
import { mapSupabaseUser } from '@/lib/supabase/auth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useStore } from '@/store/useStore';
import TaskSearchModal from '@/components/TaskSearchModal';
import {
    clearGoogleCalendarProviderToken,
    storeGoogleCalendarProviderToken,
} from '@/lib/calendarService';

function isPublicPath(normalizedPath: string) {
    // /reset-password must stay public so invalid-link messaging can render
    // before a session is established (otherwise AuthProvider bounces to /login).
    const publicRoutes = ['/', '/login', '/signup', '/join', '/reset-password'];
    return publicRoutes.includes(normalizedPath) || normalizedPath.startsWith('/join');
}

function normalizePath(pathname: string) {
    return pathname.replace(/^\/(en|ja)/, '') || '/';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const setUser = useStore((state) => state.setUser);
    const router = useRouter();
    const pathname = usePathname();
    // 認証イベント時のリダイレクト判定にだけ現在のパスを使う。effect の依存に pathname を
    // 入れると画面遷移のたびに getUser + profiles upsert + sections select が走り、
    // user オブジェクトも差し替わって購読コンポーネントが再描画されていた。
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;

    useKeyboardShortcuts();

    useEffect(() => {
        let subscription: { unsubscribe: () => void } | null = null;

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
            } = supabase.auth.onAuthStateChange(async (event, session) => {
                if (event === 'SIGNED_OUT') {
                    clearGoogleCalendarProviderToken();
                } else {
                    storeGoogleCalendarProviderToken(
                        session?.provider_token,
                        session?.user.id
                    );
                }

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

                if (!session?.user && !isPublicPath(normalizePath(pathnameRef.current))) {
                    router.push('/login');
                }
            });
            subscription = authSubscription;
        } catch (error) {
            // Misconfigured client must not white-screen the app, but must not leave
            // protected routes accessible without auth either.
            console.error('Failed to initialize auth client:', error);
            setUser(null);
            if (!isPublicPath(normalizePath(pathnameRef.current))) {
                router.push('/login');
            }
        }

        return () => {
            subscription?.unsubscribe();
        };
    }, [router, setUser]);

    return (
        <>
            {children}
            <TaskSearchModal />
        </>
    );
}
