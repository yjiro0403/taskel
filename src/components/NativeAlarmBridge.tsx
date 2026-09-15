'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, X } from 'lucide-react';

import { useStore } from '@/store/useStore';
import {
    checkNativeAlarmPermissions,
    drainNativeAlarmEvents,
    getNativeFcmToken,
    hasRequiredAlarmPermissions,
    isNativePlatform,
    requestNativeAlarmPermissions,
    syncAlarmsToNative,
    type NativeAlarmEvent,
    type NativeAlarmPermissionStatus,
} from '@/lib/native/taskelAlarm';

/** 同期ロックの有効期限。await が固まっても次回の試行を許可するための保険。 */
const SYNC_LOCK_TIMEOUT_MS = 30_000;
/** 個々のネットワーク/プラグイン呼び出しの上限。reject ではなく hang する経路への保険。 */
const STEP_TIMEOUT_MS = 15_000;

/**
 * 解決しない Promise で処理全体が止まるのを防ぐ。
 * fetch はネットワーク断のタイミング次第で reject せず宙吊りになることがあり、
 * その場合 finally が走らず同期ロックが永久に残る（= 以後アラームが同期されない）。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/**
 * サイドロード運用の実機調査用。WebView の DevTools から
 * `window.__taskelAlarmDebug` で同期の進行状況を確認できるようにする。
 */
interface AlarmDebugState {
    isNative?: boolean;
    userPresent?: boolean;
    alarmsLoaded?: boolean;
    lastRunNativeSyncAt?: string;
    lastFetchAlarmsAt?: string;
    lastSyncToNativeAt?: string;
    lastSyncedCount?: number;
    lockHeldSince?: string | null;
    lastError?: string;
    skipped?: string;
}

function debugAlarm(patch: AlarmDebugState): void {
    if (typeof window === 'undefined') return;
    const w = window as typeof window & { __taskelAlarmDebug?: AlarmDebugState };
    w.__taskelAlarmDebug = { ...(w.__taskelAlarmDebug ?? {}), ...patch };
}

/**
 * ネイティブの操作イベント1件を Supabase へ書き戻す（PATCH /api/alarms/[id]）。
 * - dismissed → status: 'dismissed'
 * - snoozed → fireAt: 端末で再計算された次回発火時刻
 * 404（サーバー側で削除済み）や失敗は無視する（次の全件リコンサイルで整合が取れる）。
 */
