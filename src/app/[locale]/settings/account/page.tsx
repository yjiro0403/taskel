'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { updateProfile } from 'firebase/auth';
import { auth, storage, db } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { User, Save, Loader2, Camera, Trash2, Edit2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { writeBatch, collection, query, getDocs } from 'firebase/firestore';

import SettingsLayout from '@/components/SettingsLayout';

export default function AccountSettingsPage() {
    const { user, setUser } = useStore();
    const router = useRouter();

    // State
    const [displayName, setDisplayName] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initial Load
    useEffect(() => {
        if (user) {
            setDisplayName(user.displayName || '');
        }
    }, [user]);

    // Handlers
    const handleNameSave = async () => {
        if (!user) return;
        setMessage(null);
        setIsLoading(true);
        try {
            await updateProfile(user, { displayName });
            setUser({ ...user, displayName });
            setMessage({ type: 'success', text: '名前を更新しました。' });
            setIsEditingName(false);
        } catch (error) {
            console.error("Error updating name:", error);
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
        if (file.size > 5 * 1024 * 1024) {
            setMessage({ type: 'error', text: '画像サイズは5MB以下にしてください。' });
            return;
        }

        setIsUploadingImage(true);
        setMessage(null);

        const oldPhotoURL = user.photoURL;

        try {
            const storageRef = ref(storage, `users/${user.uid}/profile_${Date.now()}`);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            await updateProfile(user, { photoURL: downloadURL });
            setUser({ ...user, photoURL: downloadURL });

            const { doc, setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid), { photoURL: downloadURL }, { merge: true });

            setMessage({ type: 'success', text: 'プロフィール画像を更新しました。' });

            if (oldPhotoURL && oldPhotoURL.includes('firebasestorage.googleapis.com')) {
                try {
                    const oldRef = ref(storage, oldPhotoURL);
                    await deleteObject(oldRef);
                } catch (delError) {
                    console.warn("Failed to delete old profile image:", delError);
                }
            }
        } catch (error) {
            console.error("Error uploading image:", error);
            setMessage({ type: 'error', text: '画像のアップロードに失敗しました。' });
        } finally {
            setIsUploadingImage(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user) return;
        if (!window.confirm("本当にアカウントを削除しますか？この操作は取り消せません。")) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            const q = query(collection(db, 'users', user.uid, 'tasks'));
            const snapshot = await getDocs(q);
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            await user.delete();
            router.push('/');
        } catch (e) {
            console.error("Error deleting account", e);
            alert("アカウントの削除に失敗しました。再ログインが必要な場合があります。");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <SettingsLayout>
            <div className="space-y-8">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">アカウント設定</h2>
                    <p className="text-sm text-gray-500">プロフィール情報の編集やアカウントの管理ができます。</p>
                </div>

                {/* プロフィールセクション */}
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <h3 className="font-semibold text-gray-900">プロフィール</h3>
                    </div>
                    <div className="p-6">
                        <div className="flex flex-col sm:flex-row items-center gap-6">
                            {/* アバター */}
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg bg-gray-100 flex items-center justify-center">
                                    {user?.photoURL ? (
                                        <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={36} className="text-gray-400" />
                                    )}
                                </div>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploadingImage}
                                    className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition-colors disabled:opacity-70"
                                >
                                    {isUploadingImage ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                />
                            </div>

                            {/* 名前とメール */}
                            <div className="flex-1 text-center sm:text-left">
                                <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                                    {isEditingName ? (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={displayName}
                                                onChange={(e) => setDisplayName(e.target.value)}
                                                className="text-xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent px-1"
                                                autoFocus
                                                onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                                            />
                                            <button
                                                onClick={handleNameSave}
                                                disabled={isLoading}
                                                className="p-1 text-green-600 hover:bg-green-50 rounded-full"
                                            >
                                                <Save size={18} />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <h4 className="text-xl font-bold text-gray-900">
                                                {displayName || '名前未設定'}
                                            </h4>
                                            <button
                                                onClick={() => setIsEditingName(true)}
                                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                        </>
                                    )}
                                </div>
                                <p className="text-gray-500">{user?.email}</p>
                            </div>
                        </div>

                        {message && (
                            <div className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                }`}>
                                {message.text}
                            </div>
                        )}
                    </div>
                </section>

                {/* 危険な操作 */}
                <section className="bg-red-50 rounded-xl border border-red-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-red-100">
                        <div className="flex items-center gap-2 text-red-800">
                            <AlertTriangle size={18} />
                            <h3 className="font-semibold">アカウント削除</h3>
                        </div>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-red-700 mb-4">
                            アカウントと関連するすべてのデータが完全に削除されます。この操作は取り消せません。
                        </p>
                        <button
                            onClick={handleDeleteAccount}
                            disabled={isLoading}
                            className="px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all text-sm font-medium shadow-sm"
                        >
                            {isLoading ? '削除中...' : 'アカウントを削除'}
                        </button>
                    </div>
                </section>
            </div>
        </SettingsLayout>
    );
}
