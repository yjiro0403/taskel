# taskel コードレビュー

レビュー日: 2026-03-30

対象は `Next.js App Router + Firebase + Zustand` 構成の taskel です。結論から言うと、UI の試作速度は出ていますが、`認証/認可の境界`, `Firestore モデルの一貫性`, `Zustand ストアへの責務集中` が崩れており、このまま機能追加すると不具合と権限事故がかなり増える状態です。

---

## 最重要 findings

### 1. `【これはまずい】 /api/tasks` が未認証で Admin SDK 書き込みできる
- 該当: `src/app/api/tasks/route.ts:6-54`
- 問題:
  - Bearer token 検証がなく、`task.userId` を信じてそのまま `Admin SDK` で `tasks` コレクションへ書いています。
  - `action === 'update'` でも既存ドキュメント所有者確認がありません。
  - つまり、HTTP でこの API を直接叩ければ、任意の `task.id` / `userId` / `projectId` を指定して作成・上書きできます。Firestore Rules は Admin SDK ではバイパスされるので、防波堤になりません。
- 影響:
  - 他人のタスク改ざん、プロジェクト汚染、データ破壊が可能です。
- 改善案:
  - API で必ず `Authorization: Bearer <idToken>` を検証し、`uid` はトークンからのみ採用する。
  - `zod` などで入力スキーマを検証する。
  - update 時は既存タスクを読み、`owner` または `project member` だけを許可する。
  - 可能なら Server Action/BFF に統一し、クライアント直書きと API 経由を混在させない。

### 2. `【これはまずい】 /api/onboarding` も未認証で、しかもオンボーディングタスクを書き込む場所が実装とズレている
- 該当: `src/app/api/onboarding/route.ts:4-17`, `src/app/api/onboarding/route.ts:72-89`, `src/store/slices/authSlice.ts:31-47`, `src/store/slices/authSlice.ts:157-163`
- 問題:
  - API は `userId` を body から受けて未認証のまま `users/{userId}` 配下へ書き込みます。
  - さらにオンボーディングタスクは `users/{userId}/tasks` に作っていますが、クライアントは `tasks` グローバルコレクションだけを購読しています。
- 影響:
  - 他人のユーザー領域へデータを書けます。
  - 初回オンボーディングタスクは実際には画面に出ない可能性が高いです。設計移行途中の残骸がそのまま本番経路に残っています。
- 改善案:
  - 認証を必須化し、`userId` はトークン由来に限定する。
  - データモデルを一本化する。今後 `tasks` をグローバルに寄せるならオンボーディングも `tasks` に書く。
  - 旧 `users/{uid}/tasks` を完全に廃止するか、移行処理を一度だけ実行してコードから削除する。

### 3. `【これはまずい】 権限モデルが API / Rules / クライアントで一致していない`
- 該当:
  - `firestore.rules:39-50`
  - `src/app/api/tasks/[taskId]/comments/route.ts:31-35`, `89-93`
  - `src/app/api/ai/workspace/process/route.ts:57-61`
  - `src/app/api/ai/workspace/reply/route.ts:57-61`
- 問題:
  - Firestore Rules では project task は `project member` なら読めます。
  - しかしコメント API と AI Workspace API は `task.userId === uid` でしか通しません。
  - つまり Firestore 上は読める/更新できる前提の shared task なのに、API 経由の機能だけ owner 限定になります。
- 影響:
  - 共有タスクでコメント不可、AI 機能不可など、権限の見え方が画面と API でズレます。
  - 不具合が再現しにくく、権限ロジックの保守コストが上がります。
- 改善案:
  - `canAccessTask`, `canEditTask`, `canUseAIWorkspace` をサーバー側共通関数に切り出して全 API で共有する。
  - Firestore Rules と API の両方で、project membership を同じ意味に揃える。

### 4. `【これはまずい】 コメント API で user が `authorType: 'ai'` を偽装できる
- 該当: `src/app/api/tasks/[taskId]/comments/route.ts:81-106`
- 問題:
  - `authorType` をクライアント入力そのままで保存しており、通常ユーザーが `ai` コメントを投稿できます。
- 影響:
  - 監査ログ・会話履歴・AI 処理トリガーの意味が壊れます。
  - 将来的に AI コメントだけを信頼するロジックを追加すると事故になります。
- 改善案:
  - `/comments` の一般 POST では `authorType` を常に `'user'` に固定する。
  - AI コメントはサーバー内部専用経路からのみ書く。

