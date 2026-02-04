'use client';

import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useStore } from '@/store/useStore';
import { useRouter, usePathname } from 'next/navigation';

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const setUser = useStore((state) => state.setUser);

    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!auth) {
            console.error("Firebase Auth not initialized. Check your environment variables.");
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);

            // Protected Routes Logic
            const publicRoutes = ['/', '/login', '/signup'];
            if (!user && !publicRoutes.includes(pathname)) {
                router.push('/login');
            }
        });

        return () => unsubscribe();
    }, [setUser, pathname, router]);

    if (!auth) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-50 p-4">
                <div className="text-center p-8 bg-white rounded-lg shadow-md border border-red-200">
                    <h1 className="text-xl font-bold text-red-600 mb-2">Configuration Error</h1>
                    <p className="text-gray-700">The application could not be initialized.</p>
                    <p className="text-sm text-gray-500 mt-2">Missing Firebase Environment Variables.</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
