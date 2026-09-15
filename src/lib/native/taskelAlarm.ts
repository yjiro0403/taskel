// Capacitor（Android アプリのガワ）との橋渡し。
// Web ビルドを壊さないよう @capacitor/core は動的 import のみで参照し、
// ネイティブ判定は WebView に注入される window.Capacitor で行う。
// 鳴らす責務は端末の AlarmManager のみ。ここでは scheduled アラーム全件を
// リコンサイル形式でネイティブへ渡すだけで、ネイティブは Supabase に触れない。

import type { Alarm } from '@/types';

export interface NativeAlarmPayload {
    id: string;
    fireAt: number; // UTC epoch ms（ネイティブ側もそのまま AlarmManager に渡す）
    label: string;
    snoozeMinutes: number;
}

export interface NativeAlarmPermissionStatus {
    notifications: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
    exactAlarm: boolean;
    batteryOptimizationExempt: boolean;
}

/** ネイティブに蓄積された停止/スヌーズ操作イベント（drainEvents で回収）。 */
export interface NativeAlarmEvent {
    alarmId: string;
    action: 'dismissed' | 'snoozed' | string;
    at: number; // 操作時刻（epoch ms）
    fireAt?: number; // snoozed のみ: 再計算後の発火時刻（epoch ms）
}

export interface NativeFcmTokenResult {
    token: string | null; // Firebase 未設定（google-services.json 無し）なら null
    deviceName: string;
}

interface TaskelAlarmPlugin {
    syncAlarms(options: { alarms: NativeAlarmPayload[] }): Promise<{ received: number; scheduled: number }>;
    checkPermissions(): Promise<NativeAlarmPermissionStatus>;
    requestPermissions(): Promise<NativeAlarmPermissionStatus>;
    getFcmToken(): Promise<NativeFcmTokenResult>;
    drainEvents(): Promise<{ events: NativeAlarmEvent[] }>;
}

declare global {
    interface Window {
        Capacitor?: {
            isNativePlatform?: () => boolean;
            /** ネイティブブリッジが登録済みプラグインを公開する場所。 */
            Plugins?: Record<string, unknown>;
        };
    }
}

/** Capacitor の WebView 内（= Android アプリ）で動いているか。 */
export function isNativePlatform(): boolean {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

let pluginPromise: Promise<TaskelAlarmPlugin> | null = null;

/**
 * プラグイン参照を得る。
 *
 * ネイティブブリッジは起動時に window.Capacitor.Plugins へ登録済みプラグインを
 * 公開するので、まずそれを使う（同期的に取得でき、ネットワークを一切伴わない）。
 *
 * 動的 import('@capacitor/core') は bundler のチャンク取得＝ネットワークアクセスを
 * 伴い、通信が不安定な端末では解決も reject もしないまま固まることがある。
 * かつて結果を無条件にキャッシュしていたため、一度詰まるとページが生きている間
 * すべてのプラグイン呼び出しが永久に待たされ、アラームが端末へ一度も同期されない
 * 状態になっていた。フォールバック時も失敗はキャッシュせず再試行できるようにする。
 */
async function getPlugin(): Promise<TaskelAlarmPlugin> {
    const bridged =
        typeof window !== 'undefined'
            ? (window.Capacitor?.Plugins?.TaskelAlarm as TaskelAlarmPlugin | undefined)
            : undefined;
    if (bridged) return bridged;

    if (!pluginPromise) {
        pluginPromise = import('@capacitor/core')
            .then(({ registerPlugin }) => registerPlugin<TaskelAlarmPlugin>('TaskelAlarm'))
            .catch((error) => {
                pluginPromise = null;
                throw error;
            });
    }
    return pluginPromise;
}

/**
 * scheduled のアラームのみを全件リコンサイル形式でネイティブへ同期する。
 * Web 環境では何もしない。
 */
export async function syncAlarmsToNative(alarms: Alarm[]): Promise<void> {
    if (!isNativePlatform()) return;

    const payload: NativeAlarmPayload[] = alarms
        .filter((alarm) => alarm.status === 'scheduled')
        .map((alarm) => ({
            id: alarm.id,
            fireAt: alarm.fireAt,
            label: alarm.label ?? '',
            snoozeMinutes: alarm.snoozeMinutes,
        }));

    const plugin = await getPlugin();
    await plugin.syncAlarms({ alarms: payload });
}

export async function checkNativeAlarmPermissions(): Promise<NativeAlarmPermissionStatus | null> {
    if (!isNativePlatform()) return null;
    const plugin = await getPlugin();
    return plugin.checkPermissions();
}

export async function requestNativeAlarmPermissions(): Promise<NativeAlarmPermissionStatus | null> {
    if (!isNativePlatform()) return null;
    const plugin = await getPlugin();
    return plugin.requestPermissions();
}

/** 通知・exact alarm が揃っているか（電池最適化除外は任意なので必須にしない）。 */
export function hasRequiredAlarmPermissions(status: NativeAlarmPermissionStatus): boolean {
    return status.notifications === 'granted' && status.exactAlarm;
}

/**
 * FCM 登録トークンと端末名を取得する。
 * Firebase 未設定（google-services.json 無しビルド）では token が null になる。
 * Web 環境では null を返す。
 */
export async function getNativeFcmToken(): Promise<NativeFcmTokenResult | null> {
    if (!isNativePlatform()) return null;
    const plugin = await getPlugin();
    return plugin.getFcmToken();
}

/**
 * ネイティブに蓄積された停止/スヌーズ操作イベントを回収して消去する。
 * Web 環境では空配列を返す。
 */
export async function drainNativeAlarmEvents(): Promise<NativeAlarmEvent[]> {
    if (!isNativePlatform()) return [];
    const plugin = await getPlugin();
    const { events } = await plugin.drainEvents();
    return Array.isArray(events) ? events : [];
}
