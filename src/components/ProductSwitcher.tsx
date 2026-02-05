'use client';

import { useState, useEffect, useRef } from 'react';
import { User as UserIcon, LogOut, Trash2, Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useRouter, usePathname } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { User } from 'firebase/auth';
import { useStore } from '@/store/useStore';

interface ProductSwitcherProps {
    user: User | null;
    onDeleteAccount: () => Promise<void>;
}

export default function ProductSwitcher({ user, onDeleteAccount }: ProductSwitcherProps) {
    const [isOpen, setIsOpen] = useState(false);
    const { toggleLeftSidebar } = useStore();
    const router = useRouter();
    const pathname = usePathname();
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const isTeam = pathname.startsWith('/projects');

    const handleSwitch = (mode: 'personal' | 'team') => {
        setIsOpen(false);
        if (mode === 'personal') router.push('/tasks');
        if (mode === 'team') router.push('/projects');
    };

    const handleLogout = async () => {
        await auth.signOut();
        router.push('/');
        toggleLeftSidebar();
        setIsOpen(false);
    };

    const handleDelete = async () => {
        await onDeleteAccount();
        setIsOpen(false);
    };

    return (
        <div className="relative mb-6" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200 group"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={clsx("flex-shrink-0 rounded-md text-white transition-colors overflow-hidden", isTeam ? "bg-purple-600 shadow-purple-200" : "bg-blue-600 shadow-blue-200", "shadow-sm", !user?.photoURL && "p-2")}>
                        {user?.photoURL ? (
                            <img src={user.photoURL} alt="Avatar" className="w-9 h-9 object-cover" />
                        ) : (
                            isTeam ? <UserIcon size={20} /> : <UserIcon size={20} />
                        )}
                    </div>
                    <div className="text-left overflow-hidden">
                        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">
                            {user?.displayName || 'Taskel'}
                        </div>
                        <div className="text-sm font-bold text-gray-900 leading-none truncate">
                            {user?.email || 'Personal'}
                        </div>
                    </div>
                </div>
                <ChevronDown size={16} className={clsx("text-gray-400 flex-shrink-0 transition-transform duration-200", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top">
                    {/* User Info / Profile Header (Optional, but looks nice) */}
                    <div className="p-3 border-b border-gray-100 bg-gray-50/50">
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Signed in as</div>
                        <div className="text-xs font-medium text-gray-900 truncate">{user?.email}</div>
                    </div>

                    {/* Actions */}
                    <div className="py-1">
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                router.push('/settings/account');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                            <UserIcon size={16} className="text-gray-500" />
                            <span className="text-sm text-gray-700">Account Settings</span>
                        </button>

                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                            <LogOut size={16} className="text-gray-500" />
                            <span className="text-sm text-gray-700">Log out</span>
                        </button>


                    </div>

                    {/* Team switching is temporarily hidden as per request */}
                    {/* 
                    <div className="border-t border-gray-100 pt-1">
                         ... team switch buttons ...
                    </div>
                    */}
                </div>
            )}
        </div>
    );
}