async function writeBackAlarmEvent(event: NativeAlarmEvent): Promise<void> {
    const updates =
        event.action === 'dismissed'
            ? { status: 'dismissed' as const }
            : event.action === 'snoozed' && typeof event.fireAt === 'number'
              ? { fireAt: event.fireAt }
              : null;
    if (!updates) return;

    try {
        const res = await fetch(`/api/alarms/${event.alarmId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!res.ok && res.status !== 404) {
            console.error(`writeBackAlarmEvent failed: ${res.status} (alarm=${event.alarmId})`);
        }
    } catch (error) {
        console.error('writeBackAlarmEvent request failed:', error);
    }
}

/**
 * Capacitor（Androidアプリ）環境でのみ動くブリッジ。layout で1度だけマウントする。
 * - ログイン後にアラームを取得し、Zustand の alarms 変更を購読して
 *   scheduled 全件をネイティブ（AlarmManager）へリコンサイル同期する
 * - ネイティブの停止/スヌーズイベントを回収して Supabase へ書き戻す（Phase C）
 * - FCM トークンを /api/device-tokens に登録する（Phase C）
 * - 通知 / exact alarm 権限が不足していれば案内バナーを表示する
 * Web ブラウザでは何も描画・実行しない。
 */
export function NativeAlarmBridge() {
    const t = useTranslations('NativeAlarm');
    const user = useStore((state) => state.user);
    const alarms = useStore((state) => state.alarms);
    const alarmsLoaded = useStore((state) => state.alarmsLoaded);
    const fetchAlarms = useStore((state) => state.fetchAlarms);

    // 初期レンダーは常に null（バナーなし）なので、SSR とのハイドレーション不一致は起きない
    const [isNative] = useState(() => isNativePlatform());
    const [needsPermission, setNeedsPermission] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // 進行中フラグは開始時刻で保持する（boolean だと hang 時に永久ロックになる）
    const syncStartedAtRef = useRef<number | null>(null);
    const tokenRegisteredRef = useRef(false);

    /**
     * ネイティブ⇄サーバーの往復同期。順序が重要:
     * 1. drainEvents → PATCH（端末の停止/スヌーズを先に Supabase へ反映）
     * 2. fetchAlarms（反映後の最新を取得 → 下の購読が全件リコンサイルでネイティブへ同期）
     * 3. FCM トークン登録（セッション中に一度成功すれば以後スキップ）
     * この順にしないと、書き戻し前の古い状態で端末側が上書きされて矛盾する。
     */
    const runNativeSync = useCallback(async () => {
        const startedAt = syncStartedAtRef.current;
        if (startedAt !== null && Date.now() - startedAt < SYNC_LOCK_TIMEOUT_MS) {
            debugAlarm({ skipped: `sync lock held since ${new Date(startedAt).toISOString()}` });
            return;
        }
        syncStartedAtRef.current = Date.now();
        debugAlarm({
            lastRunNativeSyncAt: new Date().toISOString(),
            lockHeldSince: new Date().toISOString(),
        });
        try {
            try {
                const events = await withTimeout(drainNativeAlarmEvents(), STEP_TIMEOUT_MS, 'drainEvents');
                for (const event of events) {
                    await withTimeout(writeBackAlarmEvent(event), STEP_TIMEOUT_MS, 'writeBackAlarmEvent');
                }
            } catch (error) {
                console.error('drainNativeAlarmEvents failed:', error);
                debugAlarm({ lastError: `drainEvents: ${String(error)}` });
            }

            try {
                await withTimeout(fetchAlarms(), STEP_TIMEOUT_MS, 'fetchAlarms');
                debugAlarm({ lastFetchAlarmsAt: new Date().toISOString() });
            } catch (error) {
                console.error('fetchAlarms failed:', error);
                debugAlarm({ lastError: `fetchAlarms: ${String(error)}` });
            }

            // 下の購読 effect の依存更新に頼らず、ここでも明示的に同期する。
            // 依存が変化しないケース（取得結果が前回と同一など）でも端末へ確実に反映させる。
            try {
                await withTimeout(
                    syncAlarmsToNative(useStore.getState().alarms),
                    STEP_TIMEOUT_MS,
                    'syncAlarmsToNative'
                );
            } catch (error) {
                console.error('syncAlarmsToNative failed:', error);
                debugAlarm({ lastError: `syncAlarmsToNative: ${String(error)}` });
            }

            if (!tokenRegisteredRef.current) {
                try {
                    const result = await withTimeout(getNativeFcmToken(), STEP_TIMEOUT_MS, 'getFcmToken');
                    // token が null = Firebase 未設定ビルド or 取得前。次回の同期で再試行する。
                    if (result?.token) {
                        const deviceName = result.deviceName?.trim();
                        const res = await withTimeout(
                            fetch('/api/device-tokens', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fcmToken: result.token,
                                    deviceName: deviceName ? deviceName.slice(0, 200) : null,
                                }),
                            }),
                            STEP_TIMEOUT_MS,
                            'device-tokens'
                        );
                        if (res.ok) {
                            tokenRegisteredRef.current = true;
                        } else {
                            console.error(`device-token registration failed: ${res.status}`);
                        }
                    }
                } catch (error) {
                    console.error('FCM token registration failed:', error);
                }
            }
        } finally {
            syncStartedAtRef.current = null;
            debugAlarm({ lockHeldSince: null });
        }
    }, [fetchAlarms]);

    // 初回ロード: ログイン確立後にイベント書き戻し→取得→トークン登録を実行
    // （取得後は下の購読でネイティブへ同期される）
    useEffect(() => {
        if (isNative && user) {
            void runNativeSync();
        }
    }, [isNative, user, runNativeSync]);

    // アプリがフォアグラウンドへ復帰したタイミングでも往復同期する
    // （アラーム停止/スヌーズ直後に WebView へ戻ったケースの書き戻し）
    useEffect(() => {
        if (!isNative || !user) return;
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            void runNativeSync();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [isNative, user, runNativeSync]);

    // 実機調査用: ガード条件の実値を常に window へ反映しておく
    useEffect(() => {
        debugAlarm({ isNative, userPresent: Boolean(user), alarmsLoaded });
    }, [isNative, user, alarmsLoaded]);

    // alarms の変更を購読し、変更のたびに全件リコンサイルでネイティブへ渡す
    useEffect(() => {
        if (!isNative || !alarmsLoaded) {
            debugAlarm({ skipped: `sync effect gated (isNative=${isNative}, alarmsLoaded=${alarmsLoaded})` });
            return;
        }
        syncAlarmsToNative(alarms)
            .then(() => {
                debugAlarm({
                    lastSyncToNativeAt: new Date().toISOString(),
                    lastSyncedCount: alarms.filter((alarm) => alarm.status === 'scheduled').length,
                });
            })
            .catch((error) => {
                console.error('syncAlarmsToNative failed:', error);
                debugAlarm({ lastError: `syncEffect: ${String(error)}` });
            });
    }, [isNative, alarmsLoaded, alarms, user]);

    // 権限状態をバナー表示可否へ反映する（非同期コールバックからのみ呼ぶ）
    const applyPermissionStatus = useCallback((status: NativeAlarmPermissionStatus | null) => {
        if (status) {
            setNeedsPermission(!hasRequiredAlarmPermissions(status));
        }
    }, []);

    useEffect(() => {
        if (!isNative) return;
        checkNativeAlarmPermissions()
            .then(applyPermissionStatus)
            .catch((error) => console.error('checkNativeAlarmPermissions failed:', error));
    }, [isNative, applyPermissionStatus]);

    // 設定画面から戻ってきたタイミングで権限状態を再チェックする
    useEffect(() => {
        if (!isNative) return;
        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') return;
            checkNativeAlarmPermissions()
                .then(applyPermissionStatus)
                .catch((error) => console.error('checkNativeAlarmPermissions failed:', error));
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [isNative, applyPermissionStatus]);

    const handleRequest = async () => {
        try {
            const status = await requestNativeAlarmPermissions();
            applyPermissionStatus(status);
        } catch (error) {
            console.error('requestNativeAlarmPermissions failed:', error);
        }
    };

    if (!isNative || !user || !needsPermission || dismissed) {
        return null;
    }

    return (
        <div className="fixed bottom-4 left-4 right-4 z-50 pointer-events-none flex justify-center">
            <div className="pointer-events-auto w-full max-w-md flex items-start gap-3 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 shadow-lg text-sm">
                <AlarmClock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                <div className="flex-1 min-w-0">
                    <p className="font-semibold">{t('permission_title')}</p>
                    <p className="mt-0.5 text-xs text-amber-800">{t('permission_description')}</p>
                    <button
                        type="button"
                        onClick={handleRequest}
                        className="mt-2 px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors"
                    >
                        {t('grant')}
                    </button>
                </div>
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="p-0.5 rounded hover:bg-black/10 transition-colors shrink-0"
                    aria-label={t('dismiss')}
                    title={t('dismiss')}
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
