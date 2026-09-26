# タイムライン表記: 操作性の改善（モバイル DnD・空き時間作成・実稼働連動）仕様

`docs/weekly_timeline_dnd_spec.md`（週内の別日移動）に続く、日次 / 週次タイムライン共通の操作仕様。

## 1. 概要

### 不具合
1. **日付が勝手にずれる（スマホ / iPad）**: 「今 / 次」ウィジェットのタイトルと残り時間が行幅いっぱいのボタン（`w-full`）だったため、
   何もない余白をタップしてもタスクへジャンプし、閲覧中の日付が「今日」へ切り替わっていた。
   加えて、Google カレンダー同期の保留フラグ（`PENDING_GOOGLE_CALENDAR_SYNC_KEY`）が残っていると、
   認証の更新で `user` が差し替わるたびに保留日付へ強制的に戻す経路があった。
2. **スマホでドラッグできない**: pointer イベントを即座にドラッグ扱いにしていたため、指では画面スクロールと衝突していた。
3. **実稼働と予定が連動しない**: 再生しても `scheduledStart` は動かず、停止しても予定どおりの終了に見えていた。

### 要望
- 空き時間のクリックで予定を作成（Google カレンダー風）
- 時刻未設定タスクのセクション別表示と、そこからの再生
- 通常表示にあったコピーボタンと Google カレンダーへのリンクをブロックにも

## 2. ロジック

### 2.1 日付ずれの修正
- `NowNextWidget`: タイトル / 残り時間のボタンを `inline-block max-w-full` にし、テキスト部分だけをタップ対象にする。
- `TaskList`: 保留日付の復元は「保留キーごとに 1 回」（`restoredPendingSyncDate` ref）。データ準備後に Google トークンが無ければ
  OAuth が完了しなかったとみなし保留キーを削除する（次回以降に日付を強制しない）。

### 2.2 タッチのドラッグ（`DayTimeline.beginDrag`）
| 入力 | 動作 |
| :--- | :--- |
| マウス | 従来どおり押した瞬間にドラッグ開始（4px 以上動いたら移動確定） |
| 指 / ペン | **長押し 280ms** で持ち上げ（リング表示・振動）。それより前に 10px 以上動けばスクロール、離せばタップ（＝編集を開く） |

- 持ち上げ後は `window` の `touchmove` を `passive: false` で `preventDefault` し、指の移動でページがスクロールしないようにする。
- ドラッグ中はポインタが画面端 40px 以内に入ると、タイムライン（またはページ）を自動スクロールし、
  プレビューもポインタ位置に追従させる（`lib/timeline/autoScroll.ts`）。
- タップ対象は `pointer-coarse:` バリアントで拡大（再生ボタン、リサイズハンドル 14px、複製ボタン常時表示）。
- 長押しで持ち上げた後にそのまま離しても編集は開かない（`movedRef`）。持ち上げ直後（指が動く前）はレイアウトも変えない
  （空スロットの展開条件は 2.4 参照）。

### 2.3 空き時間のクリックで作成
- グリッド背景の `pointerdown` 位置を記録し、6px 以内で `click` されたら `onCreateAt(date, HH:mm)`。
  時刻は **15 分単位に切り捨て**（`floorMinutes`）。ブロック / ボタン / リンク上のクリックは対象外。
- マウス時はホバー位置に「+ HH:mm に予定を追加」の破線スロット（30 分幅）を表示する。
- `AddTaskModal` に `initialScheduledStart` を追加。新規作成時のみ時刻を初期値にし、セクションは時刻から自動選択される。
  日次では `TaskList`、週次では `WeekTimeline` がモーダルを開く（週次の「+」は日付のみ）。

### 2.4 時刻未設定エリア（`lib/timeline/unscheduledGroups.ts`）
- タスクをセクション（開始時刻順）でグループ化して枠付きで表示。セクションが無い / 不明なものは末尾「セクション未設定」。
- ドラッグ中はタスクの無いセクションも空スロットとして表示し、各グループ（`data-timeline-unscheduled-section`）が
  ドロップ先になる。グループへのドロップは `sectionId` も更新する（`buildTimelineDropUpdate`）。
  同日の別グループへチップを移せばセクションだけが変わる。
