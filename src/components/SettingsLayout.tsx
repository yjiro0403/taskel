'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { Menu, Settings, Calendar, User, ArrowLeft } from 'lucide-react';
import { useStore } from '@/store/useStore';
import LeftSidebar from './LeftSidebar';
import clsx from 'clsx';

interface SettingsLayoutProps {
    children: ReactNode;
}

const settingsNav = [
    { href: '/settings/general', label: '一般', icon: Settings },
    { href: '/settings/account', label: 'アカウント', icon: User },
    { href: '/settings/schedule', label: 'セクション', icon: Calendar },
];

export default function SettingsLayout({ children }: SettingsLayoutProps) {
    const pathname = usePathname();
    const { toggleLeftSidebar } = useStore();

    // ロケールを除去したパスを取得
    const normalizedPath = pathname.replace(/^\/(en|ja)/, '') || '/';

    const isActive = (href: string) => normalizedPath === href || normalizedPath.startsWith(href + '/');

    return (
        <>
            <LeftSidebar />

            <div className="min-h-screen bg-gray-50">
                {/* ヘッダー */}
                <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
                    <div className="flex items-center gap-4 px-4 h-14">
                        <button
                            onClick={toggleLeftSidebar}
                            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            aria-label="メニューを開く"
                        >
                            <Menu size={20} />
                        </button>
                        <Link
                            href="/tasks"
                            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
                        >
                            <ArrowLeft size={16} />
                            <span>戻る</span>
                        </Link>
                        <h1 className="text-lg font-semibold text-gray-900">設定</h1>
                    </div>
                </header>

                <div className="flex">
                    {/* サイドナビゲーション */}
                    <aside className="w-56 min-h-[calc(100vh-3.5rem)] bg-white border-r border-gray-200 p-4 hidden md:block">
                        <nav className="space-y-1">
                            {settingsNav.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={clsx(
                                            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                            isActive(item.href)
                                                ? "bg-blue-50 text-blue-700"
                                                : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                                        )}
                                    >
                                        <Icon size={18} />
                                        {item.label}
                                    </Link>
                                );
                            })}
                        </nav>
                    </aside>

                    {/* モバイル用タブナビゲーション */}
                    <div className="md:hidden w-full bg-white border-b border-gray-200">
                        <nav className="flex">
                            {settingsNav.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={clsx(
                                            "flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium border-b-2 transition-colors",
                                            isActive(item.href)
                                                ? "border-blue-600 text-blue-700 bg-blue-50/50"
                                                : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                                        )}
                                    >
                                        <Icon size={16} />
                                        <span className="hidden sm:inline">{item.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>

                    {/* メインコンテンツ */}
                    <main className="flex-1 p-6 md:p-8">
                        <div className="max-w-3xl">
                            {children}
                        </div>
                    </main>
                </div>
            </div>
        </>
    );
}
