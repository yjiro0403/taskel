'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from '@/i18n/routing';

export default function ResetPasswordPage() {
    const router = useRouter();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checkingSession, setCheckingSession] = useState(true);
    const [hasSession, setHasSession] = useState(false);

    // /auth/callback で code→session 交換済みの前提。セッションが無ければ
    // リンク期限切れ等として案内する。
    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setHasSession(Boolean(data.user));
            setCheckingSession(false);
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 6) {
            setError('Password should be at least 6 characters.');
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        setIsLoading(true);
        try {
            const supabase = createClient();
            const { error: updateError } = await supabase.auth.updateUser({ password });
            if (updateError) {
                throw updateError;
            }
            router.push('/tasks');
        } catch (err) {
            console.error(err);
            setError('Failed to update password. The reset link may have expired — request a new one.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
            <div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <div className="space-y-2 text-center">
                    <h1 className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-50">
                        Set a new password
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400">
                        Enter a new password for your account.
                    </p>
                </div>

                {checkingSession ? (
                    <div className="flex justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                    </div>
                ) : !hasSession ? (
                    <div className="space-y-4 text-center">
                        <p className="text-sm text-red-500">
                            This reset link is invalid or expired. Please request a new one from the login page.
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push('/login')}
                            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 hover:bg-zinc-900/90 dark:bg-zinc-50 dark:text-zinc-900"
                        >
                            Back to login
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none" htmlFor="new-password">
                                New password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                                <input
                                    id="new-password"
                                    className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 dark:border-zinc-800 dark:focus:ring-zinc-300 dark:focus:ring-offset-zinc-950"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none" htmlFor="confirm-password">
                                Confirm password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                                <input
                                    id="confirm-password"
                                    className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 dark:border-zinc-800 dark:focus:ring-zinc-300 dark:focus:ring-offset-zinc-950"
                                    type="password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {error && <div className="text-center text-sm font-medium text-red-500">{error}</div>}

                        <button
                            className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow-sm transition-colors hover:bg-zinc-900/90 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90"
                            type="submit"
                            disabled={isLoading}
                        >
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Update password
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
