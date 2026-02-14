# Implementation Plan: Daily Review サマリ生成機能

## 概要

1日の終わりにユーザーが「振り返り」「今日の成果」「レビュー」等と依頼すると、AIが当日のタスク実績を集計し、完了タスク・未完了タスク・スキップ済みタスク・目標別進捗・見積もり精度を包括的にレポートする機能。

要件定義書 3.5「継続と成長」に基づき、日々の振り返りを通じて時間感覚の校正とモチベーション維持を支援する。既存の `getCalibrationData` が「期間全体の見積もり精度分析」を担うのに対し、`getDailyReview` は「特定の1日のタスク実行結果の振り返り」にフォーカスする。

## データモデル

### DailyReviewData 型（`src/lib/ai/types.ts`）

Firestoreへの永続化は行わない。ツール実行時にリアルタイムで集計し、クライアントに返却するリードオンリーのデータ構造。

```typescript
interface DailyReviewData {
  type: 'daily_review';           // ツール結果の識別子
  date: string;                   // 対象日（YYYY-MM-DD）

  /** 完了タスク一覧 */
  completedTasks: Array<{
    title: string;
    estimatedMinutes: number;
    actualMinutes: number;
    parentGoalId?: string;
    goalTitle?: string;            // Goalドキュメントから取得したタイトル
  }>;

  /** 未完了タスク一覧（status: open | in_progress） */
  incompleteTasks: Array<{
    title: string;
    status: string;                // 'open' | 'in_progress'
    estimatedMinutes: number;
  }>;

  /** スキップされたタスク（status: skipped） */
  skippedTasks: Array<{ title: string }>;

  /** 全体統計 */
  stats: {
    totalTasks: number;
    completedCount: number;
    incompleteCount: number;
    skippedCount: number;
    completionRate: number;         // 0-100（%）
    totalEstimatedMinutes: number;  // 全タスクの見積もり合計
    totalActualMinutes: number;     // 完了タスクの実績合計
    accuracyRatio: number;          // actual / estimated（1.0が完全一致）
  };

  /** 目標別進捗（当日タスクが紐づいているGoalのみ） */
  goalProgress: Array<{
    goalId: string;
    goalTitle: string;
    tasksCompleted: number;
    tasksTotal: number;
  }>;

  /** AIが生成するサマリメッセージ */
  message: string;
}
```

### Firestoreクエリ対象

| コレクション | クエリ条件 | 用途 |
|---|---|---|
| `tasks` | `userId == {uid}` AND `date == {targetDate}` | 対象日の全タスク取得 |
| `goals` | `__name__ in [{goalIds}]` (最大30件バッチ) | タスクに紐づくGoalのタイトル取得 |

新規コレクション・インデックスの追加は不要。既存の `tasks` コレクションの `userId + date` 複合インデックスと、`goals` コレクションのドキュメントIDによる取得を使用する。

## ツール設計: getDailyReview

### 定義

```typescript
tool({
  description: '指定日のDaily Reviewサマリを生成します。...',
  parameters: z.object({
    dateHint: z.string().default('today')
      .describe('対象日のヒント（"today", "昨日", "2025-01-15" 等）'),
  }),
  execute: async (args): Promise<DailyReviewData> => { ... }
})
```

### パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `dateHint` | `string` | `'today'` | 対象日を自然言語またはYYYY-MM-DD形式で指定。`resolveDate()` で解決される。 |

### 処理フロー

1. **日付解決**: `resolveDate(args.dateHint, context.currentDate)` で対象日を `YYYY-MM-DD` 形式に変換
2. **タスク全取得**: Firestoreから `tasks` コレクションを `userId + date` でクエリ
3. **空チェック**: タスクが0件の場合は空のDailyReviewDataを即座に返却（`message` にデータなしの旨を記載）
4. **ステータス別分類**:
   - `done` → completedTasks
   - `open` / `in_progress` → incompleteTasks
   - `skipped` → skippedTasks
5. **Goal タイトル取得**: タスクの `parentGoalId` を重複排除で収集し、30件ずつバッチで `goals` コレクションから `__name__ in [...]` クエリで取得。GoalタイトルをRecord<goalId, title>にマッピング
6. **統計計算**:
   - `completionRate = Math.round((completed.length / allTasks.length) * 100)`
   - `totalEstimatedMinutes`: 全タスクの `estimatedMinutes` 合計
   - `totalActualMinutes`: 完了タスクの `actualMinutes` 合計
   - `accuracyRatio`: `totalEstimated > 0 ? totalActual / totalEstimated : 1.0`（小数第2位で丸め）
7. **目標別進捗集計**: `parentGoalId` を持つタスクをGoal単位でグルーピングし、各Goalの完了数/総数を算出
8. **サマリメッセージ生成**:
   - completionRate >= 80%: ポジティブなメッセージ
   - completionRate >= 50%: 着実に進んでいる旨のメッセージ
   - completed > 0: 明日への持ち越し整理を促すメッセージ
   - completed == 0: 進行中タスクの確認を促すメッセージ
   - 見積もり精度が130%超過 or 70%未満の場合、追加コメントを付与
