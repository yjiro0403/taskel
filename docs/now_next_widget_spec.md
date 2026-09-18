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

## 6. 今後の拡張候補（未実装）
- Android ホーム画面ウィジェット: `TaskelAlarm` プラグインと同じ要領で `{ current, next }` のスナップショットをネイティブに渡し、`AppWidgetProvider` + `RemoteViews` の `Chronometer` でカウントダウンする。本リポジトリでは Android SDK が使えず検証できないため未着手。
- ウィジェット上からの「完了 / 次を開始」ボタン。
