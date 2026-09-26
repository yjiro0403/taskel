# 今 / 次 ウィジェット（Now / Next Widget）仕様

## 1. 概要

### 解決したい問題
時間盲（time blindness）。「10:01 発のバスを 10:09 と読み違えて 1 時間待つ」「今のタスクを何分やっているか分からない」といった、
**現在地と次の締切が一目で分からない**ことによる事故を防ぐ。

### 提供するもの
タスク一覧ページ（`/tasks`）の先頭に、常に見える（sticky）2 レーンのパネルを置く。

| レーン | 表示内容 | 大きく出す数字 |
|---|---|---|
| **今** | 実行中（`in_progress`）タスクのタイトル | 残り時間（見積もり − 経過）。超過したら赤で「超過 X分」。見積もりなしなら「経過 X分」 |
| **次** | 今日の次の **時刻付き** タスクのタイトル | 開始時刻（例 `10:01 開始`）と「あと X分」。開始時刻が来たら「今すぐ」 |

- 1 秒ごとに再計算する。残り 10 分未満は秒までカウントダウンする（緊急感）。
- 次の予定まで 15 分以内で琥珀色、5 分以内で赤 + 点滅ドット。
- 「次の予定のほうが先に来ます」: 今のタスクの終了予定より次の開始時刻が早いときに警告。
- タイトルをタップすると該当タスクへジャンプ（ハイライト + スクロール。既存の `focusTask`）。
- 右上のシェブロンで 1 行に畳める（`localStorage` に端末ローカルで保存）。
- **閲覧中の日付に関係なく、システムの「今日」** を表示する（過去日を見ていても、今の予定が消えない）。

## 2. アーキテクチャ

```
useStore (tasks / sections / routines / tasksLoaded)
        │
        ▼
useNowNext()  ── 1 秒ごとに now を更新 ──▶ computeNowNext({ tasks, sections, now, today })
        │                                        （純粋関数・単体テスト対象）
        ▼
NowNextWidget ── describeDuration() + next-intl でフォーマット ──▶ 画面
```

| ファイル | 役割 |
|---|---|
| `src/lib/tasks/nowNext.ts` | `computeNowNext` / `hasScheduleConflict` / `describeDuration`（純粋ロジック） |
| `src/lib/tasks/nowNext.test.ts` | 上記の単体テスト（固定時刻で検証） |
| `src/lib/tasks/taskOrder.ts` | 一覧と同じ並び順（`compareTasksForDisplay` / `sortTasksForDisplay`）。TaskList / TasksDnDWrapper からも参照し、重複実装を排除 |
| `src/hooks/useNowNext.ts` | ストア購読 + 1 秒 tick。`getMergedTasks(today)` に他日付の実行中タスクを足して渡す |
| `src/components/NowNextWidget.tsx` | 表示。折りたたみ状態は `localStorage`（`taskel_now_next_collapsed`） |
| `src/app/[locale]/tasks/page.tsx` | `<TaskList />` の直前に配置（`sticky top-16`） |
| `src/messages/{ja,en}.json` | `NowNext` 名前空間 |

## 3. 判定ロジック（`computeNowNext`）

### 入力
- `tasks`: 今日のマージ済みタスク（実タスク + ルーチン仮想タスク）+ **別日付で `in_progress` のタスク**
- `sections`: セクション（一覧と同じ並び順を再現するため）
- `now`: epoch ms
- `today`: ローカル日付 `yyyy-MM-dd`

### 今（current）
1. `status === 'in_progress'` かつ `startedAt` が数値のタスクを「実行中」とみなす（日付は問わない）。
2. 複数あれば **最後に開始したもの** を主タスクにし、残りは `concurrentCount`（「+N 件実行中」）。
3. 終了予定 `endAt = startedAt + max(0, estimatedMinutes − actualMinutes) 分`。
   `actualMinutes` は一時停止前に積んだ分なので差し引く。見積もり 0 なら `endAt = null`（経過時間のみ表示）。
4. `remainingMs = endAt − now`。負なら超過。

