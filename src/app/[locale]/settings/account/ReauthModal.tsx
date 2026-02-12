'use client';

import { useState } from 'react';
import {
    reauthenticateWithPopup,
    GoogleAuthProvider,
    reauthenticateWithCredential,
    EmailAuthProvider,
    User
} from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { Loader2, X, Lock, AlertTriangle } from 'lucide-react';

interface ReauthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onReauthSuccess: () => void;
    user: User;
}

export default function ReauthModal({ isOpen, onClose, onReauthSuccess, user }: ReauthModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    // Determine the provider ID to show relevant UI
    const providerId = user.providerData[0]?.providerId;
    const isGoogle = providerId === 'google.com';

    const handleGoogleReauth = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await reauthenticateWithPopup(user, googleProvider);
            onReauthSuccess();
        } catch (err: any) {
            console.error("Reauth error (Google):", err);
            setError("Googleでの再認証に失敗しました。もう一度お試しください。");
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordReauth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            const credential = EmailAuthProvider.credential(user.email!, password);
            await reauthenticateWithCredential(user, credential);
            onReauthSuccess();
        } catch (err: any) {
            console.error("Reauth error (Password):", err);
            if (err.code === 'auth/wrong-password') {
                setError("パスワードが間違っています。");
            } else {
                setError("再認証に失敗しました。");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Lock size={18} className="text-gray-500" />
                        再認証が必要です
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <p className="text-sm text-gray-600 mb-6">
                        アカウント削除などの重要な操作を行うには、本人確認のため再ログインが必要です。
                    </p>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start gap-2">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {isGoogle ? (
                        <div className="space-y-4">
                            <button
                                onClick={handleGoogleReauth}
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm"
                            >
                                {isLoading ? (
                                    <Loader2 className="animate-spin" size={20} />
                                ) : (
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            fill="#4285F4"
                                        />
                                        <path
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            fill="#34A853"
                                        />
                                        <path
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                            fill="#FBBC05"
                                        />
                                        <path
                                            d="M12 4.63c1.69 0 3.26.58 4.54 1.8l3.49-3.49C17.73.95 15.18 0 12 0 7.7 0 3.99 2.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                            fill="#EA4335"
                                        />
                                    </svg>
                                )}
                                Googleで再ログイン
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handlePasswordReauth} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    メールアドレス
                                </label>
                                <input
                                    type="email"
                                    value={user.email || ''}
                                    disabled
                                    className="w-full px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-500 cursor-not-allowed"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    パスワード
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="パスワードを入力"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors shadow-sm disabled:opacity-70 flex items-center justify-center"
                            >
                                {isLoading ? (
                                    <Loader2 className="animate-spin mr-2" size={20} />
                                ) : null}
                                再ログインして続行
                            </button>
                        </form>
                    )}
                </div>
                <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="text-sm text-gray-600 hover:text-gray-900 font-medium px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
}
