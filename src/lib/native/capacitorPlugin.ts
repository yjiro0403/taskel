// Capacitor（Android アプリのガワ）との橋渡しの共通部分。
// Web ビルドを壊さないよう @capacitor/core は動的 import のみで参照し、
// ネイティブ判定は WebView に注入される window.Capacitor で行う。

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

const pluginPromises = new Map<string, Promise<unknown>>();

/**
 * 名前でプラグイン参照を得る。
 *
 * ネイティブブリッジは起動時に window.Capacitor.Plugins へ登録済みプラグインを
 * 公開するので、まずそれを使う（同期的に取得でき、ネットワークを一切伴わない）。
 *
 * 動的 import('@capacitor/core') は bundler のチャンク取得＝ネットワークアクセスを
 * 伴い、通信が不安定な端末では解決も reject もしないまま固まることがある。
 * かつて結果を無条件にキャッシュしていたため、一度詰まるとページが生きている間
 * すべてのプラグイン呼び出しが永久に待たされる状態になっていた。
 * フォールバック時も失敗はキャッシュせず再試行できるようにする。
 */
export async function getNativePlugin<T>(name: string): Promise<T> {
    const bridged =
        typeof window !== 'undefined' ? (window.Capacitor?.Plugins?.[name] as T | undefined) : undefined;
    if (bridged) return bridged;

    let promise = pluginPromises.get(name) as Promise<T> | undefined;
    if (!promise) {
        promise = import('@capacitor/core')
            .then(({ registerPlugin }) => registerPlugin<T>(name))
            .catch((error) => {
                pluginPromises.delete(name);
                throw error;
            });
        pluginPromises.set(name, promise);
    }
    return promise;
}
