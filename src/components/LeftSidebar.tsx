'use client';

import { useStore } from '@/store/useStore';
import { X, Calendar, Repeat, LogOut, Trash2, Settings, Briefcase, BarChart, ListTodo, CalendarRange, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, query, getDocs, writeBatch } from 'firebase/firestore';
import clsx from 'clsx';
import SectionSettingsModal from './SectionSettingsModal';
import UserGuideButton from './UserGuideButton';
import ProductSwitcher from './ProductSwitcher';
import { useState } from 'react';

export default function LeftSidebar() {
    const { isLeftSidebarOpen, toggleLeftSidebar, user } = useStore();
    const [isSectionSettingsOpen, setIsSectionSettingsOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();

    const getLinkClass = (path: string) => clsx(
        "flex items-center gap-3 p-2 rounded-lg transition-colors",
        pathname === path
            ? "bg-blue-100 text-blue-700 font-medium"
            : "text-gray-700 hover:text-blue-600 hover:bg-blue-50"
    );

    const handleDeleteAccount = async () => {
        if (!user) return;
        if (!window.confirm("Are you sure you want to delete your account? This cannot be undone.")) return;

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
            toggleLeftSidebar(); // Close sidebar
        } catch (e) {
            console.error("Error deleting account", e);
            alert("Failed to delete account. You might need to re-login.");
        }
    };

    return (
        <>
            {/* Backdrop */}
            {isLeftSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/20 z-40"
                    onClick={toggleLeftSidebar}
                />
            )}

            {/* Sidebar */}
            <div className={clsx(
                "fixed top-0 left-0 h-full w-64 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out",
                isLeftSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* ... header ... */}
                <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="font-semibold text-lg text-gray-800">Menu</h2>
                    <button
                        onClick={toggleLeftSidebar}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 space-y-6">
                    {/* Product Switcher */}
                    <ProductSwitcher user={user} onDeleteAccount={handleDeleteAccount} />

                    {/* Navigation */}
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Navigation</p>
                        <Link
                            href="/tasks"
                            className={getLinkClass('/tasks')}
                            onClick={toggleLeftSidebar}
                        >
                            <ListTodo size={18} />
                            <span>Task List</span>
                        </Link>
                        <Link
                            href="/projects"
                            className={getLinkClass('/projects')}
                            onClick={toggleLeftSidebar}
                        >
                            <Briefcase size={18} />
                            <span>Project List</span>
                        </Link>

                        <Link
                            href="/planning"
                            className={getLinkClass('/planning')}
                            onClick={toggleLeftSidebar}
                        >
                            <CalendarRange size={18} />
                            <span>Planning</span>
                        </Link>
                        <Link
                            href="/routines"
                            className={getLinkClass('/routines')}
                            onClick={toggleLeftSidebar}
                        >
                            <Repeat size={18} />
                            <span>Routine Management</span>
                        </Link>
                        <Link
                            href="/analytics"
                            className={getLinkClass('/analytics')}
                            onClick={toggleLeftSidebar}
                        >
                            <BarChart size={18} />
                            <span>Analytics</span>
                        </Link>

                        {/* 
                        <button
                            onClick={async () => {
                                if (!confirm("Migrate your private tasks to the new unified storage? This is safe and copies data.")) return;
                                const { migrateTasks } = useStore.getState();
                                const result = await migrateTasks();
                                alert(result.message);
                            }}
                            className="w-full flex items-center gap-3 text-amber-600 hover:text-amber-700 hover:bg-amber-50 p-2 rounded-lg transition-colors text-left"
                        >
                            <Settings size={18} />
                            <span>Migrate Data (Fix)</span>
                        </button>
                        */}

                        <button
                            onClick={() => {
                                setIsSectionSettingsOpen(true);
                                toggleLeftSidebar();
                            }}
                            className="w-full flex items-center gap-3 text-gray-700 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition-colors text-left"
                        >
                            <Settings size={18} />
                            <span>Section Settings</span>
                        </button>


                        <div className="pt-4 border-t border-gray-100">
                            <UserGuideButton onClick={toggleLeftSidebar} />
                        </div>

                        <div className="pt-2 flex flex-col gap-1">
                            <Link
                                href="/terms"
                                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                                onClick={toggleLeftSidebar}
                            >
                                利用規約
                            </Link>
                            <Link
                                href="/privacy"
                                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                                onClick={toggleLeftSidebar}
                            >
                                プライバシーポリシー
                            </Link>
                        </div>
                    </div>
                </div >
            </div >

            <SectionSettingsModal
                isOpen={isSectionSettingsOpen}
                onClose={() => setIsSectionSettingsOpen(false)}
            />
        </>
    );
}