### 5. `【これはまずい】 Firestore ルールの invitation フィールド名が実データと不一致`
- 該当: `firestore.rules:101-112`, `src/types/index.ts:182-191`, `src/app/api/invitations/route.ts:59-68`
- 問題:
  - ルールは `resource.data.invitedBy` を見ていますが、実際の型と API は `inviterId` を使っています。
- 影響:
  - 招待の read/delete 判定が意図通り動きません。
  - 「通るはずの権限が通らない」か、将来フィールド名を直したときに別の破綻を生みます。
- 改善案:
  - 命名を `inviterId` に統一し、Rules / Type / API を揃える。
  - 招待系はテストを追加する。ここは手で確認すると漏れます。

---

## アーキテクチャ設計レビュー

### 1. Zustand ストアが巨大なアプリケーションサービス層になっており、責務が多すぎる
- 該当: `src/store/useStore.ts:20-34`, `src/store/types.ts:13-114`
- 問題:
  - 1つの store に tasks / auth / billing / AI / workspace / calendar / goals が全部入っています。
  - 型上は slice 分割されていますが、実態は単一グローバルストアで、副作用も相互依存も強いです。
  - 例: `authSlice` が `fetchBillingInfo()` を直接呼ぶ (`src/store/slices/authSlice.ts:174-175`)。
- 影響:
  - 機能横断で再レンダリング・依存追跡・テストが難しくなります。
  - 「状態」と「ユースケース」が分離されていないため、変更時の破壊範囲が大きいです。
- 改善案:
  - `client state` と `server state` を分ける。
  - Firestore の購読結果は `TanStack Query + listener adapter` か、少なくとも domain 別 store に分離する。
  - `auth`, `ui`, `task composer`, `ai chat` は別 store/別 provider に分離した方がよいです。

### 2. App Router を使っているが、データ取得戦略はほぼ SPA 的で Server Component の利点を使えていない
- 該当: `src/app/[locale]/layout.tsx:43-53`, `src/components/AuthProvider.tsx:19-97`, `src/app/[locale]/projects/[id]/page.tsx:1-26`
- 問題:
  - ルート配下全体を `AuthProvider` で client 化し、認証後のデータ取得はほぼ全部 Firestore client listener に寄せています。
  - project detail も client page で `use(params)` + Zustand 依存です。
- 影響:
  - 初期表示が認証・購読完了に強く依存し、SEO/TTFB/partial rendering の利点が薄いです。
  - App Router の採用コストだけ払って、中身は旧来 SPA になっています。
- 改善案:
  - 公開ページ、設定ページ、請求ページ、プロジェクト詳細など、Server Component で読めるものは server で読む。
  - 認証が必要な server route は `firebase-admin` で session cookie か token relay を整理する。
  - client component は操作系とインタラクションに限定する。

### 3. Firestore データモデルの移行途中がそのまま残っていて、一貫性が壊れている
- 該当:
  - `src/store/slices/taskSlice.ts:405-439` 相当の `migrateTasks`（実体は `src/store/slices/taskSlice.ts:410-439` 付近）
  - `src/app/api/onboarding/route.ts:15-16`
  - `src/store/slices/authSlice.ts:31-47`
- 問題:
  - `users/{uid}/tasks` と `tasks` グローバルコレクションが混在しています。
  - migrate 関数がまだ残っており、現行コードも旧モデルを一部参照しています。
- 影響:
  - 新旧データの取りこぼし、オンボーディング不整合、バグ再発の温床です。
- 改善案:
  - 現行モデルを決めて、migration を一度だけ実施し、旧パスを削除する。
  - Firestore schema の ADR を 1 枚書いた方がいいです。

### 4. project task 読み取りが project ごとの複数 `onSnapshot` になっており、スケールしにくい
- 該当: `src/store/slices/authSlice.ts:82-113`
- 問題:
  - 所属プロジェクト数だけ `where('projectId', '==', projectId)` の listener を張っています。
- 影響:
  - プロジェクト数に比例して購読数が増えます。
  - 将来的にチーム機能を伸ばすとクライアント負荷・課金ともに重くなります。
- 改善案:
  - `task memberships` を導入するか、プロジェクト詳細ページでだけ project task を購読する。
  - 「グローバルホーム画面で全 shared task を常時購読する」設計は見直した方がいいです。

### 5. 大型コンポーネントが UI + ドメインロジック + 副作用を抱え込みすぎている
- 該当:
  - `src/components/AddTaskModal.tsx:31-381` かつ全体 919 行
  - `src/components/TaskList.tsx:30-363`
  - `src/app/[locale]/projects/[id]/page.tsx:22-597`
