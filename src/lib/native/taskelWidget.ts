// Android ホーム画面ウィジェット（今 / 次）へのブリッジ。
// Web が計算したスナップショット（widgetPayload.ts）をネイティブへ渡すだけで、
// ネイティブは Supabase に触れない。描画・カウントダウン・「次」の繰り上げは
// 端末側（NowNextWidgetProvider）が保存済みスナップショットから行う。

import type { WidgetPayload } from '@/lib/tasks/widgetPayload';
import { getNativePlugin, isNativePlatform } from './capacitorPlugin';

/** ウィジェットの「+」や行タップでアプリが開かれたときに、Web 側が実行すべきこと。 */
export type WidgetLaunchAction = { action: 'new_task' } | { action: 'edit_task'; taskId: string };

interface TaskelWidgetPlugin {
    /** スナップショットを保存し、配置済みの全ウィジェットを再描画する。 */
    updateNowNext(payload: WidgetPayload): Promise<{ widgets: number }>;
    /** スナップショットを消し、「アプリを開くと同期されます」表示に戻す（ログアウト時）。 */
    clear(): Promise<void>;
    /** ウィジェット操作で積まれた起動アクションを 1 回だけ返す（無ければ action: null）。 */
    consumeLaunchAction(): Promise<{ action: 'new_task' | 'edit_task' | null; taskId?: string | null }>;
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

/**
 * ウィジェットの「+」/ 行タップ由来の起動アクションを取り出す（取り出すと消える）。
 * Web 環境、または何も積まれていなければ null。
 */
export async function consumeWidgetLaunchAction(): Promise<WidgetLaunchAction | null> {
    if (!isNativePlatform()) return null;
    const plugin = await getNativePlugin<TaskelWidgetPlugin>(PLUGIN_NAME);
    const result = await plugin.consumeLaunchAction();
    if (result.action === 'new_task') return { action: 'new_task' };
    if (result.action === 'edit_task' && result.taskId) return { action: 'edit_task', taskId: result.taskId };
    return null;
}
