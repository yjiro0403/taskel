'use client';

import SettingsLayout from '@/components/SettingsLayout';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { CalendarClock, Globe, JapaneseYen } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import SettingsToggle from '@/components/SettingsToggle';

const languages = [
    { code: 'ja', label: '日本語', flag: '🇯🇵' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
];

export default function GeneralSettingsPage() {
    const locale = useLocale();
    const tFinance = useTranslations('Finance');
    const tTimeline = useTranslations('Timeline');
    const router = useRouter();
    const pathname = usePathname();
    const financeEnabled = useStore((state) => state.financeEnabled);
    const financePreferenceLoaded = useStore((state) => state.financePreferenceLoaded);
    const financePreferenceSaving = useStore((state) => state.financePreferenceSaving);
    const setFinanceEnabled = useStore((state) => state.setFinanceEnabled);
    const timelineEnabled = useStore((state) => state.timelineEnabled);
    const hideEmptyIntervals = useStore((state) => state.hideEmptyIntervals);
    const uiPreferencesLoaded = useStore((state) => state.uiPreferencesLoaded);
    const uiPreferencesSaving = useStore((state) => state.uiPreferencesSaving);
    const setTimelineEnabled = useStore((state) => state.setTimelineEnabled);
    const setHideEmptyIntervals = useStore((state) => state.setHideEmptyIntervals);
    const showToast = useStore((state) => state.showToast);

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

                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <JapaneseYen size={20} className="text-gray-600" />
                            <h3 className="font-semibold text-gray-900">{tFinance('settingsTitle')}</h3>
                        </div>
                    </div>
                    <div className="p-6 space-y-4">
                        <p className="text-sm text-gray-600">{tFinance('settingsDescription')}</p>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={financeEnabled}
                            aria-label={tFinance('settingsToggleLabel')}
                            disabled={!financePreferenceLoaded || financePreferenceSaving}
                            onClick={async () => {
                                const saved = await setFinanceEnabled(!financeEnabled);
                                if (!saved) {
                                    showToast(tFinance('settingsSaveError'), 'error');
                                }
                            }}
                            className="flex items-center justify-between w-full gap-4 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed text-left"
                        >
                            <div>
                                <p className="font-medium text-gray-900">{tFinance('settingsToggleLabel')}</p>
                                <p className="text-sm text-gray-500 mt-1">
                                    {financeEnabled ? tFinance('settingsToggleHintOn') : tFinance('settingsToggleHintOff')}
                                </p>
                            </div>
                            <div
                                className={clsx(
                                    'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                                    financeEnabled ? 'bg-blue-600' : 'bg-gray-300'
                                )}
                            >
                                <div
                                    className={clsx(
                                        'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                                        financeEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                                    )}
                                />
                            </div>
                        </button>
                        <p className="text-xs text-gray-400">{tFinance('settingsEntitlementNote')}</p>
                    </div>
                </section>

                <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                        <div className="flex items-center gap-3">
                            <CalendarClock size={20} className="text-gray-600" />
                            <h3 className="font-semibold text-gray-900">{tTimeline('settingsTitle')}</h3>
                        </div>
                    </div>
                    <div className="p-6 space-y-4">
                        <p className="text-sm text-gray-600">{tTimeline('settingsDescription')}</p>
                        <SettingsToggle
                            checked={timelineEnabled}
                            disabled={!uiPreferencesLoaded || uiPreferencesSaving}
                            label={tTimeline('settingsToggleLabel')}
                            hint={timelineEnabled ? tTimeline('settingsToggleHintOn') : tTimeline('settingsToggleHintOff')}
                            ariaLabel={tTimeline('settingsToggleLabel')}
                            onToggle={async () => {
                                const saved = await setTimelineEnabled(!timelineEnabled);
                                if (!saved) showToast(tTimeline('settingsSaveError'), 'error');
                            }}
                        />
                        <div>
                            <p className="text-sm font-medium text-gray-900 mb-1">{tTimeline('hideEmptyTitle')}</p>
                            <p className="text-sm text-gray-600 mb-3">{tTimeline('hideEmptyDescription')}</p>
                            <SettingsToggle
                                checked={hideEmptyIntervals}
                                disabled={!uiPreferencesLoaded || uiPreferencesSaving}
                                label={tTimeline('hideEmptyTitle')}
                                hint={hideEmptyIntervals ? tTimeline('hideEmptyOn') : tTimeline('hideEmptyOff')}
                                ariaLabel={tTimeline('hideEmptyTitle')}
                                onToggle={async () => {
                                    const saved = await setHideEmptyIntervals(!hideEmptyIntervals);
                                    if (!saved) showToast(tTimeline('settingsSaveError'), 'error');
                                }}
                            />
                        </div>
                    </div>
                </section>
            </div>
        </SettingsLayout>
    );
}
