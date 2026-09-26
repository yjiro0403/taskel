'use client';

import { useEffect, useRef, useState } from 'react';

import { usePathname, useRouter } from '@/i18n/routing';
import { formatLocalDate } from '@/lib/calendarService';
import {
    clearNativeWidget,
    consumeWidgetLaunchAction,
    isNativePlatform,
    syncWidgetToNative,
    type WidgetLaunchAction,
} from '@/lib/native/taskelWidget';
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
 * - 予定ウィジェットの「+」/ 行タップでアプリが開かれたら、既存のストア経路で
 *   タスク追加モーダル / 該当タスクの編集モーダルを開く
 */
export function NativeWidgetBridge() {
    // 初期レンダーは常に null なので、SSR とのハイドレーション不一致は起きない
    const [isNative] = useState(() => isNativePlatform());
    const router = useRouter();
    const pathname = usePathname();
    // ログイン確定前に受け取った起動アクションは、確定後に実行するまで保持する
    const pendingLaunchRef = useRef<WidgetLaunchAction | null>(null);

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

    // ウィジェットからの起動アクション。ネイティブ側は「+」/ 行タップの Intent を
    // 保存しているだけなので、起動時と復帰時に取りに行き、既存のストア経路で開く。
    useEffect(() => {
        if (!isNative) return;

        const dispatch = (launch: WidgetLaunchAction): boolean => {
            const state = useStore.getState();
            if (!state.user) return false;

            // 「今日の予定」から来ているので、日付は今日に合わせる
            state.setCurrentDate(formatLocalDate(new Date()));
            if (pathname !== '/tasks') router.push('/tasks');

            if (launch.action === 'new_task') {
                state.openAddTaskModal();
            } else {
                // TaskList が pendingEditTaskId を拾って編集モーダルを開き、消費する
                state.setPendingEditTaskId(launch.taskId);
            }
            return true;
        };

        const handle = async () => {
            try {
                const launch = (await consumeWidgetLaunchAction()) ?? pendingLaunchRef.current;
                if (!launch) return;
                pendingLaunchRef.current = dispatch(launch) ? null : launch;
            } catch (error) {
                console.error('consumeWidgetLaunchAction failed:', error);
            }
        };

        void handle();
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') void handle();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        // ログイン確定を待っていたアクションを実行する
        const unsubscribe = useStore.subscribe((state, previous) => {
            if (state.user && !previous.user && pendingLaunchRef.current) void handle();
        });

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            unsubscribe();
        };
    }, [isNative, pathname, router]);

    return null;
}
