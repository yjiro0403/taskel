'use client';

import { useEffect, useState, use, Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LeftSidebar from '@/components/LeftSidebar';

function JoinContent() {
    const { user, joinProjectWithToken } = useStore();
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Verifying invitation...');

    useEffect(() => {
        if (!token) {
            setStatus('error');
            setMessage('Invalid invitation link. Token is missing.');
            return;
        }

        if (!user) {
            // Wait for user or handle guest
            setMessage('Please log in to join the project.');
            return;
        }

        const join = async () => {
            setStatus('loading');
            const res = await joinProjectWithToken(token);
            if (res.success) {
                setStatus('success');
                setMessage(res.message);
                setTimeout(() => {
                    router.push(`/projects/${res.projectId}`);
                }, 2000);
            } else {
                setStatus('error');
                setMessage(res.message);
            }
        };

        join();
    }, [token, user, joinProjectWithToken, router]);

    return (
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center border border-gray-100">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 text-purple-600 mb-6">
                {status === 'loading' && <Loader2 size={32} className="animate-spin" />}
                {status === 'success' && <CheckCircle size={32} />}
                {status === 'error' && <AlertCircle size={32} className="text-red-500" />}
            </div>

            <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Project Invitation
            </h1>

            <p className="text-gray-600 mb-8">
                {message}
            </p>

            {!user && (
                <button
                    onClick={() => router.push(`/login?redirect=/join?token=${token}`)}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                >
                    Log in to Join
                </button>
            )}

            {status === 'error' && (
                <button
                    onClick={() => router.push('/tasks')}
                    className="w-full py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                    Go back home
                </button>
            )}

            {status === 'success' && (
                <p className="text-sm text-gray-400">
                    Redirecting you to the project...
                </p>
            )}
        </div>
    );
}

export default function JoinPage() {
    return (
        <div className="min-h-screen bg-gray-50">
            <LeftSidebar />
            <PageHeader />
            <main className="max-w-md mx-auto pt-20 px-4">
                <Suspense fallback={
                    <div className="flex justify-center p-8">
                        <Loader2 className="animate-spin text-blue-600" />
                    </div>
                }>
                    <JoinContent />
                </Suspense>
            </main>
        </div>
    );
}
