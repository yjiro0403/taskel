# Taskel コードレビューレポート
**レビュー日**: 2026-03-30
**レビュアー**: ITコーディネートAI 品質検証エンジニア
**対象**: taskel (Next.js 16 + Firebase + Zustand タスク管理アプリ)

---

## 目次
1. [エグゼクティブサマリー](#1-エグゼクティブサマリー)
2. [パフォーマンス・最適化](#2-パフォーマンス最適化)
3. [テスト・品質保証](#3-テスト品質保証)
4. [開発体験・保守性](#4-開発体験保守性)
5. [もし1から作り直すなら](#5-もし1から作り直すなら)

---

## 1. エグゼクティブサマリー

### 総合評価: C+ (改善必須)

Taskelは機能的には豊富だが、**セキュリティ上の致命的欠陥**、**テストカバレッジほぼゼロ**、**巨大コンポーネントの乱立**が見られる。Gemini生成コード特有の「動くけど脆い」パターンが散見される。

### 🚨 これはまずい（即座に対応が必要）

| # | 問題 | 深刻度 | ファイル |
|---|------|--------|----------|
| 1 | **Task APIが認証トークンを検証せずクライアントのuserIdを信頼** | 致命的 | `src/app/api/tasks/route.ts:10` |
| 2 | **ユニットテスト・統合テストが0件** | 致命的 | プロジェクト全体 |
| 3 | **全APIルートで入力バリデーションなし** | 高 | `src/app/api/` 全体 |
| 4 | **AddTaskModal.tsx が919行の巨大コンポーネント** | 高 | `src/components/AddTaskModal.tsx` |
| 5 | **Firestoreリスナーのメモリリーク** | 高 | `src/store/slices/authSlice.ts` |

---

## 2. パフォーマンス・最適化

### 2.1 不要な再レンダリング

#### 🚨 問題: useMemo/useCallback の不足

**`src/components/TaskList.tsx`**
- `compareTasks` 関数がレンダーごとに再生成される
- `getSortedTasks()` の結果がメモ化されていない
- `globalSchedule` 計算が毎レンダーで実行

```typescript
// 現状: 毎レンダーで関数再生成
const compareTasks = (a: Task, b: Task) => { ... };

// 改善案:
const compareTasks = useCallback((a: Task, b: Task) => {
  // ...既存ロジック
}, []);
```

**`src/components/RightSidebar.tsx`**
- フィルター・ソートロジックがレンダー内にインラインで記述
- ドロップダウン状態の変更で全コンポーネントが再レンダー

```typescript
// 改善案: フィルタリング結果をメモ化
const filteredTasks = useMemo(() => {
  return unscheduledTasks
    .filter(/* ... */)
    .sort(/* ... */);
}, [unscheduledTasks, filterText, filterProjectId, sortBy]);
```

**`src/components/MonthlyView.tsx`**
- `monthlyGoals` と `weeklyGoalsMap` のフィルタリングがメモ化なし

**`src/components/CalendarView.tsx`**
- `getTileContent` 関数が毎レンダーで再生成（カレンダーの全タイルで呼ばれる）

#### 問題: React.memoの未使用

以下のネストされたコンポーネントが `React.memo` でラップされていない:

- `src/components/BoardView.tsx` → 内部の `Column`, `DraggableTask`
- `src/components/MilestoneBoard.tsx` → 内部の `Column`, `DraggableMilestone`
- `src/components/MonthlyWeekColumn.tsx`

親コンポーネントの状態変更で、変更のない子コンポーネントまで再レンダーされる。

#### 問題: インラインハンドラーの乱用

**`src/components/TaskItem.tsx`** で多数のインラインハンドラー:
```typescript
// 問題: 毎レンダーで新しい関数が生成される
onClick={() => canEdit && !isOverlay && onEdit(task)}
```

該当箇所: line 126, 150, 227 など複数

### 2.2 Firestoreクエリの効率性

#### 🚨 問題: プロジェクトごとにN個のリスナー

**`src/store/slices/authSlice.ts`** (line 96付近)

```typescript
// 現状: プロジェクトごとに個別リスナーを作成
projectIds.forEach(projectId => {
  const qProjectTasks = query(
    collection(db, 'tasks'),
    where('projectId', '==', projectId)
  );
  const unsub = onSnapshot(qProjectTasks, (snapshot) => {
    // 各リスナーが発火するたびに全タスクをマージ
    updateSharedTasksState();
  });
});
```

10プロジェクトなら10個の並行リスナー。各リスナー発火時に全タスク配列を再構築するため **O(n × m)** のパフォーマンスコスト。

**改善案:**
```typescript
// Firestoreの `in` クエリで1つにまとめる（最大30件まで）
const qProjectTasks = query(
  collection(db, 'tasks'),
  where('projectId', 'in', projectIds.slice(0, 30))
);
```

#### 問題: 楽観的更新の追跡がZustand外

**`src/store/helpers/pendingTasks.ts`**

```typescript
// グローバルSetでZustandの外で管理
const pendingTaskIds = new Set<string>();
```

Zustandの状態管理と分離されているため、リスナーのタイミング次第でレースコンディションが発生する可能性がある。Firestoreリスナーが発火した瞬間に楽観的更新の途中だった場合、データが上書きされるリスク。

**改善案:** `pendingTaskIds` をZustandのstateに統合し、アトミックに管理する。

#### 問題: AIツールが毎回Firestoreにクエリ

**`src/lib/ai/tools.ts`** (line 98付近)

```typescript
// 同一会話内で複数回ツールが呼ばれるたびにDBアクセス
const snapshot = await db
  .collection('tasks')
  .where('userId', '==', context.userId)
  .where('date', '==', context.currentDate)
  .get();
```

キャッシュがないため、1会話で5回ツール呼び出しがあれば5回DBアクセスが発生。

### 2.3 バンドルサイズの最適化

#### 問題: dynamic importの未活用

以下の重量級ライブラリがトップレベルインポート:

| ライブラリ | サイズ目安 | 使用箇所 | 対策 |
|-----------|----------|----------|------|
| `framer-motion` | ~50KB gzip | アニメーション | 使用コンポーネントのみdynamic import |
| `react-calendar` | ~15KB gzip | CalendarView.tsxのみ | `next/dynamic` で遅延ロード |
| `react-markdown` | ~20KB gzip | ChatMessage.tsxのみ | `next/dynamic` で遅延ロード |
| `@dnd-kit/*` | ~25KB gzip | DnD系のみ | `next/dynamic` で遅延ロード |
| `driver.js` | ~10KB gzip | ツアーのみ | `next/dynamic` で遅延ロード |
| `stripe` | ~40KB gzip | billingのみ | サーバーサイドのみに限定（確認必要） |

```typescript
// 改善例: CalendarView
const CalendarView = dynamic(() => import('@/components/CalendarView'), {
  loading: () => <CalendarSkeleton />,
  ssr: false,
});
```

#### 問題: Storybookのデフォルトストーリーがバンドルに含まれうる

`src/stories/` にStorybook初期テンプレート（Button, Header, Page）がそのまま残っている。`tsconfig.json` で `src/stories` はexcludeされているが、treeShakingの確認が必要。

### 2.4 Next.jsのキャッシュ戦略・SSR/SSG

#### 問題: SSR/SSGの活用不足

ほぼ全ページが `'use client'` でクライアントサイドレンダリング。サーバーサイドで処理されているのは:

- `/guide/*` (静的ドキュメント) → `generateStaticParams()` あり ✅
- `/privacy`, `/terms` (fs.readFileSync) ✅
- `/login`, `/signup` (サーバーコンポーネントでAuthFormに委譲) ✅

**問題:** ランディングページ (`/[locale]/page.tsx`) が `useTranslations()` を使用しているが `'use client'` ディレクティブがない。next-intlのサーバー側APIを使うべきか、`'use client'` を付けるべきか整理が必要。

#### 問題: エラーバウンダリの欠如

`error.tsx` ファイルがどのルートセグメントにも存在しない。レンダリングエラーが発生した場合、ユーザーに白画面が表示される。

```
// 最低限必要なファイル
src/app/[locale]/error.tsx        ← アプリ全体のフォールバック
src/app/[locale]/tasks/error.tsx  ← メイン機能の個別ハンドリング
```

#### 問題: SEOメタデータの欠如

- ページごとの動的メタデータなし（全ページがルートの `title: "Taskel"` を継承）
- Open Graphタグなし
- 構造化データ（JSON-LD）なし
- canonical URLなし

---

## 3. テスト・品質保証

### 3.1 テストカバレッジ

#### 🚨 致命的: ユニットテスト・統合テストが0件

`src/` 配下に `.test.*` / `.spec.*` ファイルが**1つも存在しない**。

| テスト種類 | 状態 | 最低限必要なカバレッジ |
|-----------|------|---------------------|
| ユニットテスト | ❌ なし | Zustandストア、ユーティリティ関数 |
| 統合テスト | ❌ なし | APIルート、Firebase連携 |
| E2Eテスト | ⚠️ スクリーンショットのみ | ユーザーフロー（タスクCRUD、認証） |
| コンポーネントテスト | ⚠️ Storybook初期テンプレートのみ | 主要コンポーネント（TaskItem, AddTaskModal） |

**特にテストが必要な箇所:**

1. **`src/store/slices/taskSlice.ts`** — タスクCRUD、楽観的更新、仮想タスク生成
2. **`src/app/api/tasks/route.ts`** — 認証・認可・入力バリデーション
3. **`src/lib/ai/tools.ts`** — AIツールの実行結果
4. **`src/lib/ai/dateResolver.ts`** — 日付解析ロジック
5. **`src/lib/sectionUtils.ts`** — セクション割り当てロジック

### 3.2 E2Eテスト・Storybook

#### E2Eテストの現状

`e2e/` 配下に存在するテスト:
- `screenshots.spec.ts` — スクリーンショット撮影のみ
- `doc-screenshots.spec.ts` — ドキュメント用スクリーンショット

**問題:** これらは「テスト」ではなくスクリーンショット撮影スクリプト。アサーションがほぼない。実際のユーザーフロー（タスク作成 → 編集 → 完了 → 削除）のE2Eテストが存在しない。

#### Storybookの現状

`.storybook/` は設定されているが、`src/stories/` にはStorybook初期テンプレート（Button, Header, Page）しかない。**プロジェクト固有のコンポーネントストーリーは0件**。

```
// 必要なストーリー例
src/components/TaskItem.stories.tsx
src/components/AddTaskModal.stories.tsx
src/components/AIChatPanel.stories.tsx
src/components/BoardView.stories.tsx
```

### 3.3 CI/CDパイプライン

#### 現状の構成

```
.github/workflows/
├── ci.yml           → lint + build（main/develop）
├── deploy-dev.yml   → Vercelプレビューデプロイ（develop）
└── playwright.yml   → E2Eテスト（main）
```

#### 問題点

1. **テスト実行がCIに含まれていない** — `ci.yml` は lint と build のみ。`npm test` がない
2. **型チェックが個別ステップにない** — `tsc --noEmit` が明示的にCIに含まれていない（buildに暗黙的に含まれるが、エラー箇所の特定が困難）
3. **セキュリティスキャンなし** — `npm audit`, Snyk, Dependabot等が未設定
4. **Playwright CIのセットアップが不完全** — 開発サーバーの起動設定がworkflowに含まれていない（playwright.configのwebServerに依存しているが、環境変数が本番CIで利用可能か不明）

---

## 4. 開発体験・保守性

### 4.1 コードの一貫性

#### 命名規則

| パターン | 例 | 一貫性 |
|---------|---|--------|
| コンポーネント | PascalCase | ✅ 一貫 |
| ファイル名 | PascalCase.tsx | ✅ 一貫 |
| Zustandスライス | camelCase + Slice | ✅ 一貫 |
| APIルート | kebab-case/route.ts | ✅ 一貫 |
| ユーティリティ | camelCase.ts | ✅ 一貫 |

**問題:** propsの命名が不統一

```typescript
// AddTaskModal.tsx
taskToEdit?: Task | null;     // "to edit" パターン
existingTask?: Task | null;   // "existing" パターン（同じ意味？）

// TaskItem.tsx
onEdit: (task: Task) => void;
onPlay?: (task: Task) => void;
onStop?: () => void;           // なぜtaskを引数に取らない？
```

#### ファイル構成の問題

**🚨 問題: AddTaskModal.tsx が919行**

1つのファイルに以下が全て含まれている:
- タスク作成フォーム
- タスク編集フォーム
- 添付ファイルアップロード
- タグ管理
- AIチャット連携
- コメントスレッド
- セクション自動割り当て
- 日付・時間入力

**改善案:**
```
src/components/task/
├── AddTaskModal.tsx        ← 200行以内のオーケストレーター
├── TaskForm.tsx            ← フォーム入力
├── TaskAttachments.tsx     ← 添付ファイル管理
├── TaskTagSelector.tsx     ← タグ選択
├── TaskDatePicker.tsx      ← 日付入力
└── TaskAIAssistant.tsx     ← AI連携
```

**同様に巨大なファイル:**
- `src/app/[locale]/projects/[id]/page.tsx` — 597行
- `src/app/[locale]/analytics/page.tsx` — 473行
- `src/components/TaskList.tsx` — 443行以上

### 4.2 セキュリティ問題

#### 🚨 致命的: Task APIの認証バイパス

**`src/app/api/tasks/route.ts` (line 10)**

```typescript
export async function POST(req: Request) {
  const { task, action } = await req.json();
  const userId = task.userId; // ← クライアントから送られたuserIdをそのまま使用

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ... userIdの検証なしにFirestoreへ書き込み
```

**攻撃シナリオ:**
```bash
curl -X POST /api/tasks \
  -d '{"task": {"userId": "victim_uid", "title": "hacked"}, "action": "create"}'
```

認証トークンの検証がないため、**任意のユーザーのタスクを作成・更新可能**。

**他のAPIルートは正しく認証を実装している:**
- `src/app/api/ai/chat/route.ts` — Bearer トークン検証あり ✅
- `src/app/api/invitations/route.ts` — トークン検証あり ✅
- `src/app/api/billing/checkout/route.ts` — トークン検証あり ✅

**修正必須:**
```typescript
export async function POST(req: Request) {
  // 1. トークン検証
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await getAuth().verifyIdToken(token);
  const uid = decoded.uid;

  const { task, action } = await req.json();
  task.userId = uid; // ← トークンからUIDを取得、クライアントの値を上書き
  // ...
}
```

**補足:** Firestoreのセキュリティルールで `request.resource.data.userId == request.auth.uid` が設定されているため、**クライアントSDKからの直接書き込みは防御されている**。しかしAPIルート経由（Admin SDK使用）ではルールがバイパスされるため、API側での検証が必須。

#### 問題: 入力バリデーションの欠如

全APIルートでリクエストボディのスキーマバリデーションがない。

```typescript
// 現状: クライアントのデータをそのままDBに保存
const taskData = { ...task, updatedAt: Date.now() };
await docRef.set(taskData);

// 改善案: Zodでバリデーション
import { z } from 'zod';
const TaskSchema = z.object({
  title: z.string().min(1).max(500),
  memo: z.string().max(10000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  estimatedMinutes: z.number().min(0).max(1440).optional(),
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  // ...
});
```

#### 問題: レート制限なし

全APIルートでレート制限が未実装。AI chatにはクォータ管理があるが、時間ベースのレート制限はない。

- 招待メール送信 (`/api/projects/[projectId]/invite`) — スパム送信可能
- タスク作成 (`/api/tasks`) — 大量データ投入可能
- コメント投稿 (`/api/tasks/[taskId]/comments`) — スパム投稿可能

### 4.3 Firestoreリスナーのメモリリーク

**`src/store/slices/authSlice.ts`**

```typescript
let unsubShared: (() => void) | null = null;
let unsubProjects: (() => void) | null = null;
```

クロージャ変数でサブスクリプションを追跡しているが:
- `setUser` が高速で連続呼び出しされた場合、前のサブスクリプションがリークする可能性
- プロジェクトメンバーシップ変更時のリスナー再作成で蓄積する可能性
- `workspaceSlice.ts` の `subscribeToComments` が返すunsubscribeが呼ばれない場合のリーク

### 4.4 開発者がハマりそうなポイント

1. **`firebaseAdmin.ts` のクライアント/Admin SDK混在**
   - `getDb()` は Admin SDK を使用するが、storeの `authSlice.ts` はクライアントSDK (`firebase/firestore`) を使用
   - 新しい開発者がどちらを使うべきか迷う

2. **`pendingTasks.ts` のグローバルState**
   - Zustandの外にあるため、DevToolsで追跡できない
   - HMR（Hot Module Replacement）でリセットされる可能性

3. **`TaskContext.tsx` が存在するが未使用**
   - コンテキストが定義されているがどこからもProvideされていない
   - 削除するか使うか決めるべき

4. **`next.config.ts` のrewrite**
   ```typescript
   { source: '/api/chat', destination: '/api/ai/chat' }
   ```
   - なぜ `/api/chat` が別途存在するのか不明。直接 `/api/ai/chat` を使えば良い

5. **型定義の日付フォーマットの曖昧さ**
   ```typescript
   assignedYear: string;    // "2024"
   assignedMonth?: string;  // "2024-01"
   assignedWeek?: string;   // "2024-W01"
   assignedDate?: string;   // "YYYY-MM-DD"
   ```
   ランタイムでフォーマットの検証がないため、不正な値がDBに保存される可能性。

### 4.5 Gemini生成コード特有の問題パターン

1. **「動くから良い」パターン**
   - `tasks/route.ts` の認証: コメントに `// Ensure userId is passed or derived from auth token if needed` とあるが実装されていない。Geminiは「TODOコメント付きの不完全な実装」を生成しがち

2. **冗長な分岐**
   ```typescript
   // tasks/route.ts line 20-27
   if (task.projectId) {
     collectionRef = db.collection('tasks');
     docRef = collectionRef.doc(task.id);
   } else {
     collectionRef = db.collection('tasks');
     docRef = collectionRef.doc(task.id);
   }
   ```
   if/elseの中身が完全に同一。おそらく以前は異なるコレクションを使っていたリファクタの残骸。

3. **過剰なprops drilling**
   - `AddTaskModal` が `useStore()` から15以上のプロパティを一括取得
   - 必要なものだけ個別セレクターで取得すべき

4. **エラーハンドリングの表面的な実装**
   ```typescript
   } catch (error: any) {
     console.error('API Error:', error);
     return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
   }
   ```
   `error.message` がそのままクライアントに返される。スタックトレースや内部情報がリークする可能性。

5. **コメントの日本語/英語混在**
   - Firestoreルール: 日本語コメント
   - APIルート: 英語コメント
   - Zustandスライス: 日本語コメント
   - 一貫性がない（機能には影響しないが保守性に影響）

### 4.6 Firestoreコレクション設計の不統一

```
/tasks/{taskId}              ← グローバルコレクション（userId でフィルタ）
/tags/{tagId}                ← グローバルコレクション（userId でフィルタ）
/users/{userId}/routines     ← サブコレクション
/users/{userId}/sections     ← サブコレクション
```

個人データなのにグローバルコレクションに置くものとサブコレクションに置くものが混在。セキュリティルールの複雑化と、クエリ設計の不統一を招いている。

---

## 5. もし1から作り直すなら

### 5.1 Claude Code / Codex で開発するアプローチ

#### フェーズ1: 基盤設計（1-2日）

```
1. CLAUDE.md に技術スタック・ディレクトリ構成・コーディング規約を定義
2. Zodスキーマを先に定義（型 = 入力バリデーション = ドキュメントの一元管理）
3. Firestoreセキュリティルールを先に書く（データモデルの設計が強制される）
4. 認証ミドルウェアを1箇所に集約（middleware.ts）
```

**具体的なディレクトリ構成:**
```
src/
├── schemas/           ← Zodスキーマ（型生成 + バリデーション兼用）
│   ├── task.ts
│   ├── project.ts
│   └── user.ts
├── app/
│   ├── api/
│   │   └── _lib/     ← 認証ヘルパー、エラーハンドリング共通化
│   └── [locale]/
├── components/
│   ├── ui/            ← 汎用UI（Button, Modal, Input）
│   ├── task/          ← タスク関連（分割済み）
│   └── layout/        ← レイアウト関連
├── store/
│   ├── slices/
│   └── middleware/    ← Zustandミドルウェア（devtools, persist）
├── lib/
│   ├── firebase/
│   │   ├── client.ts
│   │   ├── admin.ts
│   │   └── listeners.ts  ← リスナー管理を集約
│   └── ai/
└── hooks/
```

#### フェーズ2: コア機能実装（3-5日）

```
1. 認証フロー + ミドルウェア
2. タスクCRUD（API + Store + UI）— テスト駆動
3. セクション管理
4. プロジェクト管理
```

**各機能の実装サイクル:**
```
Schema定義 → APIルート → Zustandスライス → コンポーネント → テスト
```

#### フェーズ3: AI機能・高度な機能（3-5日）

```
1. AI Chat（Vercel AI SDK）
2. カレンダービュー群
3. 分析ダッシュボード
4. Stripe連携
```

### 5.2 AI生成コードの品質を担保するワークフロー

#### 原則: 「生成してからレビュー」ではなく「制約を与えてから生成」

1. **Zodスキーマファースト**
   - 型定義とバリデーションを同時に解決
   - APIルートは必ずスキーマでバリデーションしてからDB操作
   - AIに「このスキーマに従うAPIルートを書いて」と指示

2. **テスト駆動（TDD with AI）**
   ```
   手順:
   a. テストケースを先に書く（人間 or AI）
   b. AIに「このテストを通す実装を書いて」と指示
   c. テストが通ることを確認
   d. AIに「リファクタリングして」と指示
   ```

3. **セキュリティゲート**
   - CIに以下を組み込む:
     - `npm audit --audit-level=moderate`
     - ESLintセキュリティプラグイン（`eslint-plugin-security`）
     - `tsc --noEmit`（型チェック）
     - Zodスキーマとの整合性チェック

4. **コンポーネントサイズ制限**
   - ESLintルールで1ファイル300行以上は警告
   - AI生成時に「200行以内に収めて」と明示的に指示

5. **コードレビューチェックリスト（AI生成コード向け）**
   ```
   □ 認証トークンの検証があるか？
   □ 入力バリデーションがあるか？
   □ error.messageをそのままクライアントに返していないか？
   □ useEffectの依存配列は正しいか？
   □ クリーンアップ関数は返しているか？
   □ if/else の中身が同一でないか？（リファクタ残骸チェック）
   □ TODOコメントが残っていないか？
   □ `any` 型が使われていないか？
   ```

6. **CIパイプラインの改善案**
   ```yaml
   jobs:
     typecheck:
       - tsc --noEmit
     lint:
       - eslint with security plugin
     unit-test:
       - vitest run --coverage
       - coverage threshold: 60% (段階的に引き上げ)
     integration-test:
       - vitest run --config vitest.integration.config.ts
     e2e:
       - playwright test
     security:
       - npm audit
       - snyk test (optional)
     build:
       - next build
   ```

### 5.3 最優先で修正すべき項目（既存コードベース）

| 優先度 | 項目 | 工数目安 | 対象ファイル |
|--------|------|---------|-------------|
| P0 | Task API認証修正 | 1時間 | `src/app/api/tasks/route.ts` |
| P0 | Comments API認証確認 | 30分 | `src/app/api/tasks/[taskId]/comments/route.ts` |
| P1 | Zod導入 + API入力バリデーション | 4時間 | `src/app/api/` 全体 |
| P1 | エラーレスポンスのサニタイズ | 2時間 | 全APIルート |
| P1 | Vitestセットアップ + Store基本テスト | 4時間 | `src/store/slices/taskSlice.test.ts` |
| P2 | AddTaskModal分割 | 4時間 | `src/components/AddTaskModal.tsx` |
| P2 | Firestoreリスナー管理の改善 | 3時間 | `src/store/slices/authSlice.ts` |
| P2 | error.tsx追加 | 1時間 | `src/app/[locale]/error.tsx` |
| P2 | レート制限ミドルウェア | 3時間 | `src/middleware.ts` |
| P3 | useMemo/useCallback最適化 | 3時間 | 各コンポーネント |
| P3 | dynamic import導入 | 2時間 | 重量級ライブラリ使用箇所 |
| P3 | SEOメタデータ追加 | 2時間 | 各ページ |
| P3 | 未使用コード削除（TaskContext等） | 1時間 | 各所 |

---

## 付録: ファイル別問題マップ

| ファイル | 行数 | 主要な問題 |
|---------|------|-----------|
| `src/app/api/tasks/route.ts` | 66 | 🚨 認証なし、バリデーションなし、冗長なif/else |
| `src/components/AddTaskModal.tsx` | 919 | 🚨 巨大すぎ、責務過多 |
| `src/store/slices/authSlice.ts` | ~200 | メモリリーク、N+1リスナー |
| `src/components/TaskList.tsx` | 443 | useMemo不足、SectionContainer未分離 |
| `src/components/RightSidebar.tsx` | 305 | フィルタロジック未メモ化 |
| `src/components/AIChatPanel.tsx` | 345 | useEffect依存配列の問題 |
| `src/lib/ai/tools.ts` | ~600 | DBキャッシュなし、入力長制限なし |
| `src/app/[locale]/projects/[id]/page.tsx` | 597 | 巨大、分割推奨 |
| `src/app/[locale]/analytics/page.tsx` | 473 | 巨大、計算ロジック分離推奨 |
| `src/store/helpers/pendingTasks.ts` | 17 | Zustand外のグローバルstate |
| `src/contexts/TaskContext.tsx` | 45 | 未使用、削除推奨 |

---

*レビュー完了。P0項目（認証問題）は本番環境にデプロイされている場合、即座に修正が必要です。*