9. **エラーハンドリング**: try/catch で囲み、失敗時は空のDailyReviewData + エラーメッセージを返却

### サマリメッセージ生成ロジック（詳細）

```
if (completionRate >= 80):
  "素晴らしい1日でした！{completed}/{total}件のタスクを完了しました（{rate}%）。"
else if (completionRate >= 50):
  "{completed}/{total}件のタスクを完了しました（{rate}%）。着実に進んでいます。"
else if (completed > 0):
  "{completed}/{total}件のタスクを完了しました（{rate}%）。明日に持ち越すタスクを整理しましょう。"
else:
  "本日のタスクはまだ完了していません。進行中のタスクを確認しましょう。"

// 見積もり精度の追加コメント（両方が0より大きい場合のみ）
if (accuracyRatio > 1.3):
  += " 見積もり精度は{percent}%で、やや超過傾向です。"
else if (accuracyRatio < 0.7):
  += " 見積もりより早く完了しており、精度は{percent}%です。"
```

## UIコンポーネント設計: DailyReviewSummary

### ファイル: `src/components/ai/DailyReviewSummary.tsx`

CalibrationFeedbackコンポーネントと同じデザインパターンを踏襲した、リードオンリーのサマリ表示カード。

### Props

```typescript
interface DailyReviewSummaryProps {
  data: DailyReviewData;
}
```

### セクション構成

| セクション | 表示条件 | 内容 |
|---|---|---|
| Header | 常時表示 | CalendarCheckアイコン + "Daily Review - {date}" |
| Completion Rate | `stats.totalTasks > 0` | 達成率を大きな数字 + プログレスバーで表示 |
| Stats Grid | `stats.totalTasks > 0` | 完了数、未完了数、見積もり合計、実績合計、見積もり精度を2列グリッドで表示 |
| Completed Tasks | `completedTasks.length > 0` | 完了タスクのリスト。各行に見積もり→実績の時間と乖離色を表示 |
| Incomplete Tasks | `incompleteTasks.length > 0` | 未完了タスクのリスト。ステータス（進行中/未着手）を表示 |
| Skipped Tasks | `skippedTasks.length > 0` | スキップタスクのリスト |
| Goal Progress | `goalProgress.length > 0` | Targetアイコン + Goal別の完了数/総数 |
| AI Message | 常時表示 | `message` をzinc-100背景のボックスに表示 |
| Empty State | `stats.totalTasks === 0` | CalendarCheckアイコン + messageのみの簡易表示 |

### 色分けルール

**完了率（completionRate）**:
- >= 80%: `text-green-600` / `bg-green-500`
- >= 50%: `text-yellow-600` / `bg-yellow-500`
- < 50%: `text-red-600` / `bg-red-500`

**見積もり乖離（actual/estimated比率）**:
- 0.8-1.2: `text-green-600`（良好）
- 0.6-1.5: `text-yellow-600`（やや乖離）
- それ以外: `text-red-600`（大きな乖離）

### ヘルパー関数

- `getCompletionColor(rate)`: 完了率に応じたテキスト色
- `getCompletionBarColor(rate)`: 完了率に応じたプログレスバー色
- `getDeviationColor(estimated, actual)`: 見積もり乖離に応じたテキスト色
- `formatMinutes(minutes)`: 分を「X時間Y分」形式にフォーマット

### 使用アイコン（lucide-react）

- `CalendarCheck`: ヘッダー
- `CheckCircle2`: 完了タスク
- `Circle`: 未完了タスク
- `SkipForward`: スキップタスク
- `Target`: 目標別進捗

## 変更ファイル一覧

### 1. `src/lib/ai/types.ts`
- **変更内容**: `DailyReviewData` インターフェースを追加（L169-211）
- **理由**: ツールの戻り値型を定義

### 2. `src/lib/ai/tools.ts`
- **変更内容**: `getDailyReview` ツールを `createAITools()` 内に追加（L516-715）。import文に `DailyReviewData` を追加（L12）
- **理由**: Daily Reviewの集計ロジックをサーバーサイドで実行するため

### 3. `src/lib/ai/prompts.ts`
- **変更内容**:
  - `RULES_SECTION` に振り返り依頼時の `getDailyReview` 使用ルールを追加（L44）
  - `TOOL_GUIDE_SECTION` に `getDailyReview` のガイドを追加（L62-66）
- **理由**: AIモデルが適切なタイミングでツールを呼び出すためのプロンプト指示

### 4. `src/components/ai/DailyReviewSummary.tsx`（新規作成）
- **変更内容**: DailyReviewDataを受け取り、振り返りカードをレンダリングするReactコンポーネント
- **理由**: ツール結果をリッチなUIで表示するため

