# Taskel レビュー統合ディスカッションレポート

**作成日**: 2026-03-30
**作成者**: シニアテックリード（統合レビュー）
**入力**: Codex アーキテクチャレビュー / ITコーディネートAI 品質検証レビュー

---

## 1. 合意点：両者が共通して指摘した問題

両レビュアーが独立して同じ問題を検出している箇所は、**確実に対処すべき技術的負債**である。

### 1.1 Task API の認証欠如（両者とも「致命的」判定）

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | Bearer token 検証なし、`task.userId` をそのまま信用して Admin SDK で書き込み | クライアントの userId を検証なしに使用、curl で任意ユーザーのタスク操作可能 |
| 影響範囲 | 他人のタスク改ざん・プロジェクト汚染・データ破壊 | 任意ユーザーのタスク作成・更新が可能 |
| 改善案 | `Authorization: Bearer <idToken>` 検証 + zod 入力検証 + 所有者確認 | 同様 + 他 API（ai/chat, invitations 等）は正しく実装済みであることを確認 |

**統合判断**: 完全合意。最優先で修正。ITCoord が「他の API は正しく認証している」と補足しているのは有用な情報で、既存の認証パターンをそのまま tasks/route.ts に適用すれば良い。工数は最小限（1時間程度）。

### 1.2 Onboarding API の認証欠如 + データモデル不整合

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | 未認証で `users/{userId}` 配下に書き込み、かつクライアントは `tasks` グローバルコレクションのみ購読 | （直接言及なし、ただしFirestoreコレクション設計の不統一として間接的に指摘） |

**統合判断**: Codex のみが具体的に指摘。ITCoord は Firestore コレクション設計の混在（グローバル vs サブコレクション）として一般化して触れている。onboarding API は実質的にデッドコードに近い状態で、書き込み先とクライアント購読先が一致しないため、**画面に表示されないデータを書いている可能性が高い**。認証修正と同時にデータモデルの一本化が必要。

### 1.3 巨大コンポーネント（AddTaskModal 919行）

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | task/goal 作成、タグ自動生成、添付ファイル、AI 会話、フォーム状態を1ファイルに集約 | 8つの責務を列挙、分割案を提示 |
| 他の巨大ファイル | TaskList (443行)、projects/[id]/page.tsx (597行) | 同じ3ファイル + analytics/page.tsx (473行) |

**統合判断**: 完全合意。分割方針も概ね一致（container + presentational / feature 単位）。ITCoord の分割案（TaskForm, TaskAttachments, TaskTagSelector 等）が具体的で実用的。

### 1.4 Firestore リスナーのN+1問題とメモリリーク

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | プロジェクト数だけ `onSnapshot` リスナーを張る設計 | 同じ + O(n×m) のパフォーマンスコスト算出、`in` クエリによる改善案 |
| メモリリーク | `unsubMonthlyNotes` が cleanup に入っていない | `setUser` 高速連続呼び出し時のサブスクリプションリーク |

**統合判断**: 完全合意。ITCoord の `in` クエリ改善案（最大30件まで）は即座に適用可能な具体策。Codex の monthly notes cleanup 漏れは実装レベルの具体的バグ。両方対処すべき。

### 1.5 Zustand ストアの責務過多

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | 1ストアに tasks/auth/billing/AI/workspace/calendar/goals が全部入り、slice が Repository+UseCase+Listener manager 化 | `useStore()` から15以上のプロパティを一括取得、pendingTasks が Zustand 外のグローバル State |
| 改善案 | client state と server state を分離、TanStack Query 導入 | pendingTasks を Zustand に統合、個別セレクターの使用 |

**統合判断**: 問題認識は一致。Codex は「TanStack Query で server state を分離」という根本解を提案、ITCoord は「まず pendingTasks を Zustand に統合」という段階的改善を提案。**現実的には ITCoord の段階的アプローチから始め、次フェーズで Codex の根本解に進むのが妥当。**

### 1.6 入力バリデーション（zod）の欠如

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 指摘 | API で zod 等によるスキーマ検証なし | 全 API ルートでリクエストボディのバリデーションなし、具体的な Zod スキーマ例を提示 |

