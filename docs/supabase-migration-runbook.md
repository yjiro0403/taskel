# Supabase 移行 Runbook

Taskel を Firebase から Supabase へ移行し、既存の実データを引き継いで運用開始するための手順書。

> このブランチ（`fix/security-and-validation` 系）は「コード側の移行実装」を仕上げた状態です。
> **実 Supabase プロジェクトへの migration 適用・実データ移行・動作検証は、この手順に沿って
> オーナー環境で実施する必要があります。** DB 接続を伴う検証は未実施です。

---

## 0. 前提

- Supabase プロジェクトを **新規作成**（AgiruOS とは別プロジェクト。org 内に作るのは可）。
- 移行元 Firebase の Service Account 鍵（Firestore/Storage 読み取り用）。
- Node 20+ / このリポジトリの `npm install` 済み。

---

## 1. 環境変数

`.env.local`（アプリ用）と移行スクリプト用の変数を `.env.example` を参考に設定する。最低限:

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | アプリのクライアント接続 |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー処理・移行スクリプト |
| `NEXT_PUBLIC_APP_URL` | 招待/Stripe リダイレクト基点（本番は実ドメイン） |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI 機能 |
| `STRIPE_*` / `NEXT_PUBLIC_STRIPE_*_PRICE_ID` | 課金（NEXT_PUBLIC 版は Vercel ビルド変数にも登録） |
| `SMTP_*` / `EMAIL_FROM` | 招待メール（未設定だと送信されずモック応答） |
| `FIREBASE_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS` | 移行元 Firestore 読み取り |
| `FIREBASE_STORAGE_BUCKET` | 移行元 Storage（添付コピー元） |

---

## 2. スキーマ（migration）適用

Supabase CLI（`supabase db push`）または SQL エディタで `supabase/migrations/*.sql` を **番号順に** 適用する。

- `001`〜`005`: 初期スキーマ・RLS・トリガー・制約
- **`006_nullable_task_placement.sql`**: `tasks.date` / `tasks.section_id` を nullable 化
  （日付なし/ゴール/バックログタスクを保存可能に）
- **`007_realtime_and_storage.sql`**: Realtime publication + REPLICA IDENTITY FULL、
  `attachments` バケット作成 + storage RLS

適用後に確認:
```sql
-- Realtime publication にテーブルが載っているか
select tablename from pg_publication_tables where pubname='supabase_realtime';
-- attachments バケットが存在するか
select id, public from storage.buckets where id='attachments';
```

---

## 3. Auth プロバイダ設定（Supabase ダッシュボード）

- Email/Password を有効化。
- Google OAuth を使うなら Provider 設定 + リダイレクト URL に `${APP_URL}/auth/callback` を登録。
- 「同一メールの自動リンク（confirm email）」の方針を決める（移行ユーザーとの二重作成回避）。

---

## 4. データ移行（dry-run → 本番）

```bash
# 1) まず dry-run で件数と警告を確認（DBには書き込まない）
npm run migrate:supabase -- --dry-run

# 2) 問題なければ本移行
npm run migrate:supabase

# 3) 移行ユーザーへ初回パスワード設定メールを送るなら（SMTP必須）
npm run migrate:supabase -- --send-reset-emails
```

移行スクリプトは冪等（`deterministicUuid` によるID決定的マッピング）で再実行可能。
本 Runbook 対応で以下のデータ安全性を確保済み:
- 日付なしタスク（ゴール/バックログ）を today に化けさせず `date=null` で保持
- セクション未解決タスクを skip せず `section_id=null` で投入
- `in_progress` をユーザー単位で1件に正規化（005 制約違反回避）
- goals の period-scope-check を満たすよう type/月/週を整合

**dry-run のログで `demoted ... in_progress` / `adjusted scope` / section=null 件数を必ず確認すること。**

---

## 5. デプロイ

- Vercel の環境変数に上記を登録（`NEXT_PUBLIC_*` はビルド時に焼き込まれるため必須）。
- Firebase 系の旧環境変数は削除。
- デプロイ後、Firebase を並行稼働させつつ移行後データで動作確認 → 問題なければ Firebase 退役。

