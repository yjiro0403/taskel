# 追いつき同期（Catch-up Resync）仕様

Web で更新したタスクが Android アプリ（Capacitor WebView）に反映されないことがある問題への対応。
実装は `src/lib/sync/resync.ts`（純粋ロジック・単体テスト対象）と `src/store/slices/authSlice.ts`（配線）。

## 1. 症状と原因

- Android アプリは `https://taskel.vercel.app` を WebView で表示しているだけで、データの鮮度は Web と同じ仕組み（Supabase Realtime の `postgres_changes` 購読）に依存している。
- WebView がバックグラウンドへ回ると OS がネットワークとタイマーを止めるため WebSocket が切れる。Realtime は **切断中のイベントを再送しない**（履歴を持たない）ので、その間に Web で行った変更は復帰後も届かない。
- 復帰時に取り直す処理が無く、`refreshInitialState`（全件ロード）はログイン時にしか走らなかった。同じユーザーのトークン更新では `shouldReloadUserData` が false を返し、何も取りに行かない。
- さらに `channel.subscribe()` に状態コールバックを渡していなかったため、`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` が起きても気付けず、サーバー側で閉じられたチャンネル（realtime-js は自動で再参加しない）はそのテーブルの Realtime だけが静かに止まっていた。

「たまに反映されない」のは、短い離脱なら WebSocket が生き残り、長い離脱や回線切替で切れたときだけ取りこぼすため。

## 2. 他のアプリ・ライブラリのやり方（調査）

| 方式 | 採用例 | Taskel での対応 |
|---|---|---|
| フォアグラウンド復帰 / 再接続時に再取得 | TanStack Query の既定値（`refetchOnWindowFocus` / `refetchOnReconnect`、`staleTime: 0`） | `visibilitychange`（表示に戻った）・`online`・`pageshow`（bfcache）・`resume`（凍結解除）で差分取得 |
| 「前回以降の差分」だけを取るトークン方式 | Todoist Sync API の `sync_token`（初回 `*` で全件、以後は変更分のみ） | tasks の `updated_at` を起点（ウォーターマーク）に `updated_at >= 起点` だけ取得 |
| Realtime は取りこぼし前提で、再購読したら取り直す | Supabase 公式のトラブルシュート（タブ復帰時に再取得して欠落イベントを埋める） | `subscribe((status) => …)` で「切断 → `SUBSCRIBED`」を検出して差分取得 |
| ネイティブのライフサイクルで同期 | Capacitor `App` プラグインの `appStateChange` / `resume`（Activity の `onResume`） | WebView は Activity の停止 / 再開で `visibilitychange` を発火するので、既存の NativeWidgetBridge / NativeAlarmBridge と同じ前提で Web 側だけで対応（APK 再ビルド不要） |

## 3. 動作

### 3.1 トリガ

| トリガ | 条件 |
|---|---|
| 表示に戻った（`visibilitychange` → visible） | 非表示が **10 秒以上**、または前回の完全同期以降に Realtime の切断があった場合。直前 3 秒以内に同期済みなら見送る |
| オンライン復帰（`online`） | 常に |
| bfcache 復元（`pageshow` persisted）/ 凍結解除（`resume`） | 常に |
| Realtime チャンネルが切断 → 再購読（`SUBSCRIBED`） | 750 ms のデバウンス後に 1 回（複数チャンネルの同時復帰を束ねる） |
| 手動（`useStore.getState().resyncFromServer('manual')`） | 将来の pull-to-refresh 用 |

初期ロード中（`initialDataStatus !== 'ready'`）は何もしない。初期ロードに **失敗** したまま復帰したときは差分ではなく `refreshInitialState` をやり直す。

### 3.2 手順（`runResync`）

1. `supabase.auth.getSession()` でセッションを確定させる。無ければ中止（期限切れトークンのまま叩くと anon 扱いで 0 行が返り、削除照合でローカルを全部消してしまうため）。
2. 軽いコレクション（tags / routines / sections / projects / goals / notes / item_templates）は全件取り直して置き換える。プロジェクト一覧から購読フィルタも張り直す。
3. tasks は差分取得:
   - 起点（直近の完全同期で受け取った行の最大 `updated_at`）から **2 分** 戻した時刻以降の行を 1 ページ（1,000 行）取得し upsert する。書き込み中（pending）のタスクはローカルを優先。
   - 起点が無い、または差分が 1 ページに収まらないときは `fetchTasks` で全件取り直す。
4. 削除は差分クエリに現れないので、**今日と表示中の日付を含む窓**（前 35 日〜後 70 日）の ID を `select id` で取り、窓内なのにサーバーに無いローカル行を落とす。ID 取得に失敗したら削除照合だけ省略する。
5. タスクが動いていれば金額集計を stale にする（`markFinanceSummariesStale`）。
6. `lastResyncAt` を更新し、全チャンネルが購読中に戻っていれば「切断あり」フラグを下ろす。

同時に 1 本しか走らない。実行中に別のトリガが来たら、終わった後にもう 1 回だけ回す。

### 3.3 ウォーターマークの決め方（重要）

起点は **取りに行った結果**（初期ロード / 差分取得で受け取った行）からだけ前進させる。Realtime 経由で届いた行で進めてはいけない。切断中に取りこぼした更新 A（T1）より後に Realtime で届いた更新 B（T2 > T1）で起点を T2 にすると、A を永久に取りに行かなくなる。

### 3.4 Realtime の健全性

- 論理チャンネル（`tasks:personal` など）ごとに最後の状態を記録し、`SUBSCRIBED` 以外 → `SUBSCRIBED` の遷移を「復旧（取りこぼしの疑い）」として扱う。
- `CLOSED`（サーバー側で閉じられた）は realtime-js が自動では再参加しないため、1 / 2 / 5 / 10 秒のバックオフで同じ論理キーのチャンネルを張り直す。張り替えで自分が破棄した旧チャンネルの `CLOSED` は参照比較で除外する。
- `CHANNEL_ERROR` / `TIMED_OUT` は realtime-js の再参加に任せ、ログだけ残す。

### 3.5 ついでの軽量化

Realtime のタスクイベントは ID ごとに 150 ms まとめてから `fetchTaskById` する。1 回の保存で tasks の UPDATE と task_tags の DELETE / INSERT（タグ数 × 2 件）が連続して届き、タグ 3 個なら 7 回取りに行っていたのを 1 回にする。

## 4. 制限・今後

- 削除の照合は日付窓の中だけ。窓の外（例: 半年前）のタスクを別端末で削除しても、全件取り直し（差分がページに収まらないとき・再ログイン）までローカルに残る。
- `updated_at` を更新しない変更（タグだけの付け外し、添付の追加）は差分クエリに乗らない。Realtime が生きていれば `task_tags` チャンネルで拾う。
- `supabase/migrations/20261002120000_tasks_updated_at_index.sql`（`tasks(user_id, updated_at)` の索引）は差分取得を軽くするためのもの。未適用でも動作は変わらない。`npx supabase db push` で適用する。
- Android アプリを **閉じている間** のホーム画面ウィジェットは引き続き最後のスナップショットのまま（ウィジェットは Supabase を読まない）。アプリを開いた時点で差分取得 → ウィジェット再送が走るので、以前の「開いても古いまま」は解消される。
- 将来 `@capacitor/app` を入れれば `resume` でも起動できるが、WebView の `visibilitychange` で足りているため APK 再ビルドが必要な変更は入れていない。