### 次（next）
1. **時刻付き優先**: `date === today` / `status === 'open'` / 有効な `scheduledStart` を持つタスクのうち、
   ウィンドウ `[start, start + max(estimatedMinutes, 1) 分)` の **終端が now より後** のものを、開始時刻昇順（同時刻は `order`）で 1 件。
   - 開始時刻が過ぎていてもウィンドウ内なら「次」に残り、`untilMs <= 0` → **「今すぐ」** 表示（別タスク実行中でも出る = 乗り遅れ防止）。
   - 見積もり 0 分のタスクは最低 1 分のウィンドウ（`MIN_WINDOW_MINUTES`）を持ち、その 1 分間は「今すぐ」になる。
   - ウィンドウが完全に過ぎた時刻付きタスクは対象外（履歴扱い。アラーム機能の領分）。
2. **フォールバック**: 時刻付きが残っていなければ、一覧と同じ表示順（`sortTasksForDisplay`）で最初の `open` かつ時刻なしタスクを `kind: 'queued'` として返す（時刻は出さず「時刻未設定」）。
3. 何もなければ `null`（「この後の予定はありません」）。

### 警告（`hasScheduleConflict`）
`current.endAt` があり、`next` が時刻付きで未到来（`untilMs > 0`）かつ `next.startAt < current.endAt` のとき true。

### 時間表示（`describeDuration`）
| 長さ | 表示 |
|---|---|
| 1 時間以上 | `1時間12分` |
| 10 分以上 1 時間未満 | `12分` |
| 10 分未満 | `3分20秒`（1 秒ごとに更新） |

カウントダウン（残り / あと）は切り上げ、経過・超過は切り捨て。

## 4. データ構造
`types/index.ts` と DB スキーマの変更は **なし**。既存の `status` / `startedAt` / `estimatedMinutes` / `actualMinutes` / `scheduledStart` / `date` のみを読む。
書き込みも行わない（ジャンプは `focusTask` による UI 状態変更のみ）。

## 5. 設計判断
- **「今」は実行中タイマーのみ**: 予定時刻のウィンドウ内でも再生していなければ「今」にはしない。Taskel の「現在のアクション = 再生中」というモデルを崩さず、判定を単純に保つ。時刻が来た未開始タスクは「次 → 今すぐ」として強く見せる。
- **過ぎた時刻付きタスクを「次」に残さない**: 朝に消し忘れたタスクが一日中「次」を占領し、本当に迫っているバスを隠すのを防ぐ。直前の見逃し通知はアラーム機能に委ねる。
- **一覧と同じ並び順を共有**: フォールバックの「次」が一覧の先頭と食い違わないよう、比較関数を `lib/tasks/taskOrder.ts` に集約した。
- **1 秒 tick はウィジェット内に閉じる**: ストアの `currentTime`（1 分更新）を細かくすると一覧全体が毎秒再描画されるため、フックのローカル state で刻む。
- **今日固定**: ウィジェットは「今」を答えるものなので、閲覧日付（`currentDate`）ではなくシステム日付を使う。
- **端末ローカルの折りたたみ**: 端末ごとの見え方の好みなので DB 同期しない。

## 6. Android ホーム画面ウィジェット

アプリ内パネルと同じ「今 / 次」を、Android のホーム画面ウィジェット（`AppWidgetProvider`）として提供する。
利用手順は [android_home_widget.md](android_home_widget.md) を参照。

### 6.1 アーキテクチャ

```
useStore ──(購読)──▶ NativeWidgetBridge ──▶ buildWidgetPayload()  ──▶ TaskelWidget.updateNowNext()
 (Web / WebView)      内容が変わった時だけ     （純粋関数・テスト対象）         │ Capacitor プラグイン
                                                                              ▼
                                                                   WidgetStore（SharedPreferences）
                                                                              │ 描画時に読む
                                                                              ▼
                        AlarmManager ◀── 切り替え時刻を予約 ── NowNextWidgetProvider ──▶ RemoteViews
                        （再描画 1 件）                         （描画時点の now で解釈）    Chronometer が毎秒カウント
```

