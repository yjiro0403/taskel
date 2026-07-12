'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock, Mail } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Link, useRouter } from '@/i18n/routing';
import { useStore } from '@/store/useStore';

interface AuthFormProps {
    isLogin?: boolean;
}

// /auth/callback がエラー時に付与する ?authError=<code> を、ユーザー向けの文言に変換する。
function mapAuthCallbackError(code: string): string {
    switch (code) {
        case 'otp_expired':
        case 'otp_verification_failed':
            return 'The link has expired or was already used. Please request a new password reset email below.';
        case 'access_denied':
            return 'Sign in was cancelled or denied. Please try again.';
        case 'missing_auth_params':
            return 'Invalid sign-in link. Please try again.';
        default:
            return 'Sign in could not be completed. Please try again.';
    }
}

export function AuthForm({ isLogin = true }: AuthFormProps) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resetMessage, setResetMessage] = useState<string | null>(null);
    const router = useRouter();
    const { user } = useStore();

    useEffect(() => {
        if (user) {
            router.push('/tasks');
        }
    }, [router, user]);

    // /auth/callback がリンク失効・OAuth拒否などで戻したエラーを表示する。
    // useSearchParams は Next の Suspense 境界を要求するため、ここでは window.location を直接読む。
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const authError = new URLSearchParams(window.location.search).get('authError');
        if (authError) {
            setError(mapAuthCallbackError(authError));
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        const supabase = createClient();

        try {
            if (isLogin) {
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (signInError) {
                    throw signInError;
                }
            } else {
                const { error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                });

                if (signUpError) {
                    throw signUpError;
                }
            }

            router.push('/tasks');
        } catch (err: any) {
            console.error(err);

            let message = 'An error occurred during authentication.';
            if (err.message?.toLowerCase().includes('invalid login credentials')) {
                message = 'Invalid email or password.';
            } else if (err.message?.toLowerCase().includes('already registered')) {
                message = 'Email is already in use.';
            } else if (err.message?.toLowerCase().includes('password should be at least')) {
                message = 'Password should be at least 6 characters.';
            }

            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = async () => {
        if (!email) {
            setError('Enter your email above, then click reset.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setResetMessage(null);
        try {
            const supabase = createClient();
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
            });
            if (resetError) {
                throw resetError;
            }
            setResetMessage('Password reset email sent. Check your inbox to set a new password.');
        } catch (err) {
            console.error(err);
            setError('Failed to send reset email. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const supabase = createClient();
            const redirectTo = `${window.location.origin}/auth/callback?next=/tasks`;
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
                    },
                },
            });

            if (oauthError) {
                throw oauthError;
            }
        } catch (err) {
            console.error(err);
            setError('Google Sign In failed.');
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
            <div className="space-y-2 text-center">
                <h1 className="text-3xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-50">
                    {isLogin ? 'Welcome Back' : 'Create Account'}
                </h1>
                <p className="text-zinc-500 dark:text-zinc-400">
                    {isLogin
                        ? 'Enter your credentials to access your account'
                        : 'Enter your information to create an account'}
                </p>
                {isLogin && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        First login after the migration? Start from &quot;Reset password&quot;.
                    </p>
                )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium leading-none" htmlFor="email">
                        Email
                    </label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                        <input
                            id="email"
                            className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 pl-9 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:placeholder:text-zinc-400 dark:focus:ring-zinc-300 dark:focus:ring-offset-zinc-950"
                            placeholder="m@example.com"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium leading-none" htmlFor="password">
                        Password
                    </label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-zinc-500" />
                        <input
                            id="password"
                            className="flex h-10 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:focus:ring-zinc-300 dark:focus:ring-offset-zinc-950"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                </div>

                {error && <div className="text-center text-sm font-medium text-red-500">{error}</div>}
                {resetMessage && <div className="text-center text-sm font-medium text-green-600">{resetMessage}</div>}

                <button
                    className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow-sm transition-colors hover:bg-zinc-900/90 disabled:pointer-events-none disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/90"
                    type="submit"
                    disabled={isLoading}
                >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isLogin ? 'Sign In' : 'Sign Up'}
                </button>

                {isLogin && (
                    <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={isLoading}
                        className="w-full text-center text-sm text-zinc-500 underline-offset-4 hover:underline disabled:opacity-50 dark:text-zinc-400"
                    >
                        Forgot / set password?
                    </button>
                )}
            </form>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-zinc-300 dark:border-zinc-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-zinc-500 dark:bg-zinc-900">Or continue with</span>
                </div>
            </div>

            <button
                onClick={handleGoogleSignIn}
                type="button"
                className="inline-flex h-10 w-full items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                disabled={isLoading}
            >
                {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" viewBox="0 0 488 512">
                        <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z" />
                    </svg>
                )}
                Google
            </button>

            <div className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <Link
                    href={isLogin ? '/signup' : '/login'}
                    className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
                >
                    {isLogin ? 'Sign Up' : 'Log In'}
                </Link>
            </div>
        </div>
    );
}
