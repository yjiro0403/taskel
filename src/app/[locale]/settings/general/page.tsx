'use client';

import SettingsLayout from '@/components/SettingsLayout';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { Globe } from 'lucide-react';
import clsx from 'clsx';

const languages = [
    { code: 'ja', label: '日本語', flag: '🇯🇵' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
];

export default function GeneralSettingsPage() {
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();

    const handleLanguageChange = (newLocale: string) => {
        // 現在のパスを維持しながらロケールを変更
        router.replace(pathname, { locale: newLocale as 'ja' | 'en' });
    };

    return (
        <SettingsLayout>
            <div className="space-y-8">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 mb-1">一般設定</h2>
                    <p className="text-sm text-gray-500">アプリの基本的な設定を変更できます。</p>
                </div>

                {/* 言語設定 */}
                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Globe size={20} className="text-gray-600" />
                            <h3 className="font-semibold text-gray-900">言語 / Language</h3>
                        </div>
                    </div>
                    <div className="p-6">
                        <p className="text-sm text-gray-600 mb-4">
                            アプリの表示言語を選択してください。
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {languages.map((lang) => (
                                <button
                                    key={lang.code}
                                    onClick={() => handleLanguageChange(lang.code)}
                                    className={clsx(
                                        "flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left",
                                        locale === lang.code
                                            ? "border-blue-500 bg-blue-50 shadow-sm"
                                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                                    )}
                                >
                                    <span className="text-2xl">{lang.flag}</span>
                                    <div>
                                        <span className={clsx(
                                            "font-medium",
                                            locale === lang.code ? "text-blue-700" : "text-gray-900"
                                        )}>
                                            {lang.label}
                                        </span>
                                        {locale === lang.code && (
                                            <span className="ml-2 text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                                選択中
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </SettingsLayout>
    );
}