**統合判断**: 完全合意。ITCoord の TaskSchema 例がそのまま使える。

---

## 2. 相違点・補完：片方だけの指摘で重要なもの

### 2.1 Codex のみが指摘（ITCoord の視点から評価）

#### 2.1.1 権限モデルの API / Rules / クライアント間不一致

Codex は Firestore Rules（project member なら読める）と API（`task.userId === uid` で owner 限定）の矛盾を詳細に指摘。コメント API と AI Workspace API で shared task が使えない問題。

**ITCoord 視点での評価**: ITCoord は認証の有無に注目したが、**認可ロジックの一貫性**まで踏み込んでいない。これはチーム機能を拡張する上で致命的になるため、Codex の指摘は極めて重要。`canAccessTask`, `canEditTask` の共通関数化は必須。

#### 2.1.2 コメント API での `authorType: 'ai'` 偽装

クライアントから `authorType` をそのまま保存できるため、通常ユーザーが AI コメントを投稿できる。

**ITCoord 視点での評価**: これは監査ログ・AI 処理トリガーの信頼性を壊す問題で、ITCoord がカバーしていないセキュリティ穴。サーバー側で `authorType` を強制的に `'user'` にするだけで修正可能。

#### 2.1.3 Firestore Rules の invitation フィールド名不一致（`invitedBy` vs `inviterId`）

ルールと実装でフィールド名が異なるため、権限判定が意図通り動かない。

**ITCoord 視点での評価**: ITCoord はこのレベルの詳細まで到達していない。Firestore Rules の静的解析が不足。テストで検出すべき類のバグ。

#### 2.1.4 `users/lookup` API によるユーザー列挙

認証済みユーザーなら任意メールの UID とプロフィールを取得可能。

**ITCoord 視点での評価**: ITCoord はレート制限の欠如を一般的に指摘したが、この API の具体的なプライバシーリスクには触れていない。project 権限スコープへの限定または API 廃止が必要。

#### 2.1.5 invitation URL の Host/Origin injection

`Origin` ヘッダをそのまま招待 URL に使用しており、フィッシング踏み台になりうる。

**ITCoord 視点での評価**: ITCoord は触れていないが、実際に攻撃に使われうるため `NEXT_PUBLIC_APP_URL` ベースに修正すべき。

#### 2.1.6 ハードコード fallback user `'user-1'`

AddTaskModal で未認証時に `'user-1'` を fallback として使用。

**ITCoord 視点での評価**: Gemini 生成コードの「動くから良い」パターンの典型例。ITCoord は Gemini パターンを一般的に分析したが、この具体的インスタンスは見逃している。

### 2.2 ITCoord のみが指摘（Codex の視点から評価）

#### 2.2.1 テストカバレッジ 0 件（「致命的」判定）

ユニットテスト・統合テストが一切なく、E2E もスクリーンショット撮影のみ。Storybook もテンプレートのみ。

**Codex 視点での評価**: Codex はテストに全く言及していない。これは大きな見落としで、ITCoord の指摘は正しい。テストなしでは認証修正やリファクタリングの安全性を担保できない。**vitest セットアップと最低限のストアテストは、セキュリティ修正と並行して進めるべき。**

#### 2.2.2 パフォーマンス最適化（useMemo/useCallback/React.memo）

TaskList, RightSidebar, MonthlyView, CalendarView, BoardView 等での再レンダリング最適化不足を具体的に指摘。

**Codex 視点での評価**: Codex はアーキテクチャレベルで「再レンダリング・依存追跡が難しい」と述べたが、具体的なコンポーネント別の最適化ポイントは挙げていない。ITCoord の指摘は実装改善に直結する。ただし優先度はセキュリティ・テストより低い。

#### 2.2.3 バンドルサイズ最適化（dynamic import）

framer-motion (~50KB), react-calendar (~15KB), react-markdown (~20KB), @dnd-kit (~25KB) 等のトップレベルインポート。

