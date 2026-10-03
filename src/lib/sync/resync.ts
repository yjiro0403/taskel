// 復帰時 / 再接続時の「追いつき同期（catch-up resync）」の純粋ロジック。
//
// 背景: タスクの更新は Supabase Realtime（postgres_changes）で各端末へ届くが、
// Android アプリ（Capacitor WebView）がバックグラウンドに回ると WebSocket が切れ、
// 切断中に Web 側で行った変更は再接続後も再送されない（Realtime は履歴を持たない）。
// 他のタスクアプリ（Todoist の sync_token、TanStack Query の refetchOnWindowFocus /
// refetchOnReconnect 等）と同じく、
//   1. フォアグラウンド復帰・オンライン復帰・bfcache 復元で、
//   2. Realtime チャンネルが切断→再購読したときに、
// サーバーへ「前回以降の差分」を取りに行くことで取りこぼしを埋める。
//
// ここには DOM / Supabase に依存しない判断ロジックだけを置き、単体テストで固定する。
// 実際の配線は authSlice（購読のライフサイクルと同じ場所）で行う。

import { formatLocalDate } from '../calendarService';

export type ResyncReason =
    | 'foreground'
    | 'online'
    | 'pageshow'
    | 'realtime-reconnect'
    | 'manual'
    | 'queued';

export type RealtimeChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

/** 復帰時に差分取得へ進むために必要な最小の「非表示だった時間」。これ未満の短い離脱では
 *  WebSocket が生きている可能性が高く、取得は Realtime に任せる。 */
export const FOREGROUND_RESYNC_MIN_HIDDEN_MS = 10_000;

/** 直前の追いつき同期からこの時間が経つまでは再実行しない（復帰直後の多重トリガ抑制）。 */
export const RESYNC_MIN_INTERVAL_MS = 3_000;

/** updated_at ウォーターマークの手前に重ねて取り直す幅。長いトランザクションの
 *  updated_at（= トランザクション開始時刻）がウォーターマークより古く見えても拾えるようにする。
 *  取り直した行は upsert で冪等に吸収されるので、重ねても害はない。 */
export const RESYNC_WATERMARK_OVERLAP_MS = 2 * 60_000;

/** 削除の突き合わせ（ID 照合）を行う日付窓。今日と表示中の日付を含む前後の範囲に限る。 */
export const RESYNC_WINDOW_DAYS_BEFORE = 35;
export const RESYNC_WINDOW_DAYS_AFTER = 70;

