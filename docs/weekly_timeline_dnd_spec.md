# ウィークリータイムライン: タイトル優先表示と別日へのドラッグ＆ドロップ 仕様

## 1. 概要

### 解決したい問題
1. **タイトルが見えない**: 週次プランニングのタイムラインでは、ブロック 1 行目に `HH:mm–HH:mm` が来ていたため、
   30 分以下のタスクではタイトルがまったく見えなかった。時刻は左端の時間軸で分かるので、ブロック内の時刻表記は不要。
2. **別日へ動かせない**: `DayTimeline` の pointer ドラッグは自分の列（1 日）の中でしか完結せず、
   - 水曜の「時刻未設定」タスクを木曜の「時刻未設定」エリアへ、
   - 水曜 9:00 のタスクを木曜 10:00 へ、
   といった週内の日付移動ができなかった（週ゴール → 日付列の dnd-kit ドロップのみ存在）。

### 対応
- ブロックはタイトルを先頭に表示し、ブロックの高さに収まる行数だけ折り返す（残りは `…`）。週ビューでは時刻を出さない。
  日次ビューはタイトルの右に小さく時刻を残す。
- 週ビューでは、ブロック / 時刻未設定チップを別の日の時間軸・時刻未設定エリアへドロップできる。

## 2. アーキテクチャ / ロジック

### 2.1 タイトル優先表示（`src/components/timeline/DayTimeline.tsx`）
- 新 props: `compact`（週列向けの小さい文字）, `showTimeRange`（ブロック内に時刻を出すか。既定 true）。
  `WeekTimeline` は `compact showTimeRange={false}` で呼ぶ。日次（`TaskList`）は既定値のまま。
- 表示行数 = `max(1, floor((ブロック高さ − 上下 padding 8px) / 行高))`。行高は compact 16px / 通常 20px。
  `-webkit-line-clamp` で行数分だけ表示し、`title` 属性で全文をツールチップ表示する。

### 2.2 週内ドラッグ＆ドロップ
既存の pointer ベースのドラッグ（move / schedule / resize）をそのまま使い、**列をまたぐ判定だけを追加**する。
dnd-kit は週ゴール用の `DndContext` が既にあるため、タイムライン側には持ち込まない（ネストや衝突判定の干渉を避ける）。

```
WeekTimeline
 └ WeekTimelineDragProvider   … 週内で共有するドラッグ状態 (WeekTimelineDrag | null)
     └ WeekDayColumn[data-timeline-column=YYYY-MM-DD]
         └ DayTimeline
             ├ grid  [data-timeline-grid=YYYY-MM-DD, data-timeline-start-min, -end-min, -ppm]
             └ 時刻未設定 section [data-timeline-unscheduled=YYYY-MM-DD]
```

pointermove ごとの流れ（ドラッグ元の `DayTimeline` が処理）:
1. `resolveWeekDropHit(clientX, clientY)`（`weekDropTarget.ts`）が `document.elementFromPoint` で
   ポインタ直下の要素から `data-timeline-*` 属性を辿り、`{grid, date, pointerMin}` / `{unscheduled, date}` / null を返す。
   move 中は列ヘッダーなど grid 外でもその列の grid にフォールバックする。
2. 自列の grid 上、または未設定チップが自列の未設定エリア上 → 共有状態を `null` にして従来の同日プレビューへ。
3. それ以外（別日の grid / 別日の未設定エリア / 自列の未設定エリアにブロック）→
   `snapDropStart` で開始分を 5 分刻み・軸内にクランプし、`WeekTimelineDrag` を Provider へ publish。
   - ドラッグ元の列: 対象タスクを半透明（`opacity-40`）で元の位置に残す。
   - ドロップ先の列: grid なら破線ブロック（タイトル入り）を該当時刻に描画、未設定エリアなら枠を強調しヒント文を表示。
4. pointerup: 共有状態にドラッグがあれば `buildTimelineDropUpdate` の payload で `updateTask`。なければ従来処理。
   pointermove の再描画は「対象が変わったとき」だけ（`isSameWeekTimelineDrag`）。

### 2.3 ドロップ結果（`src/lib/timeline/weekDrag.ts` / `buildTimelineDropUpdate`）
| ドラッグ元 | ドロップ先 | updateTask payload |
| :--- | :--- | :--- |
| ブロック（時刻あり） | 別日の grid | `{ date, scheduledStart: HH:mm, estimatedMinutes: 長さ, sectionId(時刻に対応する実セクション) }` |
| 未設定チップ | 別日の grid | 同上（チップ上端 = ポインタ位置。同日ドロップと同じ規則） |
| ブロック（時刻あり） | 未設定エリア（同日 / 別日） | `{ date, scheduledStart: undefined }` → store が `null` として永続化し「時刻未設定」になる |
| 未設定チップ | 別日の未設定エリア | `{ date }` |

- ブロックは掴んだ位置のオフセットを維持する（同日移動と同じ手触り）。軸内に収まるようクランプする。
- 日付変更は `updateTask` の既存経路に乗る: ルーチン由来タスクは「元スロットを skipped 化 + 新 UUID へデタッチ」、
  仮想タスクは実体化、それ以外は通常更新。タイムライン側で特別扱いはしない。

## 3. データ構造
- `types/index.ts` / DB スキーマの変更なし。`Task.date` と `Task.scheduledStart` を更新するだけ。
- 新規型（`src/lib/timeline/weekDrag.ts`）: `TimelineDropTarget`, `TimelineDragSource`, `WeekTimelineDrag`。
- i18n（`Timeline` namespace）: `dropToMove`, `dropToUnschedule` を追加。

## 4. 主要な判断
- **dnd-kit を使わない**: 週ゴール用の `DndContext`（`WeeklyView`）と同居させると droppable の衝突判定や
  DragOverlay の扱いが複雑になる。既存の pointer ドラッグを拡張し、当たり判定は DOM 属性 + `elementFromPoint` で行う。
  登録処理が不要で、列ごとのスクロール差にも強い。
- **日次ビューは Provider なし**: `useWeekTimelineDrag()` が `null` のときは新しい分岐を一切通らないため、
  `/tasks` のタイムライン挙動は表示順（タイトル → 時刻）以外変わらない。
- **未設定エリアへのドロップ = 時刻を外す**: 「時刻未設定エリア」という名前どおりの意味にする。
  移動先の列にヒント文（「ここにドロップして開始時刻を外す」）を出して誤操作を防ぐ。
- **週ビューは時刻非表示**: 列幅 160px・0.8px/分では 1 行しか入らない。左端の時間軸で時刻は読めるため、
  タイトルにスペースを全て割く。