**Codex 視点での評価**: Codex は触れていない。UX 改善としては有効だが、機能に直結しない。P3 優先度で妥当。

#### 2.2.4 error.tsx の欠如

どのルートセグメントにも error.tsx がなく、レンダリングエラーで白画面になる。

**Codex 視点での評価**: Codex は App Router の活用不足を指摘したが、error boundary の具体的欠如には触れていない。本番運用上は重要。工数も小さい（1時間）ので早めに対処すべき。

#### 2.2.5 SEO メタデータの欠如

ページごとの動的メタデータ、OGP タグ、構造化データ、canonical URL がない。

**Codex 視点での評価**: Codex は「SEO/TTFB/partial rendering の利点が薄い」と一般論で触れたが、具体的なメタデータ対策は提案していない。B2C サービスなら重要だが、現段階では P3。

#### 2.2.6 CI/CD パイプラインの不完全さ

テスト実行なし、型チェック個別ステップなし、セキュリティスキャンなし。

**Codex 視点での評価**: Codex は CI/CD に言及していない。テスト基盤と合わせて整備すべき。

#### 2.2.7 レート制限の欠如

全 API ルートでレート制限未実装。招待メール送信、タスク作成、コメント投稿でスパムが可能。

**Codex 視点での評価**: Codex は触れていない。認証修正後の次フェーズで対処すべき。

#### 2.2.8 Gemini 生成コードの特有パターン分析

TODO コメント付き不完全実装、冗長な同一 if/else 分岐、過剰な props drilling、error.message のクライアント直返し。

**Codex 視点での評価**: Codex は `any`/`as` の乱用を指摘したが、Gemini 特有パターンの体系的分析はしていない。ITCoord の分析はコードレビューチェックリストとして有用。

#### 2.2.9 未使用コード（TaskContext.tsx）

定義されているがどこからも Provide されていないコンテキスト。

**Codex 視点での評価**: 小さいが、新規開発者の混乱を招く。削除すべき。

---

## 3. 優先順位の議論

### 3.1 両レポートの優先度比較

| Codex の優先順位 | ITCoord の優先順位 | 項目 |
|-----------------|-------------------|------|
| 1位 | P0 | Task API 認証修正 |
| 2位 | —（間接的） | Onboarding API 認証 + データモデル統一 |
| 3位 | — | invitation フィールド名統一 |
| 4位 | P0 (Comments) | 権限判定の共通化 |
| 5位 | — | ログアウト時 reset + listener cleanup |
| 6位 | P2 | AddTaskModal/TaskList 分割 |
| 7位 | — | client/server write 二重系統の統一 |
| — | P0 | テストカバレッジ 0 件 |
| — | P1 | Zod 導入 + 入力バリデーション |
| — | P1 | エラーレスポンスのサニタイズ |
| — | P2 | error.tsx 追加 |
| — | P2 | レート制限ミドルウェア |

### 3.2 統合優先順位（最終決定）

**原則**: セキュリティ > テスト基盤 > データ整合性 > アーキテクチャ改善 > パフォーマンス > DX

