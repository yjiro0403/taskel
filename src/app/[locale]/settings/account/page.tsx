'use client';

import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { updateProfile } from 'firebase/auth';
import { auth, storage, db } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { User, Save, Loader2, ArrowLeft, Camera, Trash2, Edit2, AlertTriangle } from 'lucide-react'; // Added icons
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { writeBatch, collection, query, getDocs } from 'firebase/firestore'; // For delete account

import LeftSidebar from '@/components/LeftSidebar';
import PageHeader from '@/components/PageHeader';

export default function AccountSettingsPage() {
    const { user, setUser, toggleLeftSidebar } = useStore(); // toggleLeftSidebar needed for logout/delete
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
            setUser({ ...user, displayName }); // Update store
            setMessage({ type: 'success', text: 'Name updated.' });
            setIsEditingName(false);
        } catch (error) {
            console.error("Error updating name:", error);
            setMessage({ type: 'error', text: 'Failed to update name.' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        // Basic validation
        if (!file.type.startsWith('image/')) {
            setMessage({ type: 'error', text: 'Please upload an image file.' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB
            setMessage({ type: 'error', text: 'Image size should be less than 5MB.' });
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
            setUser({ ...user, photoURL: downloadURL }); // Update store

            // Also update Firestore user document to keep it in sync
            const { doc, setDoc } = await import('firebase/firestore');
            await setDoc(doc(db, 'users', user.uid), { photoURL: downloadURL }, { merge: true });

            setMessage({ type: 'success', text: 'Profile photo updated.' });

            // Delete old image if it exists and is hosted on Firebase Storage
            if (oldPhotoURL && oldPhotoURL.includes('firebasestorage.googleapis.com')) {
                try {
                    // Create a reference to the file to delete
                    const oldRef = ref(storage, oldPhotoURL);
                    await deleteObject(oldRef);
                } catch (delError) {
                    console.warn("Failed to delete old profile image:", delError);
                    // Non-blocking error, user doesn't need to know
                }
            }

        } catch (error) {

            console.error("Error uploading image:", error);
            setMessage({ type: 'error', text: 'Failed to upload image.' });
        } finally {
            setIsUploadingImage(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!user) return;
        if (!window.confirm("Are you sure you want to delete your account? This cannot be undone.")) return;

        setIsLoading(true);
        try {
            const batch = writeBatch(db);
            // Delete all tasks
            const q = query(collection(db, 'users', user.uid, 'tasks'));
            const snapshot = await getDocs(q);
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            await user.delete();
            router.push('/');
            // toggleLeftSidebar(); // Might not need to toggle if we are navigating away
        } catch (e) {
            console.error("Error deleting account", e);
            alert("Failed to delete account. You might need to re-login.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <LeftSidebar />
            <PageHeader />
            <div className="min-h-screen bg-white">
                <div className="max-w-3xl mx-auto p-6 md:p-12">
                    <Link
                        href="/tasks"
                        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 transition-colors mb-8 group"
                    >
                        <ArrowLeft size={16} className="mr-1 group-hover:-translate-x-1 transition-transform" />
                        Back to Tasks
                    </Link>

                    {/* Header Section: Avatar & Name */}
                    <div className="flex flex-col items-center md:flex-row md:items-start gap-8 mb-12">
                        {/* Avatar */}
                        <div className="relative group">
                            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-lg bg-gray-100 flex items-center justify-center">
                                {user?.photoURL ? (
                                    <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                                ) : (
                                    <User size={48} className="text-gray-400" />
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingImage}
                                className="absolute bottom-1 right-1 p-2 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 transition-colors disabled:opacity-70"
                            >
                                {isUploadingImage ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>

                        {/* Name & Basic Info */}
                        <div className="flex-1 text-center md:text-left pt-2">
                            <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                                {isEditingName ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            className="text-2xl font-bold text-gray-900 border-b-2 border-blue-500 focus:outline-none bg-transparent px-1 min-w-[200px]"
                                            autoFocus
                                            onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                                        />
                                        <button
                                            onClick={handleNameSave}
                                            disabled={isLoading}
                                            className="p-1 text-green-600 hover:bg-green-50 rounded-full"
                                        >
                                            <Save size={20} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="text-3xl font-bold text-gray-900">
                                            {displayName || 'No Name Set'}
                                        </h1>
                                        <button
                                            onClick={() => setIsEditingName(true)}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                        >
                                            <Edit2 size={18} />
                                        </button>
                                    </>
                                )}
                            </div>
                            <p className="text-gray-500 text-lg">{user?.email}</p>

                            {message && (
                                <div className={`mt-4 inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                    {message.text}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-gray-100 my-8"></div>

                    {/* Account Actions / Danger Zone */}
                    <div className="space-y-6">
                        <h3 className="text-lg font-semibold text-gray-900">Account Management</h3>

                        <div className="bg-red-50 border border-red-100 rounded-xl p-6 flex flex-col md:flex-row items-center md:items-center justify-between gap-4">
                            <div>
                                <h4 className="font-medium text-red-900 mb-1 flex items-center gap-2">
                                    <AlertTriangle size={18} />
                                    Delete Account
                                </h4>
                                <p className="text-sm text-red-700/80">
                                    Permanently delete your account and all associated data. This action cannot be undone.
                                </p>
                            </div>
                            <button
                                onClick={handleDeleteAccount}
                                disabled={isLoading}
                                className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all text-sm font-medium shadow-sm whitespace-nowrap"
                            >
                                {isLoading ? 'Deleting...' : 'Delete Account'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
