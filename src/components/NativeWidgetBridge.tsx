'use client';

import { useEffect, useState } from 'react';

import { formatLocalDate } from '@/lib/calendarService';
import { clearNativeWidget, isNativePlatform, syncWidgetToNative } from '@/lib/native/taskelWidget';
import { buildWidgetPayload, widgetPayloadKey } from '@/lib/tasks/widgetPayload';
import { useStore } from '@/store/useStore';

/**
 * Store changes are the primary trigger. The periodic pass only exists to catch the
 * local date rolling over past midnight while the app stays open; the widget itself
 * handles time passing within a day.
 */
const RESYNC_INTERVAL_MS = 60_000;

/**
 * Capacitor（Android アプリ）環境でのみ動く、ホーム画面ウィジェットへの同期。
 * layout で 1 度だけマウントする。Web ブラウザでは何も描画・実行しない。
 *
 * - ストアの変更を購読し、ウィジェット用スナップショット（今の実行中タスク、
 *   今日の残りの時刻付きタスク、順番待ちの先頭）を再計算する
 * - 内容が前回送ったものと違うときだけネイティブへ渡す（毎秒の時計は送らない）
 * - フォアグラウンド復帰時にも同期する
 * - ログアウトでスナップショットを消す
 */
export function NativeWidgetBridge() {
    // 初期レンダーは常に null なので、SSR とのハイドレーション不一致は起きない
    const [isNative] = useState(() => isNativePlatform());

    useEffect(() => {
        if (!isNative) return;

        let lastKey: string | null = null;
        let hadUser = false;

        const sync = () => {
            const state = useStore.getState();

            if (!state.user) {
                if (hadUser) {
                    hadUser = false;
                    lastKey = null;
                    clearNativeWidget().catch((error) => console.error('clearNativeWidget failed:', error));
                }
                return;
            }
            hadUser = true;
            // 未ロード中に同期すると「タスクなし」でウィジェットを上書きしてしまう
            if (!state.tasksLoaded) return;

            const now = Date.now();
            const today = formatLocalDate(new Date(now));
            const runningElsewhere = state.tasks.filter(
                (task) => task.date !== today && task.status === 'in_progress'
            );
            const payload = buildWidgetPayload({
                tasks: [...state.getMergedTasks(today), ...runningElsewhere],
                sections: state.sections,
                now,
                today,
            });
            const key = widgetPayloadKey(payload);
            if (key === lastKey) return;
            lastKey = key;

            syncWidgetToNative(payload).catch((error) => {
                // 次の変更や復帰時に再送されるよう、失敗した内容は「送信済み」にしない
                if (lastKey === key) lastKey = null;
                console.error('syncWidgetToNative failed:', error);
            });
        };

        sync();
        const unsubscribe = useStore.subscribe(sync);
        const timer = setInterval(sync, RESYNC_INTERVAL_MS);
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') sync();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            unsubscribe();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [isNative]);

    return null;
}
