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

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setUser(user);

            if (user) {
                // Sync user data to Firestore for team features
                try {
                    const { doc, setDoc, collection, query, where, getDocs, writeBatch, arrayUnion, getDoc } = await import('firebase/firestore');
                    const { db } = await import('@/lib/firebase');

                    // 1. Update User Profile
                    await setDoc(doc(db, 'users', user.uid), {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL,
                        lastSeen: Date.now()
                    }, { merge: true });

                    // 2. Check for Pending Invites
                    if (user.email) {
                        const invQ = query(collection(db, 'invitations'), where('email', '==', user.email));
                        const invSnaps = await getDocs(invQ);

                        if (!invSnaps.empty) {
                            const batch = writeBatch(db);
                            let updatesCount = 0;

                            for (const invDoc of invSnaps.docs) {
                                const invData = invDoc.data();
                                const projectId = invData.projectId;
                                const role = invData.role || 'member';

                                if (!projectId) continue;

                                const projectRef = doc(db, 'projects', projectId);

                                // We need to read project to check if we can update (or blindly update map?)
                                // Arrays can be arrayUnion, but Maps (roles) need setDoc with { merge: true } or updateDoc with specific field path
                                // Since we are inside a loop, reading might be expensive but robust.
                                // Or we can optimize: arrayUnion for memberIds, and `roles.uid` dot notation for update.

                                batch.update(projectRef, {
                                    memberIds: arrayUnion(user.uid),
                                    [`roles.${user.uid}`]: role
                                });
                                batch.delete(invDoc.ref);
                                updatesCount++;
                            }

                            if (updatesCount > 0) {
                                await batch.commit();
                                console.log(`Processed ${updatesCount} pending invitations.`);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error syncing user profile or invites:", e);
                }

                // Protected Routes Logic: Redirect if coming from public route (optional, logic kept same as before but inside if)
            }

            const publicRoutes = ['/', '/login', '/signup', '/join']; // Added /join just in case
            if (!user && !publicRoutes.includes(pathname) && !pathname.startsWith('/join')) {
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
