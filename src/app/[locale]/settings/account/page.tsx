'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

import SettingsLayout from '@/components/SettingsLayout';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';

export default function AccountSettingsPage() {
    const { user, setUser } = useStore();
    const [displayName, setDisplayName] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (user) {
            setDisplayName(user.displayName || '');
        }
    }, [user]);

    const handleNameSave = async () => {
        if (!user) return;
        setMessage(null);
        setIsLoading(true);

        try {
            const supabase = createClient();
            const { error: authError } = await supabase.auth.updateUser({
                data: { display_name: displayName },
            });
            if (authError) throw authError;

            const { error: profileError } = await supabase
                .from('profiles')
                .update({ display_name: displayName })
                .eq('id', user.uid);
            if (profileError) throw profileError;

            setUser({ ...user, displayName });
            setMessage({ type: 'success', text: '名前を更新しました。' });
            setIsEditingName(false);
        } catch (error) {
            console.error('Error updating name:', error);
            setMessage({ type: 'error', text: '名前の更新に失敗しました。' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        if (!file.type.startsWith('image/')) {
            setMessage({ type: 'error', text: '画像ファイルをアップロードしてください。' });
            return;
        }

        setIsUploadingImage(true);
        setMessage(null);

        try {
            const supabase = createClient();
            const ext = file.name.split('.').pop() || 'png';
            // avatars バケットは public。パスの第1階層を uid にして、書き込みRLS
            // 「本人フォルダ（(storage.foldername(name))[1] = auth.uid()）のみ許可」に一致させる。
            // 読み取りは公開（他ユーザーのメンバー一覧等でも <img src> でそのまま表示するため public を維持）。
            const path = `${user.uid}/profile_${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
                upsert: true,
            });
            if (uploadError) throw uploadError;

            // public バケットのため getPublicUrl の恒久URLをそのまま profiles/auth メタに保存する。
            const { data } = supabase.storage.from('avatars').getPublicUrl(path);
            const photoURL = data.publicUrl;

            const { error: authError } = await supabase.auth.updateUser({
                data: { avatar_url: photoURL },
            });
            if (authError) throw authError;

            const { error: profileError } = await supabase
                .from('profiles')
                .update({ avatar_url: photoURL })
                .eq('id', user.uid);
            if (profileError) throw profileError;

            setUser({ ...user, photoURL });
            setMessage({ type: 'success', text: 'プロフィール画像を更新しました。' });
        } catch (error) {
            console.error('Error uploading image:', error);
            setMessage({ type: 'error', text: '画像のアップロードに失敗しました。' });
        } finally {
            setIsUploadingImage(false);
        }
    };

    const onDeleteClick = async () => {
        alert('Supabase Auth のアカウント削除フローは未実装です。管理者対応が必要です。');
    };

    return (
        <SettingsLayout>
            <div className="space-y-8">
                <section className="rounded-xl border border-gray-200 bg-white p-6">
                    <div className="mb-4">
                        <h2 className="font-semibold text-gray-900">プロフィール</h2>
                        <p className="text-sm text-gray-500">表示名とプロフィール画像を更新できます。</p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">表示名</label>
                            <div className="flex gap-2">
                                <input
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    disabled={!isEditingName}
                                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                />
                                {isEditingName ? (
                                    <button
                                        onClick={handleNameSave}
                                        disabled={isLoading}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                                    >
                                        保存
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setIsEditingName(true)}
                                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium"
                                    >
                                        編集
                                    </button>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">プロフィール画像</label>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleImageUpload}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingImage}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium"
                            >
                                {isUploadingImage ? 'アップロード中...' : '画像をアップロード'}
                            </button>
                        </div>

                        {message && (
                            <p className={message.type === 'success' ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
                                {message.text}
                            </p>
                        )}
                    </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-red-200 bg-red-50">
                    <div className="border-b border-red-100 px-6 py-4">
                        <div className="flex items-center gap-2 text-red-800">
                            <AlertTriangle size={18} />
                            <h3 className="font-semibold">アカウント削除</h3>
                        </div>
                    </div>
                    <div className="p-6">
                        <p className="mb-4 text-sm text-red-700">
                            Supabase 移行後の削除フローはまだ未実装です。必要なら管理者対応を追加します。
                        </p>
                        <button
                            onClick={onDeleteClick}
                            className="rounded-lg border border-red-400 bg-white px-4 py-2 text-sm font-medium text-red-600"
                        >
                            アカウント削除
                        </button>
                    </div>
                </section>
            </div>
        </SettingsLayout>
    );
}