- **空スロットは押した瞬間には展開しない**（`dragTravelled`, 2026-09-26 修正）。マウスはクリックでも一瞬ブロックを持ち上げるため、
  エリアがグリッドの上にある日次ビューで押下時に展開すると、グリッドが押し下げられてクリック先がブロックから外れ、
  `click` がグリッド側に飛んで編集モーダルが開かなかった（週次でもチップの上に空スロットが差し込まれて同じ現象）。
  - 展開の条件: 持ち上げ位置（マウスは押下点、タッチは長押し完了時の指の位置）からポインタが **6px 以上動いた後**。
  - さらに、グリッド上のブロック（`move`）はエリアが上配置（日次）のときはポインタがエリアに入るまで展開しない
    （ドラッグ中にグリッドがずれてプレビューがポインタから離れないようにする）。チップ（`schedule`）と
    下配置（週次）のドラッグは、動き始めたらすぐ展開する。
  - タッチで長押しして持ち上げただけ（動かさず離す）では展開せず、何も変わらない。
- チップに ▶ を追加。押すと `buildTimelinePlayUpdate` で **現在時刻の開始時刻が付き、グリッド上のブロックとして実行中**になる。
  実行中のチップ（通常表示から開始したもの等）には ■。
- 日次ビューでも（週の Provider が無くても）`useTimelineDragCoordinator` がローカルの座標役を用意するため、
  ブロックを時刻未設定エリアへ落として時刻を外す / チップをグループ間で移す操作が使える。

### 2.5 ブロックの操作ボタン
`[タイトル] [時刻(日次のみ)] [Google カレンダー ↗] [複製 ⧉] [▶ / ■]`
- ↗ は `task.externalLink` があるときだけ表示（`target="_blank"`）。
- ⧉ はマウスではホバー時、タッチ端末では常時表示。`duplicateTask`（通常表示と同じ）。
- いずれも `pointerdown` / `click` を止め、ドラッグや編集を誤って始めない。

### 2.6 実稼働との連動（`lib/timeline/actuals.ts`, `lib/timeline/layout.ts`）

#### 描画は「記録された時刻」を優先する（`scheduledTaskInterval`）
どの UI（通常表示・今/次ウィジェット・Android ウィジェット・古いタブ）でタイマーを操作しても、タイムラインは実時刻で描く。

| 状態 | ブロックの位置 |
| :--- | :--- |
| `in_progress` で `startedAt` がその日 | 開始 = `startedAt`。終了 = max(開始 + 予定分, いま)（今日のときは経過とともに伸びる） |
| `done` で `completedAt` がその日かつ `actualMinutes > 0` | `completedAt − actualMinutes` 〜 `completedAt`（通常表示の「Act」と同じ読み）。**終端は完了時刻そのもの**で、15 分の最小長は適用しない |
| それ以外 | `scheduledStart` 〜 + 長さ（従来どおり）。`scheduledStart` も無ければ時刻未設定チップ |

- 時刻未設定でも「開始済み」なら（`startedAt` がその日）グリッドに出る。
- 記録時刻で描かれているブロックを時刻未設定エリアへ落とすことはできない（記録は消さない）。
- 短いブロックは描画上 24px（日次 20 分 / 週次 30 分相当）に底上げするが、ラベルの時刻は実時刻のまま。
  重なり判定（横並びの列割り当て）はこの底上げ後の長さで行い、1 分のブロックが次のブロックに被らないようにする。
- `actual_minutes` は整数列のため、30 秒未満で ■ を押すと 0 分に丸まって「予定の長さ」に戻ってしまっていた。
  タイムラインの ■ はタイマー実行を**最低 1 分**として記録する（`buildTimelineStopUpdate`）。