- 問題:
  - `AddTaskModal` は task/goal 作成、タグ自動生成、添付ファイル upload、AI 会話、フォーム状態まで抱えています。
  - `TaskList` はスケジュール計算、DnD、ライトボックス、AI 起動、Google Calendar 連携まで持っています。
  - `projects/[id]/page.tsx` は表示・権限判定・編集・削除・milestone 管理を 1 ファイルに詰め込んでいます。
- 改善案:
  - `container + presentational` に分けるだけでもかなり改善します。
  - 例:
    - `useTaskEditorForm`
    - `TaskEditorFields`
    - `AttachmentPicker`
    - `AIConversationPanel`
    - `ProjectMilestonesSection`

---

## Firebase / Firestore 設計レビュー

### 1. client 直書きと server 経由書き込みが混在している
- 該当:
  - client 直書き: `src/store/slices/projectSlice.ts:12-57`, `src/store/slices/taskSlice.ts:181-299`
  - server 経由: `src/store/slices/taskSlice.ts:28-38`, `117-129`
- 問題:
  - タスク create/update は API 経由なのに、delete/bulk 操作/skip routine はクライアントから直接 Firestore に書いています。
  - project CRUD も client 直書きです。
- 影響:
  - 権限ロジックが 2 系統になります。
  - 「この操作だけ Rules 依存」「この操作だけ API 依存」という読みにくいシステムになります。
- 改善案:
  - どちらかに寄せるべきです。
  - 個人的には team/billing/AI があるので、`server routes / actions に統一` が妥当です。

### 2. Firestore Rules が field-level validation をほぼ持っていない
- 該当: `firestore.rules:27-60`
- 問題:
  - `tasks` では title くらいしか検証していません。`projectId`, `status`, `order`, `commentCount`, `aiStatus` などが無制限です。
  - `projects` も member なら update 全許可です (`firestore.rules:35`)。viewer でも Firestore 直更新できる設計です。
- 影響:
  - クライアント不具合や悪意ある書き込みで整合性を壊しやすいです。
- 改善案:
  - せめて `status in [...]`, `order is number`, `memberIds immutable except privileged flow`, `roles` 更新は owner/admin のみ、などの制約を入れる。
  - 重要更新は Rules ではなく API に寄せる方が現実的です。

### 3. Firestore subcollection comments 用のルールがなく、client subscribe 実装が死んでいる
- 該当: `firestore.rules:39-50`, `src/store/slices/workspaceSlice.ts:167-183`
- 問題:
  - `/tasks/{taskId}` の match は subcollection をカバーしません。
  - そのため `tasks/{taskId}/comments` への client `onSnapshot` は permission denied になります。
  - 実際、`ConversationSection` は polling に逃げています。
- 影響:
  - 使われないコードが残り、設計意図が不透明です。
- 改善案:
  - `match /tasks/{taskId}/comments/{commentId}` を追加するか、完全に API polling / SSE に寄せる。
  - 使わない `subscribeToComments` は消す。

### 4. invitation link 生成で `Origin` ヘッダをそのままメール/レスポンスに使っている
- 該当: `src/app/api/invitations/route.ts:76-80`, `src/app/api/projects/[projectId]/invite/route.ts:69-71`
- 問題:
  - `origin` は信用できません。リバースプロキシや細工されたリクエストで任意ホストにできます。
- 影響:
  - 招待メールでフィッシング用 URL を配る踏み台になります。
- 改善案:
  - `NEXT_PUBLIC_APP_URL` など固定の allowlist ベースで URL を生成する。

### 5. `users/lookup` が authenticated user なら任意メールの UID とプロフィールを列挙できる
- 該当: `src/app/api/users/lookup/route.ts:27-39`
- 問題:
  - ただログインしていれば任意メールの存在確認と UID 取得ができます。
- 影響:
  - ユーザー列挙・プライバシー漏えいです。
- 改善案:
  - 招待用途ならサーバー側で invite flow に閉じる。
  - `lookup` API は廃止か、project 権限と rate limit を付ける。

---

## Zustand / 状態管理レビュー

### 1. スライスが「状態」ではなく「Repository + UseCase + Listener manager」になっている
- 該当: `src/store/slices/authSlice.ts:17-193`, `src/store/slices/taskSlice.ts:21-448`, `src/store/slices/workspaceSlice.ts:35-192`
- 問題:
  - slice が Firestore listener 管理、HTTP 呼び出し、楽観更新、エラー通知まで持っています。
- 影響:
  - テストが非常に書きにくいです。
  - ロジックの再利用ができません。