| ファイル | 役割 |
|---|---|
| `src/lib/tasks/widgetPayload.ts` | ペイロード生成（`buildWidgetPayload`）と変更検知キー（`widgetPayloadKey`） |
| `src/lib/tasks/widgetPayload.test.ts` | 上記の単体テスト |
| `src/lib/native/capacitorPlugin.ts` | プラグイン参照の共通取得（`taskelAlarm.ts` から切り出し） |
| `src/lib/native/taskelWidget.ts` | `TaskelWidget` プラグインのブリッジ（`updateNowNext` / `clear`） |
| `src/components/NativeWidgetBridge.tsx` | ストア購読 → 差分があれば送信。復帰時再送・ログアウトで消去。layout で 1 度だけマウント |
| `android/.../widget/TaskelWidgetPlugin.kt` | ペイロード受信 → 保存 → 再描画 |
| `android/.../widget/WidgetStore.kt` | SharedPreferences への JSON 保存 |
| `android/.../widget/NowNextSnapshot.kt` | ペイロードの解釈（描画時点の now で「次」を決める） |
| `android/.../widget/NowNextWidgetProvider.kt` | RemoteViews 描画・Chronometer 設定・切り替え時刻の再描画予約 |
| `android/.../res/layout/widget_now_next.xml` | レイアウト（RemoteViews 対応 View のみ） |
| `android/.../res/xml/now_next_widget_info.xml` | ウィジェットのメタデータ（4x2、30 分の保険更新） |
| `.github/workflows/android-apk.yml` | debug APK を Actions の成果物として作る |

### 6.2 ペイロード（Web → ネイティブ）

時刻はすべて epoch ms。端末側がロケールに合わせて時計表記に直す。

```json
{
  "generatedAt": 1789000000000,
  "today": "2026-09-19",
  "current": { "title": "メールの返信", "startAt": 1789000000000, "endAt": 1789001080000, "concurrentCount": 0 },
  "upcoming": [
    { "title": "バスに乗る", "startAt": 1789000180000, "endAt": 1789000240000 },
    { "title": "昼食",       "startAt": 1789007200000, "endAt": 1789009900000 }
  ],
  "queued": { "title": "洗濯物を取り込む" }
}
```

- `current`: アプリ内パネルと同じ判定（`computeNowNext`）。`endAt: null` は見積もりなし。
- `upcoming`: **今日の未完了の時刻付きタスクを全部**（`listUpcomingFixed`、最大 10 件）。アプリ内パネルは先頭 1 件しか使わないが、ウィジェットはアプリを閉じたまま「次」を繰り上げる必要があるため一覧で渡す。
- `queued`: 時刻付きが尽きたときのフォールバック。アプリ内パネルと違い、時刻付きが残っていても常に同梱する（端末側で必要になる時点ではアプリが居ないため）。

### 6.3 端末側の解釈と再描画

ネイティブは Supabase に触れないので、**保存済みペイロードを描画時点の `now` で解釈する**。

| 状態 | 判定 | 表示 |
|---|---|---|
| 今: 残り | `current.endAt > now` | 青。Chronometer を `endAt` へのカウントダウンに |
| 今: 超過 | `current.endAt <= now` | 赤。Chronometer を `endAt` からのカウントアップに |
| 今: 経過 | `current.endAt == null` | Chronometer を `startAt` からのカウントアップに |
| 次 | `upcoming` のうち `endAt > now` の最初 | `HH:mm 開始` + `startAt` へのカウントダウン。5 分以内で赤、15 分以内で琥珀 |
| 次: 今すぐ | 上記で `startAt <= now` | 「今すぐ」 |
| 次: 順番待ち | `upcoming` が尽きて `queued` あり | タイトル + 「時刻未設定」 |
| 未同期 | 保存なし | 「Taskel を開くと同期されます」 |

再描画のタイミング:
1. Web からの `updateNowNext` / `clear`
2. 表示が切り替わる時刻（`current.endAt`、各 `upcoming` の `startAt` / `endAt` のうち最も近い未来）に AlarmManager で 1 件予約（`RTC`、exact 権限があれば `setExactAndAllowWhileIdle`）
3. `updatePeriodMillis`（30 分）の保険
4. 端末再起動後（`BootReceiver`）

