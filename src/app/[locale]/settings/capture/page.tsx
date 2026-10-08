'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';

import SettingsLayout from '@/components/SettingsLayout';
import { fetchScheduleSettings, saveScheduleSettingsRequest } from '@/lib/schedule/apiClient';
import type { ScheduleSettings } from '@/lib/schedule/types';

export default function CaptureSettingsPage() {
    const [settings, setSettings] = useState<ScheduleSettings | null>(null);
    const [billingAcknowledged, setBillingAcknowledged] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchScheduleSettings()
            .then((result) => {
                setSettings(result.settings);
                setBillingAcknowledged(result.billingAcknowledged);
            })
            .catch(() => setMessage('設定を読めませんでした。'));
    }, []);

    const save = async () => {
        if (!settings) return;
        setSaving(true);
        setMessage(null);
        try {
            setSettings(await saveScheduleSettingsRequest(settings));
            setMessage('保存しました。');
        } catch {
            setMessage('保存できませんでした。カレンダーIDを確認してください。');
        } finally {
            setSaving(false);
        }
    };

    return (
        <SettingsLayout>
            <div className="max-w-2xl space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">予定の取り込み</h2>
                <p className="text-sm text-gray-600">
                    画像や文章から予定を作り、TaskelのタスクとGoogleカレンダーを同じ内容で結びます。
                    日時が曖昧なときは自動登録しません。初期状態では、条件が揃っていても人が登録ボタンを押します。
                </p>
                <p className="text-sm text-gray-600">
                    <Link href="/intake" className="text-blue-700">受信箱を開く</Link>
                </p>
                {!billingAcknowledged && (
                    <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
                        サーバーの環境変数 SCHEDULE_INTAKE_AI_BILLING_ACK=true が必要です。無料枠のGeminiは入力を製品改善に使うため、顧客名や会話の画像を送る前に、課金済みのAPIキーであることを確認してからこの値を入れてください。
                    </p>
                )}
                {settings && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                        <label className="flex items-start gap-3 text-sm text-gray-800">
                            <input
                                type="checkbox"
                                className="mt-1"
                                checked={settings.autoRegister}
                                onChange={(event) => setSettings({ ...settings, autoRegister: event.target.checked })}
                            />
                            <span>
                                条件がすべて揃った1件だけ自動登録する
                                <span className="block text-gray-500">年月日、開始、終了が明示され、矛盾がない場合だけです。オフのあいだは抽出のみ行います。</span>
                            </span>
                        </label>
                        <label className="block text-sm text-gray-700">画像と文章を残す日数
                            <input
                                type="number"
                                min={1}
                                max={365}
                                className="mt-1 w-32 border border-gray-200 rounded-lg px-3 py-2"
                                value={settings.retentionDays}
                                onChange={(event) => setSettings({ ...settings, retentionDays: Number(event.target.value) })}
                            />
                        </label>
                        <label className="block text-sm text-gray-700">登録先カレンダー ID
                            <input
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2"
                                value={settings.calendarId}
                                onChange={(event) => setSettings({ ...settings, calendarId: event.target.value })}
                            />
                            <span className="block text-gray-500 mt-1">空にせず、primary またはカレンダーIDです。AIはこの値を変えません。</span>
                        </label>
                        <label className="block text-sm text-gray-700">終了時刻が無いときの提案（分）
                            <input
                                type="number"
                                min={5}
                                max={1440}
                                className="mt-1 w-32 border border-gray-200 rounded-lg px-3 py-2"
                                value={settings.defaultDurationMinutes ?? ''}
                                onChange={(event) => setSettings({
                                    ...settings,
                                    defaultDurationMinutes: event.target.value === '' ? null : Number(event.target.value),
                                })}
                            />
                            <span className="block text-gray-500 mt-1">確認画面の初期値にだけ使います。自動登録の終了時刻には使いません。</span>
                        </label>
                        <button type="button" className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60" disabled={saving} onClick={save}>
                            {saving ? '保存中…' : '保存'}
                        </button>
                    </div>
                )}
                {message && <p className="text-sm text-gray-700">{message}</p>}
            </div>
        </SettingsLayout>
    );
}