- 改善案:
  - `services/` か `repositories/` を切り、store は state transition に寄せる。

### 2. ログアウト時の state reset が不完全
- 該当: `src/store/slices/authSlice.ts:190-193`
- 問題:
  - `tasks`, `routines`, `tags`, `sections` しか消しておらず、`projects`, `dailyNotes`, `weeklyNotes`, `monthlyNotes`, `taskComments`, `billing` などが残りえます。
- 影響:
  - ユーザー切り替え時に前ユーザーのデータが一瞬見えるリスクがあります。
- 改善案:
  - `resetStore()` を用意して auth change 時に全 domain を初期化する。

### 3. `unsubMonthlyNotes` を cleanup に入れ忘れている
- 該当: `src/store/slices/authSlice.ts:138-142`, `177-188`
- 問題:
  - monthly notes の購読解除が `unsubscribe` に入っていません。
- 影響:
  - メモリリーク、ログアウト後の更新混入、ユーザー切り替え時の race を起こします。
- 改善案:
  - 全 listener を配列で管理し、最後に一括 cleanup する。

### 4. `pendingTasks` に依存した Firestore listener 上書き回避は fragile
- 該当: `src/store/slices/authSlice.ts:36-45`, `src/store/slices/taskSlice.ts:53-59`
- 問題:
  - listener と楽観更新の競合を string id ベースの pending 管理で吸収しています。
  - bulk update / reorder / project change / delete では同じ粒度で扱えていません。
- 影響:
  - race condition が残ります。
- 改善案:
  - React Query mutation + invalidation、または mutation state を domain service 側で一元管理する。

---

## TypeScript / コード品質レビュー

### 1. `any` / `as` 逃げが多く、壊れた境界を型で隠している
- 該当:
  - `src/app/api/ai/chat/route.ts:10-14`
  - `src/components/AIChatPanel.tsx:65-95`, `105-108`, `154`
  - `src/components/TaskList.tsx:365-368`, `401`
  - `src/store/helpers/sanitize.ts:2-9`
  - `src/lib/firebase.ts:33-37`
- 問題:
  - 境界の不整合を `as any` で飲み込んでいます。
  - 特に `lib/firebase.ts` は null を SDK 型に偽装していて危険です。
- 改善案:
  - `zod` で API request/response を parse。
  - `FirebaseServices | null` を正面から型に載せる。
  - `TaskList` の `SectionContainer` には専用 props 型を付ける。

### 2. `sanitizeData` が shallow で、型も弱い
- 該当: `src/store/helpers/sanitize.ts:1-9`
- 問題:
  - shallow に `undefined` を落とすだけで、ネストや不正値は放置です。
- 改善案:
  - schema validation を server 側で行う。
  - helper は `Record<string, unknown>` ベースにし、用途を限定する。

### 3. `AddTaskModal` にハードコード fallback user が残っている
- 該当: `src/components/AddTaskModal.tsx:290-295`, `333-336`
- 問題:
  - タグ作成や新規 task payload で `user-1` を fallback にしています。
- 影響:
  - 未認証時や race 時に不正な `userId` を混入させます。
- 改善案:
  - 未認証なら submit 不可にする。
  - `userId` は server で確定する。

### 4. ユーザー通知が `alert()` と `console.error()` 中心で、UI として貧弱
- 該当:
  - `src/store/slices/taskSlice.ts:39-44`, `130-133`
  - `src/components/TaskList.tsx:79-84`
  - `src/components/AddTaskModal.tsx:112-131`
- 問題:
  - ユーザー向け通知、再試行、監視ログのレイヤーが分かれていません。
- 改善案:
  - toast 基盤を入れる。
  - サーバーエラーは構造化レスポンスで返し、UI でハンドリングする。

### 5. `react-hooks/rules-of-hooks` を回避している
- 該当: `src/components/TaskList.tsx:425-440`
- 問題:
  - IIFE 内で `useDndContext()` を呼び、ESLint を suppress しています。
- 影響:
  - 将来の条件分岐変更で hook 順序事故を起こしやすいです。
- 改善案:
  - `BottomDropZone` を別コンポーネント化する。

---

## セキュリティレビュー

### 1. 認証されていない書き込み API がある
- 該当: `src/app/api/tasks/route.ts:6-54`, `src/app/api/onboarding/route.ts:4-91`
- 判定: Critical

### 2. 権限判定が owner 固定で team 機能と矛盾している
- 該当: `src/app/api/tasks/[taskId]/comments/route.ts:31-35`, `89-93`
- 判定: High