Chronometer は RemoteViews 側で毎秒進むため、秒単位の更新にアプリもアラームも要らない。

### 6.4 設計判断
- **ペイロードは「答え」ではなく「今日の材料」**: `{今, 次}` だけ送ると、次の予定が過ぎた瞬間からウィジェットが嘘をつく。今日の残り一覧を渡せば、端末側の単純なフィルタで一日中正しい「次」を出せる。
- **送信は差分があるときだけ**: 毎秒の時計を送らない。`widgetPayloadKey` で `generatedAt` を除いた内容を比較する。
- **ネイティブに判定ロジックを複製しない**: 「今」の判定や見積もりの引き算は Web 側（テスト済み）で済ませ、端末側は `endAt > now` の比較だけにする。
- **exact alarm は必須にしない**: 権限が無ければ inexact にフォールバックし、最悪でも 30 分以内の保険更新で追いつく。

### 6.5 制限
- アプリを閉じている間の Web / 別端末での変更は、次にアプリを開くまで反映されない（右下の「更新 HH:mm」で古さが分かる）。
- 本リポジトリの開発環境（Claude Code サンドボックス）からは `dl.google.com` に到達できず Android ビルドを検証できないため、ビルド検証は GitHub Actions（`android-apk.yml`）で行う。

## 8. ホーム画面ウィジェット「今日の予定」

Google カレンダーの「スケジュール」ウィジェットに倣い、**今日これからの時刻付きタスク**を開始時刻順にスクロールできるリストで見せ、右上の「+」でタスクを追加できる。「今 / 次」とは別のウィジェットとして配置する。利用手順は [android_home_widget.md](android_home_widget.md) §6。

### 8.1 アーキテクチャ（「今 / 次」との差分）

- **データ経路は 1 本のまま**: `WidgetPayload` に `schedule` を足し、既存の `TaskelWidget.updateNowNext()` 1 回で両ウィジェットを更新する。ネイティブは Supabase に触れない。
- **リストは `RemoteViewsService`**: `ScheduleWidgetProvider` が `ListView` に `ScheduleWidgetService`（`RemoteViewsFactory`）を結び、行は描画時点の `now` で `WidgetStore` の保存済みスナップショットから生成する。
- **「+」/ 行タップは「起動アクション」として WebView へ渡す**: ウィジェット → `MainActivity` の Intent（extra `WIDGET_ACTION` = `new_task` | `edit_task`、`WIDGET_TASK_ID`）→ `TaskelWidgetPlugin` が `load()`（コールドスタート）/ `handleOnNewIntent()`（起動中、`singleTask`）で受けて `WidgetStore` に保存 → Web の `NativeWidgetBridge` が起動時 / 復帰時に `consumeLaunchAction()` で取り出し、**既存のストア経路**で画面を開く。

| ファイル | 役割 |
|---|---|
| `src/lib/tasks/nowNext.ts` | `listScheduleForWidget`: 今日の時刻付きタスクのうち `open` で時間枠が終わっていないもの + `in_progress`（実行中は枠が過ぎても残す）。`scheduledWindow` を export |
| `src/lib/tasks/widgetPayload.ts` | `schedule: WidgetScheduleItem[]`（`id, title, startAt, endAt, status`、最大 30 件）。`widgetPayloadKey` に含める |
| `src/lib/native/taskelWidget.ts` | `consumeWidgetLaunchAction()` |
| `src/components/NativeWidgetBridge.tsx` | 起動アクションの取り出しと振り分け。`new_task` → `setCurrentDate(today)` + `openAddTaskModal()`、`edit_task` → `setCurrentDate(today)` + `setPendingEditTaskId(taskId)`（`TaskList` が編集モーダルを開いて消費）。`/tasks` 以外にいれば先に遷移。ログイン確定前なら保持して確定後に実行 |
| `android/.../widget/ScheduleWidgetProvider.kt` | ヘッダー（日付・残り件数・「+」）、`setRemoteAdapter` / `setEmptyView`、行タップの `setPendingIntentTemplate`（`FLAG_MUTABLE`）、切り替え時刻の再描画予約 |
| `android/.../widget/ScheduleWidgetService.kt` | 行の生成。実行中は青 + 「実行中」、開始時刻を過ぎた未着手は琥珀 + 「今すぐ」。各行に `edit_task` + `taskId` の fill-in Intent |
| `android/.../widget/TaskelWidgetPlugin.kt` | 両ウィジェットの再描画、起動アクションの捕捉（extra は取り出した時点で消す）、`consumeLaunchAction` |
| `android/.../widget/NowNextSnapshot.kt` | `ScheduleItem` と `schedule`（無ければ空 = 旧 Web 互換）、`scheduleAt(now)`、切り替え時刻に schedule も含める |
| `android/.../res/layout/widget_schedule.xml`, `widget_schedule_item.xml`, `xml/schedule_widget_info.xml` | レイアウト（4x3 標準、縦横リサイズ可、最小 3x2） |

