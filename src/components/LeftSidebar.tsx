'use client';

import { useStore } from '@/store/useStore';
import { X, Calendar, Repeat, LogOut, Trash2, Settings, Briefcase, BarChart, ListTodo, CalendarRange, CalendarDays, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import clsx from 'clsx';
import UserGuideButton from './UserGuideButton';
import ProductSwitcher from './ProductSwitcher';

import { useTranslations } from 'next-intl';

export default function LeftSidebar() {
    const t = useTranslations('Sidebar');
    const tNav = useTranslations('Navigation');
    const tSearch = useTranslations('Search');
    const { isLeftSidebarOpen, toggleLeftSidebar, user, openSearchModal } = useStore();
    const router = useRouter();
    const pathname = usePathname();

    const getLinkClass = (path: string) => clsx(
        "flex items-center gap-3 p-2 rounded-lg transition-colors",
        pathname === path
            ? "bg-blue-100 text-blue-700 font-medium"
            : "text-gray-700 hover:text-blue-600 hover:bg-blue-50"
    );

    const handleDeleteAccount = async () => {
        alert('Supabase Auth のアカウント削除フローは未実装です。');
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
                    <h2 className="font-semibold text-lg text-gray-800">{t('menu')}</h2>
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
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('navigation')}</p>
                        <button
                            type="button"
                            className="flex w-full items-center gap-3 p-2 rounded-lg transition-colors text-gray-700 hover:text-blue-600 hover:bg-blue-50"
                            onClick={() => {
                                toggleLeftSidebar();
                                openSearchModal();
                            }}
                        >
                            <Search size={18} />
                            <span>{tSearch('open_button')}</span>
                        </button>
                        <Link
                            href="/tasks"
                            className={getLinkClass('/tasks')}
                            onClick={toggleLeftSidebar}
                        >
                            <ListTodo size={18} />
                            <span>{t('task_list')}</span>
                        </Link>
                        <Link
                            href="/projects"
                            className={getLinkClass('/projects')}
                            onClick={toggleLeftSidebar}
                        >
                            <Briefcase size={18} />
                            <span>{t('project_list')}</span>
                        </Link>

                        <Link
                            href="/planning"
                            className={getLinkClass('/planning')}
                            onClick={toggleLeftSidebar}
                        >
                            <CalendarRange size={18} />
                            <span>{t('planning')}</span>
                        </Link>
                        <Link
                            href="/routines"
                            className={getLinkClass('/routines')}
                            onClick={toggleLeftSidebar}
                        >
                            <Repeat size={18} />
                            <span>{t('routine_management')}</span>
                        </Link>
                        <Link
                            href="/analytics"
                            className={getLinkClass('/analytics')}
                            onClick={toggleLeftSidebar}
                        >
                            <BarChart size={18} />
                            <span>{t('analytics')}</span>
                        </Link>
                        <Link
                            href="/settings/general"
                            className={getLinkClass('/settings')}
                            onClick={toggleLeftSidebar}
                        >
                            <Settings size={18} />
                            <span>{t('settings')}</span>
                        </Link>


                        <div className="pt-4 border-t border-gray-100">
                            <UserGuideButton onClick={toggleLeftSidebar} />
                        </div>

                        <div className="pt-2 flex flex-col gap-1">
                            <Link
                                href="/terms"
                                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                                onClick={toggleLeftSidebar}
                            >
                                {tNav('terms')}
                            </Link>
                            <Link
                                href="/privacy"
                                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 transition-colors"
                                onClick={toggleLeftSidebar}
                            >
                                {tNav('privacy')}
                            </Link>
                        </div>
                    </div>
                </div >
            </div>
        </>
    );
}
