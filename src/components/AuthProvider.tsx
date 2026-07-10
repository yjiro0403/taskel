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

            // プロフィール/ワークスペース初期化の失敗（一時的なネットワーク断・RLS・
            // UNIQUE衝突等）でセッション自体を失わないよう、失敗しても setUser は必ず行う。
            // これを握らないと『ログイン済みなのにアプリ上ログアウト扱い→/login無限往復』になる。
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
            data: { subscription },
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

            // /reset-password は「リンク無効」案内をセッション未確立でも表示する必要があるため公開扱いにする。
            // 未登録だと AuthProvider がセッション確立前に /login へ強制遷移させ、案内が出る前に飛ばされる。
            const publicRoutes = ['/', '/login', '/signup', '/join', '/reset-password'];
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
