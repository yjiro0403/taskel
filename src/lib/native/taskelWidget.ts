// Android ホーム画面ウィジェット（今 / 次）へのブリッジ。
// Web が計算したスナップショット（widgetPayload.ts）をネイティブへ渡すだけで、
// ネイティブは Supabase に触れない。描画・カウントダウン・「次」の繰り上げは
// 端末側（NowNextWidgetProvider）が保存済みスナップショットから行う。

import type { WidgetPayload } from '@/lib/tasks/widgetPayload';
import { getNativePlugin, isNativePlatform } from './capacitorPlugin';

interface TaskelWidgetPlugin {
    /** スナップショットを保存し、配置済みの全ウィジェットを再描画する。 */
    updateNowNext(payload: WidgetPayload): Promise<{ widgets: number }>;
    /** スナップショットを消し、「アプリを開くと同期されます」表示に戻す（ログアウト時）。 */
    clear(): Promise<void>;
}

const PLUGIN_NAME = 'TaskelWidget';

/** Web 環境では何もしない。 */
export async function syncWidgetToNative(payload: WidgetPayload): Promise<void> {
    if (!isNativePlatform()) return;
    const plugin = await getNativePlugin<TaskelWidgetPlugin>(PLUGIN_NAME);
    await plugin.updateNowNext(payload);
}

/** Web 環境では何もしない。 */
export async function clearNativeWidget(): Promise<void> {
    if (!isNativePlatform()) return;
    const plugin = await getNativePlugin<TaskelWidgetPlugin>(PLUGIN_NAME);
    await plugin.clear();
}

export { isNativePlatform };