| 優先度 | 項目 | 根拠 | 工数目安 |
|--------|------|------|---------|
| **P0-1** | Task API 認証修正 | 両者合意の致命的脆弱性。既存パターンの横展開で即対応可能 | 1h |
| **P0-2** | Onboarding API 認証 + 書き込み先修正 | Codex 指摘、同じ脆弱性カテゴリ | 1h |
| **P0-3** | authorType 偽装の修正 | Codex 指摘、サーバー側で1行修正 | 0.5h |
| **P0-4** | invitation URL の Origin injection 修正 | Codex 指摘、フィッシング踏み台リスク | 0.5h |
| **P1-1** | Vitest セットアップ + API / Store 基本テスト | ITCoord 指摘、以降の修正の安全網として必須 | 4h |
| **P1-2** | Zod 導入 + 全 API 入力バリデーション | 両者合意 | 4h |
| **P1-3** | 権限判定の共通関数化（canAccessTask 等） | Codex 指摘、チーム機能の基盤 | 4h |
| **P1-4** | invitation フィールド名統一 + Firestore Rules 修正 | Codex 指摘、権限判定のサイレント不具合 | 2h |
| **P1-5** | エラーレスポンスのサニタイズ | ITCoord 指摘、情報漏洩防止 | 2h |
| **P1-6** | users/lookup API の制限 | Codex 指摘、プライバシーリスク | 1h |
| **P2-1** | ログアウト時 state reset + listener cleanup 全面修正 | 両者合意 | 3h |
| **P2-2** | Firestore リスナーの `in` クエリ統合 | 両者合意、ITCoord の具体策あり | 2h |
| **P2-3** | client/server write 二重系統の統一 | Codex 指摘、保守性の根本問題 | 8h |
| **P2-4** | error.tsx 追加 | ITCoord 指摘、白画面防止 | 1h |
| **P2-5** | AddTaskModal / TaskList 分割 | 両者合意 | 4h |
| **P2-6** | Firestore データモデル一本化（旧 `users/{uid}/tasks` 廃止） | Codex 指摘 | 4h |
| **P3-1** | useMemo/useCallback 最適化 | ITCoord 指摘 | 3h |
| **P3-2** | dynamic import 導入 | ITCoord 指摘 | 2h |
| **P3-3** | CI/CD 強化（型チェック、テスト実行、セキュリティスキャン） | ITCoord 指摘 | 3h |
| **P3-4** | SEO メタデータ追加 | ITCoord 指摘 | 2h |
| **P3-5** | レート制限ミドルウェア | ITCoord 指摘 | 3h |
| **P3-6** | 未使用コード削除（TaskContext 等） | ITCoord 指摘 | 1h |

---

## 4. 技術選定の議論

### 4.1 Firebase vs Supabase

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 現状評価 | Firebase の使い方に根本的問題（Admin SDK/client SDK 混在、Rules 不備、コレクション設計不統一） | 同様の問題認識（グローバル/サブコレクション混在） |
| Firebase 継続の条件 | Rules 本気設計、Admin SDK/client SDK 混在排除、コレクション設計固定 | 明示的な言及なし |
| Supabase 推奨度 | 「このアプリにはかなり相性が良い」。RLS、リレーショナルモデル、SQL 集計 | 明示的な比較なし |
| 1から作る場合 | `Supabase Postgres + RLS + Storage`、AI/billing だけ Next.js server | Firebase 前提で Zod スキーマファースト + セキュリティゲート |

**統合判断**:

Codex の Supabase 推奨には**技術的合理性がある**。理由：
- taskel はチーム/プロジェクト/タスク/コメント/招待/サブスクリプションという**リレーショナルなドメイン**
- 権限モデルが project membership ベースで、**RLS で自然に表現できる**
- 集計・分析機能があり、**SQL の方が Firestore より圧倒的に書きやすい**

ただし、**既存コードベースを今すぐ Supabase に移行する判断は時期尚早**。理由：
- Firebase のリアルタイムリスナーは taskel の UX コアに深く根ざしている
- 移行コストは実質的に全面書き直しに近い
- セキュリティ修正は Firebase 上でも1-2日で完了する

**結論**:
- **短期（今）**: Firebase 上でセキュリティ修正・認可共通化・データモデル統一を実施
- **中期（次メジャーバージョン）**: Supabase 移行を検討。その際は Codex のリレーショナルスキーマ設計（projects, project_members, tasks, task_comments, tags, task_tags, goals, attachments）を採用

### 4.2 状態管理

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 問題認識 | Zustand が UseCase+Repository+Listener manager 化 | pendingTasks が Zustand 外、15以上の props 一括取得 |
| 改善案 | TanStack Query で server state 分離、Zustand は UI state のみ | pendingTasks を Zustand に統合、個別セレクターの使用 |

**統合判断**: 段階的に進める。
1. **今すぐ**: pendingTasks を Zustand に統合 + 個別セレクター化（ITCoord 案）
2. **次フェーズ**: TanStack Query 導入で server state 分離（Codex 案）
3. **長期**: Zustand は modal/draft/panel の UI state のみに限定