### 3. user lookup によるユーザー列挙が可能
- 該当: `src/app/api/users/lookup/route.ts:27-39`
- 判定: High

### 4. invitation URL が Host/Origin injection に弱い
- 該当: `src/app/api/invitations/route.ts:76-80`, `src/app/api/projects/[projectId]/invite/route.ts:69-71`
- 判定: Medium

### 5. client から project を直接更新でき、Rules も member update 全許可
- 該当: `src/store/slices/projectSlice.ts:33-45`, `firestore.rules:35`
- 判定: High
- コメント:
  - 現状だと `viewer` 制御は UI の `canEditProject` に依存しているだけで、client を改造すれば Firestore 直更新を試せます。

---

## ディレクトリ構成レビュー

現状の `src/app`, `src/components`, `src/store`, `src/lib` という並び自体は普通ですが、責務境界が弱いです。

### 問題
- `src/components` に domain logic が多すぎる。
- `src/store` に persistence / API / listener / use case が入りすぎている。
- `src/lib` は Firebase 初期化、AI ツール、billing、utility が同居しており層が曖昧。

### 望ましい再編案
- `src/app`
  - route と page/layout だけ
- `src/features/tasks`
  - components
  - hooks
  - server
  - schemas
  - store or state
- `src/features/projects`
- `src/features/ai`
- `src/shared`
  - ui
  - lib
  - types
- `src/server`
  - firebase-admin
  - auth
  - repositories
  - services

feature-first に寄せた方が、Gemini 生成コードにありがちな「横断的肥大化」を抑えやすいです。

---

## もし 1 から作り直すなら

### 推奨スタック
- Next.js App Router
- TypeScript strict
- React Server Components を標準採用
- Server Actions / Route Handlers
- `zod` for schema validation
- `TanStack Query` for server state
- `Zustand` は UI state のみ
- `firebase-admin` or `Supabase` server client
- `vitest` + `Playwright`

### Firebase vs Supabase

#### Firebase を選ぶ場合
- 向いているケース:
  - listener 中心
  - Google Auth/Storage/Push を素早く使いたい
- ただし絶対条件:
  - Firestore Rules を本気で設計する
  - Admin SDK 経由 API と client SDK 直書きを混在させない
  - collection 設計を最初に固定する

#### Supabase を選ぶ場合
- このアプリではかなり相性が良いです。
- 理由:
  - team/project/task/comment の権限が RLS で書きやすい
  - relational model の方が `projects`, `memberships`, `tasks`, `comments`, `invitations`, `subscriptions` に自然
  - billing や analytics の集計も SQL 側でやりやすい
- 私なら:
  - `Supabase Postgres + RLS + Storage`
  - AI/billing だけ Next.js server

### 私ならこう設計する

#### 1. task と project membership をリレーショナルに分離する
- `projects`
- `project_members`
- `tasks`
- `task_comments`
- `tags`
- `task_tags`
- `goals`
- `attachments`

#### 2. 認可はサーバー側共通関数に集約する
- `assertCanReadTask`
- `assertCanEditTask`
- `assertCanManageProject`

#### 3. UI state と server state を混ぜない
- Zustand:
  - modal open/close
  - local draft
  - panel state
- Query / server:
  - tasks
  - comments
  - billing
  - project members

#### 4. フォームは entity ごとに分離する
- `TaskForm`
- `GoalForm`
- `ProjectForm`
- 今の `AddTaskModal` 方式で task/goal/AI/upload を全部積むのは避ける

#### 5. App Router は server-first にする
- project page: server で project を取得
- client component: editor / board / dnd だけ

---

## 直近の優先修正順

1. `src/app/api/tasks/route.ts` に認証・認可・入力検証を入れる
2. `src/app/api/onboarding/route.ts` を認証必須にし、書き込み先を現行スキーマに合わせる
3. invitation の field 名を `inviterId` に統一し、Rules を修正する
4. project/task/comment/AI の権限判定を server 側共通化する
5. ログアウト時 reset と listener cleanup を全面修正する
6. `AddTaskModal` と `TaskList` を分割する
7. `client Firestore write` と `server write` の二重系統をやめる

---

## 総評

このコードベースは「個人開発の初速」は出ていますが、今のままチーム機能・課金・AI を伸ばすのは危険です。特に `未認証 Admin API`, `不一致な権限モデル`, `移行途中の Firestore スキーマ残骸` は先に潰すべきです。

逆に言うと、UI レイヤーを全面作り直す必要はありません。まずは

- 認証/認可の再設計
- データモデル一本化
- store の責務削減

この3つをやれば、かなり健全な土台に戻せます。