#### ▶ / ■ の更新内容
| 操作 | 更新内容 |
| :--- | :--- |
| ▶（ブロック / チップ） | `status: in_progress`, `startedAt: now`, `scheduledStart: HH:mm(now)`, 時刻に対応する実セクション |
| ■ | `status: done`, `startedAt: undefined`, `actualMinutes += 経過分`, `completedAt: now`。<br>初回の実行（それまで `actualMinutes` が 0）で、開始がタスクの日付内なら `scheduledStart` を実際の開始時刻に揃える |

#### ドラッグでの編集（`buildTimelineSlotUpdate`）
| ブロック | 移動 | リサイズ |
| :--- | :--- | :--- |
| 予定のみ | `scheduledStart`（長さは変えない） | `estimatedMinutes` |
| 実行中 | `startedAt` を同じ日の新しい時刻へ（`scheduledStart` も追従） | `estimatedMinutes` |
| 完了 | `completedAt` を「新しい開始 + 記録分」へ（`scheduledStart` も追従） | `actualMinutes` と `completedAt` |

- 別日への移動は予定時刻だけを動かす（移動先では記録時刻がその日でないため予定で描かれる）。
- 通常表示（セクション一覧）の再生 / 停止は従来どおり（予定時刻を動かさない）。切り替えは `TaskList` の `timelineEnabled`。

#### ルーチン由来（仮想）タスクの更新（`updateTask` の `occurrenceDate`）
- 仮想タスクは `getMergedTasks(日付)` の中にしか存在しないため、`updateTask` は従来「日次ビューで選択中の日付」からしか探せず、
  週ビューで別の日の仮想タスクを ▶ / ■ / ドラッグしても `Task not found` で何も起きなかった。
- `updateTask(id, updates, { occurrenceDate })` を追加し、タイムラインからは `task.date` を渡す。実体化（`replaceTaskRecord`）には
  `scheduledStart` / `startedAt` などの更新がそのまま乗る（`taskSlice.test.ts` で確認）。

### 2.7 削除（編集モーダル）
- これまで削除は通常表示の選択バー（○ で選択 → 一括削除）にしかなく、タイムライン表記からは削除できなかった。
- `AddTaskModal` の編集時に「削除」ボタンを追加（`window.confirm` 付き）。タイムラインではブロック / チップをクリック（タップ）→ 削除。
- ルーチン由来のタスクは「今回分を削除」＝ `status: 'skipped'`（仮想なら skipped として実体化）。行を消すと仮想の今回分が再生成されるため。
  `deleteTask` / `updateTask` には `occurrenceDate` を渡す（週ビューで別の日を編集している場合のため）。

## 3. データ構造
- `types/index.ts` / DB の変更なし。`Task.scheduledStart` / `sectionId` / `date` / `status` / `startedAt` / `actualMinutes` / `completedAt` の更新のみ。
- `TimelineDropTarget`（unscheduled）に `sectionId?: string | null` を追加。
- i18n `Timeline`: `createAt`, `duplicate`, `openInCalendar`, `start`, `startNow`, `stop`, `unscheduledOther`, `holdToDrag`。

## 4. 主要な判断
- **長押し方式**: `touch-action: none` を常時付けるとブロック上からのスクロールが不能になるため、
  「静止長押しで持ち上げ → その後だけ `touchmove` を抑止」にした。dnd-kit の TouchSensor(delay) と同じ考え方。
- **通常表示の再生 / 停止は変更しない**: 一覧の並びは `scheduledStart` に依存するため、連動はタイムライン表記に限定。
- **セクション未設定グループへのドロップは `sectionId` を消さない**: 一覧表示はセクション単位のため、`sectionId` が無いタスクは
  通常表示で見えなくなる。既存の不正データを表示するためだけのグループにする。
- **ウィジェットの修正はタップ対象の縮小のみ**: 「タイトルをタップしてジャンプ」は残し、余白の誤タップだけを無くす。
