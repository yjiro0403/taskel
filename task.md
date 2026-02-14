# Task: Daily Review サマリ生成機能

## 概要
要件定義書 3.5「継続と成長」に基づき、1日の終わりにAIが完了タスク・未完了タスク・総作業時間・目標達成度を振り返るサマリを生成する機能を実装する。既存の `getCalibrationData` ツール + `CalibrationFeedback` コンポーネントのパターンに倣い、read-only表示のみ（候補確認フローなし）とする。

## サブタスク

### Architect: データモデル・ツール・UIコンポーネント設計
- [x] `DailyReviewData` 型の設計（types.ts）
  - completedTasks / incompleteTasks / skippedTasks の3分類
  - stats（completionRate, accuracyRatio 等の集計値）
  - goalProgress（目標別の当日タスク進捗）
  - message（AIサマリメッセージ）
- [x] `getDailyReview` ツールのAPI設計（tools.ts）
  - パラメータ: dateHint（デフォルト "today"）
  - Firestoreクエリ: tasks(userId + date) + goals(バッチ取得)
  - エラーハンドリング: 空データ返却パターン
- [x] `DailyReviewSummary` UIコンポーネント設計
  - CalibrationFeedback パターン踏襲（read-only、確認フローなし）
  - 完了率バー + ステータス別タスクリスト + 目標別進捗 + AIメッセージ
- [x] プロンプトへのトリガーワード追加設計
  - 「振り返り」「今日の成果」「レビュー」「1日のまとめ」等

### Dev: 5ファイルの実装
- [x] `src/lib/ai/types.ts` - `DailyReviewData` インターフェース追加（L169-211）
  - type: 'daily_review' リテラル型
  - completedTasks: goalTitle解決済み配列
  - incompleteTasks: status付き配列
  - skippedTasks: タイトルのみ配列
  - stats: 8項目の集計オブジェクト
  - goalProgress: goalId/goalTitle/tasksCompleted/tasksTotal
- [x] `src/lib/ai/tools.ts` - `getDailyReview` ツール実装（L516-715）
  - resolveDate によるdateHint解決
  - Firestoreから対象日タスク全取得
  - ステータス別分類（done / open|in_progress / skipped）
  - Goal IDバッチ取得（30件ずつ `__name__` in クエリ）
  - 統計計算（completionRate, accuracyRatio）
  - 目標別進捗集計
  - completionRateに応じたサマリメッセージ生成（80%以上/50%以上/それ以外/0件）
  - try-catch による包括的エラーハンドリング
- [x] `src/lib/ai/prompts.ts` - トリガーワード・ツールガイド追加
  - RULES_SECTION に「振り返り」「今日の成果」「レビュー」「1日のまとめ」トリガー追加（L44）
  - TOOL_GUIDE_SECTION に getDailyReview 使用ガイド追加（L63-66）
- [x] `src/components/ai/DailyReviewSummary.tsx` - 新規UIコンポーネント（189行）
  - CalibrationFeedback パターン踏襲
  - 完了率の大きな数字表示 + プログレスバー（色分け: green/yellow/red）
  - Stats Grid（2列: 完了数/未完了数/見積もり合計/実績合計/精度）
  - 完了タスクリスト（見積もり -> 実績の矢印表示、乖離色分け）
  - 未完了タスクリスト（進行中/未着手ラベル）
  - スキップタスクリスト
  - 目標別進捗セクション（Target アイコン付き）
  - AIメッセージ表示
  - タスク0件時の空状態表示
- [x] `src/components/ai/ChatMessage.tsx` - ツール結果ルーティング追加
  - TOOL_TYPES Set に `'tool-getDailyReview'` 追加（L68）
  - isGetDailyReview フラグ追加（L112）
  - `daily_review` タイプのルーティング分岐追加（L157-164）
  - DailyReviewSummary コンポーネントの import 追加（L11）

### QA: 検証
- [ ] `walkthrough.md` 作成（別途実施予定）
  - 正常系: タスクあり（完了/未完了/スキップ混在）のレビュー表示
  - 正常系: タスク0件時の空状態表示
  - 正常系: Goal紐づきタスクの目標別進捗表示
  - 正常系: 「昨日の振り返り」でdateHint解決
  - 異常系: Firestoreエラー時の空データフォールバック
  - 境界値: completionRate 0%/50%/80%/100% での色分け・メッセージ切り替え
  - 境界値: Goal 30件超のバッチ取得

## 変更ファイル一覧

| ファイル | 変更種別 | 概要 |
|---------|---------|------|
| `src/lib/ai/types.ts` | 修正 | `DailyReviewData` インターフェース追加 |
| `src/lib/ai/tools.ts` | 修正 | `getDailyReview` ツール追加、import追加 |
| `src/lib/ai/prompts.ts` | 修正 | トリガーワード・ツールガイド追加 |
| `src/components/ai/DailyReviewSummary.tsx` | 新規 | Daily Reviewサマリ表示コンポーネント |
| `src/components/ai/ChatMessage.tsx` | 修正 | ツール結果ルーティングにDailyReview追加 |

## 設計判断の記録
- **CalibrationFeedbackパターン踏襲**: read-onlyの集計表示であり、ユーザーの確認・編集フローが不要なため、TaskCreationCardではなくCalibrationFeedbackと同じパターンを採用
- **Goal IDバッチ取得**: Firestore `in` クエリの30件制限に対応したバッチ分割を実装
- **completionRateベースのメッセージ分岐**: 80%以上=称賛、50%以上=中立、それ以下=改善提案、0件=案内
- **accuracyRatio追加表示**: 見積もり精度が1.3超/0.7未満の場合のみサマリメッセージに追記（過度な情報表示を避ける）

## 完了条件
- [x] AIチャットで「今日の振り返り」と入力すると `getDailyReview` ツールが呼び出される
- [x] ツール結果が `DailyReviewSummary` コンポーネントで視覚的に表示される
- [x] 完了率に応じた色分け・メッセージが正しく切り替わる
- [x] タスク0件時に適切な空状態が表示される
- [x] Goal紐づきタスクがある場合、目標別進捗が表示される
- [x] エラー発生時にフォールバックが動作する
- [ ] QA walkthrough.md 完了（別途）