### 4.3 テスト戦略

| 観点 | Codex | ITCoord |
|------|-------|---------|
| 言及度 | ほぼ言及なし（`vitest + Playwright` をスタック推奨で記載のみ） | 詳細に分析。テスト種別ごとの状態、必要なカバレッジ、TDD ワークフロー提案 |

**統合判断**: ITCoord のテスト戦略を全面採用。
- **テストフレームワーク**: vitest（ユニット/統合）+ Playwright（E2E）
- **優先テスト対象**: taskSlice → API routes → AI tools → dateResolver → sectionUtils
- **ワークフロー**: Schema 定義 → テスト → 実装 → リファクタ（TDD with AI）
- **CI 統合**: `tsc --noEmit` → lint → vitest → playwright → build
- **カバレッジ目標**: 初期 60%、段階的に引き上げ

---

## 5. 1から作り直す場合の最終提案

両者の設計提案を統合し、taskel の「Time Management OS」としての特性を踏まえた最終提案。

### 5.1 技術スタック

| レイヤー | 選定 | 根拠 |
|---------|------|------|
| フレームワーク | Next.js App Router | 両者合意。ただし Server Component を本気で活用 |
| 言語 | TypeScript strict | 両者合意 |
| DB | **Supabase Postgres + RLS** | Codex 推奨。リレーショナルドメインとの相性、RLS による認可の一元管理 |
| リアルタイム | Supabase Realtime（必要な箇所のみ） | Firebase リスナーの代替。全 entity 常時購読はしない |
| 認証 | Supabase Auth | Firebase Auth からの移行。OAuth 対応は同等 |
| ストレージ | Supabase Storage | ファイル添付用 |
| 状態管理（UI） | Zustand | 両者合意。UI state のみ |
| 状態管理（Server） | TanStack Query | Codex 推奨。Supabase client との相性も良い |
| スキーマ | Zod | 両者合意。型生成 + バリデーション兼用 |
| AI | Vercel AI SDK + Gemini/Claude | 既存踏襲 |
| テスト | vitest + Playwright | ITCoord 提案 |
| デプロイ | Vercel | 既存踏襲 |

### 5.2 ディレクトリ構成

Codex の feature-first 構成と ITCoord の schemas-first アプローチを統合：

```
src/
├── schemas/                  ← Zod スキーマ（型 + バリデーション一元管理）
│   ├── task.ts
│   ├── project.ts
│   ├── comment.ts
│   └── user.ts
├── app/
│   ├── api/
│   │   └── _lib/            ← 認証ヘルパー、エラーハンドリング共通化
│   │       ├── auth.ts      ← assertAuthenticated, assertCanAccessTask 等
│   │       └── errors.ts
│   └── [locale]/
│       ├── error.tsx        ← グローバルエラーバウンダリ
│       ├── layout.tsx       ← Server Component
│       └── tasks/
│           ├── page.tsx     ← Server Component（初期データ取得）
│           └── _components/ ← Client Components（操作系のみ）
├── features/                 ← Feature-first（Codex 案）
│   ├── tasks/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── queries/         ← TanStack Query hooks
│   ├── projects/
│   ├── ai/
│   └── billing/
├── shared/
│   ├── ui/                  ← 汎用 UI コンポーネント
│   ├── lib/                 ← ユーティリティ
│   └── types/
├── store/                   ← UI state のみ
│   ├── uiStore.ts           ← modal, panel, draft
│   └── middleware/
└── server/
    ├── db/                  ← Supabase client, migrations
    ├── auth/                ← 認可共通関数
    └── services/            ← ビジネスロジック
```

### 5.3 データモデル（Supabase Postgres）

Codex のリレーショナル設計をベースに拡張：