### 5. `src/components/ai/ChatMessage.tsx`
- **変更内容**:
  - `DailyReviewSummary` のimport追加（L11）
  - `TOOL_TYPES` Setに `'tool-getDailyReview'` を追加（L68）
  - `isGetDailyReview` 判定フラグ追加（L112）
  - `getDailyReview` の結果を `DailyReviewSummary` コンポーネントにルーティングする分岐追加（L157-163）
- **理由**: ツール結果の型に応じて適切なUIコンポーネントに振り分けるため

## 変更しないファイルとその理由

| ファイル | 理由 |
|---|---|
| `src/app/api/ai/chat/route.ts` | `createAITools()` が返すオブジェクトに自動的に `getDailyReview` が含まれるため、API Route側の変更は不要 |
| `src/store/slices/aiSlice.ts` | Daily Reviewはリードオンリーのデータ表示であり、ユーザーアクション（確認/却下/編集）を伴わないため、Zustandストアへの状態追加は不要 |
| `src/components/AIChatPanel.tsx` | ChatMessage経由で自動的にレンダリングされるため、親コンポーネントの変更は不要 |
| `src/lib/ai/dateResolver.ts` | 既存の `resolveDate()` がそのまま利用可能 |
| `src/lib/firebaseAdmin.ts` | 既存の `getDb()` がそのまま利用可能 |

## 設計判断

### 1. CalibrationFeedbackパターンの踏襲

`DailyReviewSummary` は `CalibrationFeedback` と同じアーキテクチャパターンを採用した。

- **型定義**: `CalibrationData` と同様に `type` フィールドでツール結果を識別する discriminated union パターン
- **ツール実装**: サーバーサイドでFirestoreクエリ + 集計を行い、構造化データを返却
- **UIコンポーネント**: props として型付きデータを受け取り、条件付きセクション表示を行う独立コンポーネント
- **ChatMessageでのルーティング**: `part.output?.type` による分岐でコンポーネントをディスパッチ

この一貫したパターンにより、新しいツール結果の表示を追加する際の認知負荷を低減している。

### 2. Firestoreへの永続化なし

Daily Reviewデータは毎回リアルタイムに集計する。理由:
- タスクのステータスは随時変化するため、キャッシュされたレビューデータはすぐに陳腐化する
- 集計クエリは `userId + date` の単純なフィルタであり、パフォーマンス上の問題はない
- Goal取得も30件バッチのin句クエリで効率的に処理している

### 3. `totalActualMinutes` の計算対象

`totalActualMinutes` は完了タスク（`status === 'done'`）のみから集計する。未完了タスクは実績時間が確定していないため、含めると不正確な精度比率になる。一方、`totalEstimatedMinutes` は全タスクの見積もりを含む。これにより「計画した作業量のうち、実際にどれだけ消化したか」を表現している。

### 4. dateHintパラメータの導入

`getTodayTasks` が固定で当日のみを対象とするのに対し、`getDailyReview` は `dateHint` パラメータで「昨日の振り返り」等にも対応できる設計とした。`resolveDate()` を再利用することで、自然言語の日付解決を既存ロジックに委譲している。

### 5. User Agencyの維持

Daily Reviewはリードオンリーの情報提示であり、Firestoreへの書き込みは一切行わない。Data Flow原則「AI Analysis → User Confirmation → Firestore Write」のうち、Write ステップが存在しないため、確認/却下UIは不要。AIのテキスト応答と構造化レポートの組み合わせで、ユーザーが自発的に次のアクション（タスクの持ち越し、明日の計画など）を判断できるようにしている。

## 実装順序

1. `src/lib/ai/types.ts` に `DailyReviewData` 型を追加
2. `src/lib/ai/tools.ts` に `getDailyReview` ツールを実装
3. `src/lib/ai/prompts.ts` にツール使用ガイドを追加
4. `src/components/ai/DailyReviewSummary.tsx` を新規作成
5. `src/components/ai/ChatMessage.tsx` にルーティング分岐を追加

## 注意点・制約

- **Firestoreインデックス**: `tasks` コレクションの `userId + date` 複合インデックスが既に存在することを前提としている。`getTodayTasks` と同じクエリパターンのため、追加インデックスは不要。
- **Goal取得のバッチ制限**: Firestoreの `in` 句は最大30件のため、30件ずつバッチ処理を行っている。1日のタスクが紐づくGoalが30件を超えることは実運用上ほぼないが、安全のためバッチ化済み。
- **見積もり精度の表示**: `totalEstimatedMinutes` または `totalActualMinutes` が0の場合、精度行は非表示にして0除算を回避している（UIコンポーネント側の条件分岐 L93）。
- **ツール名のTOOL_TYPES登録**: ChatMessage内の `TOOL_TYPES` Setに `'tool-getDailyReview'` を追加しないと、ツール結果がフォールバック表示になってしまう。