---

## 6. 動作確認チェックリスト（実 Supabase で要検証）

- [ ] ログイン（Email/Password）・サインアップ・OAuth（`/auth/callback` が 404 にならない）
- [ ] 移行ユーザーの初回パスワード設定（後述の「残課題」参照）
- [ ] 通常タスクの作成/編集/完了/削除
- [ ] **週/月/年ゴール・バックログの作成/編集**（date/section nullable 化の検証）
- [ ] 日次⇄バックログのドラッグ移動が永続化される
- [ ] ルーチン表示・完了・日付移動（データ破壊なし）
- [ ] 並び替え（スナップバックなし）
- [ ] Realtime 同期（別タブ/共有プロジェクトで反映）
- [ ] 添付ファイル（後述の「残課題」参照）

---

## 7. 残課題（本セッションで未対応・要追加対応）

コード側で対応しきれていない、または実 Supabase 検証が必要な項目。優先度順:

1. **添付ファイルのアプリ側結線（未対応・機能欠落）**
   `tasks` に attachments 列がなく、`data.ts` が `attachments` テーブルへ読み書きしていない。
   Storage へのアップロードは成功してもメタが DB に残らず、リロードで消える。移行済み添付も
   UI に出ない。→ `fetchTasks/fetchTaskById` で attachments を JOIN 取得し `mapTask` に載せ、
   `upsertTask/updateTaskRow` で attachments テーブルへ差分同期する実装が必要。
2. **移行スクリプトの添付パス（未対応）**
   Firebase の storage_path をそのまま流用しており、Supabase 規約 `users/{uid}/attachments/...`
   へ再構築していない。バケット未作成時は Firebase URL を据え置くため Firebase 退役で 404 になる。
3. **移行ユーザーの初回パスワード設定導線（未対応）**
   リカバリーリンクが `/login` に飛ぶが、`/login` にトークン交換・`updateUser({password})` の
   処理が無い。→ リンク先を `/auth/callback?next=/reset-password` にし、`/reset-password`
   ページを新設する必要がある。個人利用（オーナー1名）なら、Supabase ダッシュボードから直接
   パスワード設定しても可。
4. **profiles 自動生成トリガ（推奨・未対応）**
   profiles 生成がクライアント `ensureProfile` 依存。`auth.users` への `handle_new_user`
   トリガ（SECURITY DEFINER）に寄せると堅牢。`profiles.email` の NOT NULL/UNIQUE も
   OAuth 想定で見直し。
5. **routines のセクション欠落（限定的）**
   `routines.section_id` は NOT NULL のまま。参照先セクションが削除済みのルーチンは移行時に
   skip され得る（稀）。必要なら routines.section_id も nullable 化 or デフォルトセクション付与。
6. **Realtime の `in.()` フィルタ + RLS 認可（要実 Supabase 検証）**
   プロジェクト単位の `in.()` フィルタ購読と、共有プロジェクトの RLS が realtime 認可
   コンテキストで正しく評価されるかは実 Supabase での検証が必要。
7. **その他 Medium/Low**: 監査で 62 件検出。上記以外は Medium/Low で日常利用のブロッカーでは
   ない（詳細は移行監査の記録を参照）。

---

## 付記: 本 Runbook 対応で修正済みの主なブロッカー

- date/section_id nullable 化 → 日付なし/ゴール/バックログの保存が可能に
- Realtime publication + REPLICA IDENTITY FULL → realtime 配信が機能
- attachments バケット + storage RLS の migration 追加
- `/auth/callback` の locale リダイレクト 404 を解消
- AuthProvider の初期化失敗でログイン無限往復になる問題を解消
- notes upsert の onConflict 指定（同一期間ノート更新の失敗を解消）
- realtime pending タスク消失バグの修正
- 移行スクリプトのデータ破壊（today 化け・in_progress 重複・goals CHECK・section skip）防止
- 実行手段（`npm run migrate:supabase`）と env の整備
