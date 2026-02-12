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
import ReauthModal from './ReauthModal';

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

    const [showReauthModal, setShowReauthModal] = useState(false);

    // ... existing handlers ...



    const deleteAccountLogic = async () => {
        if (!user) return;
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
        } catch (e: any) {
            console.error("Error deleting account", e);
            if (e.code === 'auth/requires-recent-login') {
                setShowReauthModal(true);
                // Don't show alert here, simply show modal
            } else {
                alert("アカウントの削除に失敗しました。再ログインが必要な場合があります。");
            }
        } finally {
            setIsLoading(false);
        }
    }

    const onDeleteClick = async () => {
        if (!window.confirm("本当にアカウントを削除しますか？この操作は取り消せません。")) return;
        await deleteAccountLogic();
    };

    const handleReauthSuccess = async () => {
        setShowReauthModal(false);
        await deleteAccountLogic();
    };

    return (
        <SettingsLayout>
            <div className="space-y-8">
                {/* ... existing UI ... */}

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
                            onClick={onDeleteClick}
                            disabled={isLoading}
                            className="px-4 py-2 bg-white border border-red-400 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all text-sm font-medium shadow-sm"
                        >
                            {isLoading ? '削除中...' : 'アカウントを削除'}
                        </button>
                    </div>
                </section>
            </div>

            {user && (
                <ReauthModal
                    isOpen={showReauthModal}
                    onClose={() => setShowReauthModal(false)}
                    onReauthSuccess={handleReauthSuccess}
                    user={user}
                />
            )}
        </SettingsLayout>
    );
}