### 8.2 ペイロード（追加分）

```json
{
  "schedule": [
    { "id": "…uuid…", "title": "朝風呂", "startAt": 1790387100000, "endAt": 1790389800000, "status": "open" },
    { "id": "…uuid…", "title": "面談",   "startAt": 1790391600000, "endAt": 1790393400000, "status": "in_progress" }
  ]
}
```

- `upcoming` と違い **実行中（`in_progress`）を含む**。行タップで編集モーダルを開くため **`id` を持つ**。
- 完了・スキップ・時刻未設定のタスクは送らない（ユーザー選択: 「これから分だけ」）。

### 8.3 端末側の解釈と再描画

| 状態 | 判定 | 表示 |
|---|---|---|
| 予定 | `endAt > now` かつ未着手 | 灰の時刻 + タイトル |
| 今すぐ | `startAt <= now < endAt` かつ未着手 | 琥珀の時刻 + 「今すぐ」 |
| 実行中 | `status == in_progress` | 青の時刻・タイトル + 「実行中」（枠が過ぎても残す） |
| 終了 | `endAt <= now` かつ未着手 | 行を出さない |
| 空 | 残り 0 件 | 「この後の予定はありません」（未同期なら「Taskel を開くと同期されます」） |

再描画: Web からの同期 / 各行の `startAt`・`endAt` のうち最も近い未来に AlarmManager で 1 件予約 / 30 分の保険 / 再起動後。行の Chronometer は使わない（時刻は静的表示）。

### 8.4 設計判断

- **起動アクションを Web 側で解釈する**: ネイティブが直接モーダルを開く手段はなく、`pendingEditTaskId` / `openAddTaskModal` という既存の経路がそのまま使える。二重に開かないよう、ネイティブは取り出し時に消し、Web は `consume` した時点で確定する。
- **extra は取り出した時点で Intent から消す**: `singleTask` の Activity は Intent を保持し続けるため、WebView の再読み込みで `load()` が再度走っても同じ操作を二度扱わない。
- **Web のデプロイが先**: `schedule` は Web が計算する。旧 Web + 新 APK では「この後の予定はありません」になるだけで壊れない。
- **描画ごとにレイアウト ID を交互に切り替える**（`widget_schedule` / `widget_schedule_alt`、同一内容）: ランチャーは同じレイアウト ID の更新を既存 View への再適用（reapply）で済ませようとし、コレクション（`ListView`）を含むこのウィジェットでは実機（Pixel 8 Pro / Android 17 / Pixel Launcher）でヘッダーの文言と `PendingIntent` が更新されなかった（行は `notifyAppWidgetViewDataChanged` の別経路で更新されるため、行数と件数が食い違う）。別レイアウト ID にすると完全に再インフレートされ、ヘッダーと「+」/ 行タップの `PendingIntent` が毎回作り直される。`am force-stop` 等で `PendingIntent` が取り消された後も、次の描画で復旧する。

## 7. 今後の拡張候補（未実装）
- ウィジェット上からの「完了 / 次を開始」ボタン（アプリを開かずにタイマー操作）。
- FCM 経由でウィジェット用ペイロードを配信し、Web / 別端末の変更をアプリを開かずに反映する。
