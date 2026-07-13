# Multi Active Tasks 仕様

## 概要

Taskel は複数タスクを同時に `in_progress` にできる。  
並行作業が多いユーザー向けに、再生ボタンを複数押してもそれぞれが実行中のままになる。

## 背景

以前は次の制約により、ユーザーごとに実行中タスクは **1件のみ** だった。

1. DB: `tasks_single_active_per_user_idx`（`status = 'in_progress'` の部分ユニーク）
2. クライアント: 再生開始時に他の実行中タスクを停止してから新規開始

この制約により、2つ目の再生ボタンを押すと1つ目が再生アイコンに戻っていた。

## 仕様

### 再生（Play）

- 対象タスクを `status: 'in_progress'`、`startedAt: now` にする
- **他の `in_progress` タスクは変更しない**
- 各タスクは独立したタイマー（`startedAt` / `actualMinutes`）を持つ
- 同時実行数の上限は設けない

### 停止 / 完了（Square）

| 画面 | Square 押下時の意味 | status |
|------|---------------------|--------|
| メインタスクリスト | 完了 | `done`（経過分を `actualMinutes` に加算） |
| Unscheduled サイドバー | 一時停止 | `open`（経過分を `actualMinutes` に加算） |

※ この差異は従来どおり。本仕様では変更しない。

### AI「今すぐ開始」（`confirmAndStartTask`）

- 候補を `in_progress` で新規作成する
- 既存の実行中タスクは止めない（自動完了もしない）

### 日付移動中の実行中タスク

- 別日へ移動する場合は「予定変更」とみなし、タイマーを止めて `open` にする
- `actualMinutes` は維持する

## データモデル

- `tasks.status = 'in_progress'` の件数制限なし
- `startedAt` はタスク単位
- マイグレーション: `20260713120000_allow_multi_active_tasks.sql` で単一アクティブ索引を削除

## UI 期待挙動

1. タスク A の再生 → A が四角（実行中）になる
2. タスク B の再生 → B も四角になり、**A も四角のまま**
3. A の四角を押す → A のみ完了/停止。B は実行中のまま

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `supabase/migrations/20260713120000_allow_multi_active_tasks.sql` | 単一アクティブ索引削除 |
| `src/components/TaskList.tsx` | メインリストの再生 |
| `src/components/RightSidebar.tsx` | Unscheduled の再生 |
| `src/store/slices/aiSlice.ts` | AI 即時開始 |
| `src/lib/timeUtils.ts` | 複数実行中を考慮したスケジュール計算（既存） |