```sql
-- ユーザー
users (id, email, display_name, avatar_url, onboarded_at, plan, ...)

-- プロジェクト
projects (id, name, description, owner_id, created_at, ...)
project_members (project_id, user_id, role: 'owner'|'editor'|'viewer', joined_at)

-- タスク
tasks (id, title, memo, user_id, project_id?, status, date,
       estimated_minutes, actual_minutes, order, section_id?, ...)
task_tags (task_id, tag_id)
tags (id, name, color, user_id)

-- コメント
task_comments (id, task_id, author_id, author_type: 'user'|'ai', content, created_at)

-- ゴール
goals (id, user_id, title, type: 'yearly'|'monthly'|'weekly', period, ...)

-- 招待
invitations (id, project_id, inviter_id, invitee_email, status, created_at)

-- サブスクリプション
subscriptions (id, user_id, stripe_customer_id, plan, status, ...)
```

RLS ポリシー例：
```sql
-- タスクは所有者またはプロジェクトメンバーのみアクセス可能
CREATE POLICY task_access ON tasks
  USING (
    user_id = auth.uid()
    OR project_id IN (
      SELECT project_id FROM project_members WHERE user_id = auth.uid()
    )
  );
```

### 5.4 認可の一元管理

Codex の `assertCanReadTask` パターンを採用し、API / RLS / UI で統一：

```typescript
// server/auth/permissions.ts
export async function assertCanAccessTask(userId: string, taskId: string) {
  const task = await db.from('tasks').select().eq('id', taskId).single();
  if (task.user_id === userId) return task;
  if (task.project_id) {
    const member = await db.from('project_members')
      .select().eq('project_id', task.project_id).eq('user_id', userId).single();
    if (member) return task;
  }
  throw new ForbiddenError();
}
```

### 5.5 開発フロー

ITCoord の「制約を与えてから生成」原則を採用：

```
1. Zod スキーマ定義 → 型が自動生成される
2. テストケース作成 → 期待される振る舞いを定義
3. AI に実装を依頼 → スキーマとテストを制約として渡す
4. テスト通過確認 → CI で自動検証
5. コードレビュー → チェックリスト（認証、バリデーション、any 禁止等）
```

---

## 6. Gemini 生成コードの総合評価

### 6.1 強み

| 観点 | 評価 |
|------|------|
| **初速の速さ** | 両者とも認める。UI の試作速度は高い（Codex: 「個人開発の初速は出ている」） |
| **命名規則の一貫性** | ITCoord が確認。コンポーネント/ファイル/スライス/API の命名は統一されている |
| **Firebase 連携のボイラープレート** | 認証フロー、Firestore リスナー、Storage アップロード等の基本構成は動作する |
| **UI コンポーネント生成** | Tailwind CSS による UI 実装は概ね質が高い |

### 6.2 弱み

| 観点 | Codex の見方 | ITCoord の見方 | 統合評価 |
|------|-------------|---------------|---------|
| **セキュリティ** | 未認証 API、権限不整合を詳細に指摘 | TODO コメント付き不完全実装を「Gemini 特有」と分析 | **最大の弱点**。「動くから良い」で認証を後回しにする傾向が顕著 |
| **アーキテクチャ判断** | client/server 混在、データモデル移行途中を指摘 | if/else 同一分岐（リファクタ残骸）を指摘 | 設計判断を伴う変更で中途半端な状態を残しがち |
| **責務分離** | Zustand の UseCase 化、巨大コンポーネントを指摘 | 919行モノリシックコンポーネント、15+ props 一括取得を指摘 | 「1ファイルに全部入れる」傾向が強い。分割の判断ができない |
| **型安全性** | `any`/`as` 逃げを詳細に指摘 | `error: any` パターンを指摘 | 型エラーを `as any` で回避する傾向 |
| **テスト** | （言及なし） | テスト 0 件を「致命的」と判定 | テストコードを自発的に生成しない |
| **エラーハンドリング** | `alert()` と `console.error()` 中心を指摘 | error.message 直返しを指摘 | 表面的な実装で本番品質に達していない |

### 6.3 Gemini 生成コードへの対策（統合見解）