export interface DateWindow {
    /** yyyy-MM-dd（含む） */
    from: string;
    /** yyyy-MM-dd（含む） */
    to: string;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** yyyy-MM-dd をローカル日付として days 日ずらす（UTC 解釈による日付ズレを避ける）。 */
export function shiftDateString(dateStr: string, days: number): string {
    const match = DATE_ONLY_RE.exec(dateStr);
    if (!match) {
        throw new Error(`Invalid date string: ${dateStr}`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return formatLocalDate(new Date(year, month - 1, day + days));
}

/**
 * 削除照合の対象窓。今日と UI の表示日付の両方を含み、前後に余裕を持たせる。
 * 表示日付が壊れた文字列なら今日だけを基準にする。
 */
export function resyncDateWindow(today: string, currentDate: string | undefined): DateWindow {
    const anchors = [today];
    if (currentDate && DATE_ONLY_RE.test(currentDate)) {
        anchors.push(currentDate);
    }
    const earliest = anchors.reduce((min, value) => (value < min ? value : min));
    const latest = anchors.reduce((max, value) => (value > max ? value : max));
    return {
        from: shiftDateString(earliest, -RESYNC_WINDOW_DAYS_BEFORE),
        to: shiftDateString(latest, RESYNC_WINDOW_DAYS_AFTER),
    };
}

/**
 * 直近の完全同期（初期ロード / 追いつき同期）で受け取った行の中で最大の updated_at。
 * 次回の差分取得は「これ以降に更新された行」だけを取りに行く。
 *
 * 重要: Realtime 経由で届いた行から前進させてはいけない。切断中に取りこぼした更新 A
 * （T1）より後に届いた更新 B（T2 > T1）でウォーターマークを T2 に進めると、A を永久に
 * 取りに行かなくなる。必ず「取りに行った結果」からだけ計算する。
 */
export function taskWatermarkFrom(
    fetched: ReadonlyArray<{ updatedAt?: number }>,
    previous: string | null
): string | null {
    let max = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY;
    if (Number.isNaN(max)) {
        max = Number.NEGATIVE_INFINITY;
    }
    for (const task of fetched) {
        if (typeof task.updatedAt === 'number' && Number.isFinite(task.updatedAt) && task.updatedAt > max) {
            max = task.updatedAt;
        }
    }
    return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

/** 差分クエリの下限（ウォーターマークから重なり幅だけ戻した時刻）。 */
export function watermarkQueryBound(watermark: string): string {
    return new Date(Date.parse(watermark) - RESYNC_WATERMARK_OVERLAP_MS).toISOString();
}

/**
 * 差分で届いたタスクをローカル一覧へ upsert する。
 * 書き込み飛行中（pending）のタスクは楽観的なローカル状態を優先し、サーバー版で上書きしない
 * （syncTask と同じ方針）。それ以外はサーバー版を採用する。
 */
export function mergeResyncedTasks<T extends { id: string }>(
    local: T[],
    fetched: T[],
    isPending: (taskId: string) => boolean
): T[] {
    if (fetched.length === 0) {
        return local;
    }
    const incoming = new Map(fetched.map((task) => [task.id, task]));
    const merged = local.map((task) => {
        const next = incoming.get(task.id);
        if (!next) {
            return task;
        }
        incoming.delete(task.id);
        return isPending(task.id) ? task : next;
    });
    incoming.forEach((task) => {
        if (!isPending(task.id)) {
            merged.push(task);
        }
    });
    return merged;
}

/**
 * 全件を取り直したときの置き換え。pending のローカル行は保持する（初期ロードと同じ扱い）。
 */
export function replaceWithFullTaskList<T extends { id: string }>(
    local: T[],
    fetched: T[],
    isPending: (taskId: string) => boolean
): T[] {
    const next = new Map(fetched.map((task) => [task.id, task]));
    local.forEach((task) => {
        if (isPending(task.id)) {
            next.set(task.id, task);
        }
    });
    return Array.from(next.values());
}

/**
 * 窓内に存在するサーバー側 ID の集合と突き合わせ、窓内なのにサーバーに無いローカル行を落とす
 * （切断中に他端末で削除されたタスク）。窓の外の行と pending の行には触れない。
 * 差分 upsert の「後」に呼ぶこと: 窓の外へ日付移動した行は差分で日付が更新され、照合対象から外れる。
 */
export function reconcileMissingTasks<T extends { id: string; date: string }>(
    local: T[],
    presentIds: ReadonlySet<string>,
    window: DateWindow,
    isPending: (taskId: string) => boolean
): { tasks: T[]; removed: number } {
    let removed = 0;
    const tasks = local.filter((task) => {
        const inWindow = task.date >= window.from && task.date <= window.to;
        if (!inWindow || isPending(task.id) || presentIds.has(task.id)) {
            return true;
        }
        removed += 1;
        return false;
    });
    return { tasks: removed === 0 ? local : tasks, removed };
}

export interface ForegroundResyncInput {
    /** 非表示だった時間（不明なら Infinity を渡す＝必ず同期する）。 */
    hiddenForMs: number;
    /** 前回の完全同期以降に Realtime チャンネルが切断・エラーになったか。 */
    interrupted: boolean;
    /** 直前の追いつき同期からの経過時間。 */
    sinceLastResyncMs: number;
}

/** フォアグラウンド復帰時に差分取得へ進むか。 */
export function shouldResyncOnVisible(input: ForegroundResyncInput): boolean {
    if (input.sinceLastResyncMs < RESYNC_MIN_INTERVAL_MS) {
        return false;
    }
    if (input.interrupted) {
        return true;
    }
    return input.hiddenForMs >= FOREGROUND_RESYNC_MIN_HIDDEN_MS;
}

export type RealtimeStatusOutcome =
    /** 初回、またはフィルタ変更による張り替え後の正常購読。取りこぼしの疑いはない。 */
    | 'subscribed'
    /** 切断・エラーの後に再び購読できた。切断中のイベントは失われている可能性がある。 */
    | 'recovered'
    /** 切断・エラー・タイムアウト。 */
    | 'interrupted';

/**
 * 論理チャンネル（tags / tasks:personal / ... ）ごとの購読状態を追跡し、
 * 「切断→再購読」の遷移（＝取りこぼしの可能性）を検出する。
 */
export function createRealtimeHealth() {
    const statuses = new Map<string, RealtimeChannelStatus>();
    let interrupted = false;

    const allSubscribed = () => {
        for (const status of statuses.values()) {
            if (status !== 'SUBSCRIBED') {
                return false;
            }
        }
        return true;
    };

    return {
        report(key: string, status: RealtimeChannelStatus): RealtimeStatusOutcome {
            const previous = statuses.get(key);
            statuses.set(key, status);
            if (status === 'SUBSCRIBED') {
                return previous !== undefined && previous !== 'SUBSCRIBED' ? 'recovered' : 'subscribed';
            }
            interrupted = true;
            return 'interrupted';
        },
        /** 張り替えで破棄した論理キーの記録を消す（次に同じキーが張られたら初回扱い）。 */
        forget(key: string) {
            statuses.delete(key);
        },
        /** 前回の完全同期以降に切断があったか。 */
        get interrupted() {
            return interrupted;
        },
        allSubscribed,
        /**
         * 完全同期が終わったときに呼ぶ。全チャンネルが購読中に戻っていれば「切断中の穴は埋まった」
         * とみなしてフラグを下ろす。まだ落ちているチャンネルがあれば次の復帰でも同期する。
         */
        settle(): boolean {
            if (allSubscribed()) {
                interrupted = false;
            }
            return !interrupted;
        },
        /** テスト・デバッグ用の読み取り。 */
        statusOf(key: string) {
            return statuses.get(key);
        },
    };
}

export type RealtimeHealth = ReturnType<typeof createRealtimeHealth>;

export interface ForegroundWatchHandlers {
    /** 非表示→表示。hiddenForMs は非表示だった時間（不明なら Infinity）。 */
    onVisible: (hiddenForMs: number) => void;
    /** offline → online。 */
    onOnline: () => void;
    /** bfcache からの復元（pageshow persisted）や凍結解除（resume）。 */
    onRestore: () => void;
}

/**
 * フォアグラウンド復帰系のブラウザイベントをまとめて購読する。
 * Android の WebView も Activity の停止 / 再開で visibilitychange を発火する
 * （既存の NativeWidgetBridge / NativeAlarmBridge と同じ前提）。
 * SSR やテスト（document 無し）では何もしない。
 */
export function watchForegroundReturns(handlers: ForegroundWatchHandlers): () => void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return () => {};
    }

    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            return;
        }
        const hiddenForMs = hiddenAt === null ? Number.POSITIVE_INFINITY : Date.now() - hiddenAt;
        hiddenAt = null;
        handlers.onVisible(hiddenForMs);
    };
    const onOnline = () => handlers.onOnline();
    const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) {
            handlers.onRestore();
        }
    };
    const onResume = () => handlers.onRestore();

    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('resume', onResume);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);

    return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.removeEventListener('resume', onResume);
        window.removeEventListener('online', onOnline);
        window.removeEventListener('pageshow', onPageShow);
    };
}