1. **認証・認可は AI に任せず人間がレビュー必須**。Gemini は「認証が必要」と認識していても TODO で止まる
2. **Zod スキーマを先に定義してから生成を依頼する**。型制約がない状態で生成させると `any` に逃げる
3. **1ファイル 300 行以内を明示的に指示する**。指示しないと無限に1ファイルに追記する
4. **テストを先に書かせてから実装を書かせる**。テストなしで実装を頼むとテストは生成されない
5. **リファクタリング後の残骸チェックを CI に組み込む**。同一 if/else、未使用 import、デッドコードの検出

---

## 7. 明日から着手すべきアクションリスト

優先度順。各項目は独立して着手可能。

### Day 1: セキュリティ緊急修正（本番稼働中なら即日）

- [ ] **`src/app/api/tasks/route.ts`**: Bearer token 検証を追加。`uid` はトークンからのみ採用。既存の `ai/chat/route.ts` の認証パターンを横展開する
- [ ] **`src/app/api/onboarding/route.ts`**: 同様に認証必須化。書き込み先を `tasks` グローバルコレクションに統一
- [ ] **`src/app/api/tasks/[taskId]/comments/route.ts`**: `authorType` をサーバー側で `'user'` に強制。AI コメントはサーバー内部経路のみ許可
- [ ] **`src/app/api/invitations/route.ts`** / **`src/app/api/projects/[projectId]/invite/route.ts`**: invitation URL を `NEXT_PUBLIC_APP_URL` ベースに変更
- [ ] **`src/app/api/users/lookup/route.ts`**: project membership スコープに限定、または廃止検討

### Day 2: テスト基盤 + バリデーション

- [ ] vitest セットアップ（`vitest.config.ts`, `src/store/slices/taskSlice.test.ts` 等）
- [ ] API ルート用の統合テスト基盤（認証モック含む）
- [ ] Zod スキーマ定義（Task, Project, Comment, Invitation）
- [ ] 全 API ルートに Zod バリデーション適用
- [ ] エラーレスポンスのサニタイズ（`error.message` を直接返さない）

### Day 3: 認可・データ整合性

- [ ] `canAccessTask`, `canEditTask`, `canManageProject` 共通関数をサーバー側に作成
- [ ] 全 API ルートで共通認可関数を使用するようリファクタ
- [ ] `firestore.rules` の `invitedBy` → `inviterId` 統一
- [ ] Firestore Rules に `tasks/{taskId}/comments/{commentId}` ルール追加（または完全 API 化）

### Day 4-5: アーキテクチャ改善

- [ ] ログアウト時の全 state reset 実装（`resetStore()`）
- [ ] listener cleanup の全面修正（monthly notes 含む全 unsubscribe を配列管理）
- [ ] Firestore リスナーを `in` クエリで統合
- [ ] `error.tsx` 追加（`src/app/[locale]/error.tsx` + 主要ルート）
- [ ] pendingTasks を Zustand state に統合

### Week 2: コンポーネント分割 + DX 改善

- [ ] AddTaskModal 分割（TaskForm, TaskAttachments, TaskTagSelector, TaskDatePicker, TaskAIAssistant）
- [ ] TaskList 分割（SectionContainer, BottomDropZone の別コンポーネント化）
- [ ] projects/[id]/page.tsx 分割（ProjectHeader, ProjectMilestones, ProjectSettings）
- [ ] CI/CD 強化（`tsc --noEmit`, vitest, playwright, npm audit）
- [ ] 未使用コード削除（TaskContext.tsx, 旧 migration 関数, Storybook テンプレート）

### Week 3+: パフォーマンス + 中期改善

- [ ] useMemo/useCallback 最適化（TaskList, RightSidebar, CalendarView）
- [ ] React.memo 適用（BoardView 内 Column, DraggableTask 等）
- [ ] dynamic import 導入（framer-motion, react-calendar, react-markdown, @dnd-kit）
- [ ] TanStack Query 導入検討（server state の Zustand 分離）
- [ ] Supabase 移行の技術検証（PoC）
- [ ] SEO メタデータ追加
- [ ] レート制限ミドルウェア実装

---

*本レポートは Codex アーキテクチャレビューと ITコーディネートAI 品質検証レビューを統合し、シニアテックリードの視点で優先順位付けと技術判断を行ったものです。*
