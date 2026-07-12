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

Supabase CLI（推奨）で対象プロジェクトを link し、`supabase/migrations/*.sql` を **番号順に** 適用する。

```bash
# 初回のみ。Project ref は Supabase Dashboard の Project Settings > General で確認する。
npx supabase link --project-ref <project-ref>

# 001〜011 をリモート DB へ適用する。
npx supabase db push
```

SQL エディタで個別適用する場合も、必ず `001` から `011` の順に実行する。

- `001`〜`005`: 初期スキーマ・RLS・トリガー・制約
- **`006_nullable_task_placement.sql`**: `tasks.date` / `tasks.section_id` を nullable 化
  （日付なし/ゴール/バックログタスクを保存可能に）
- **`007_realtime_and_storage.sql`**: Realtime publication + REPLICA IDENTITY FULL、
  `attachments` バケット作成 + storage RLS
- **`008_profile_trigger_and_routine_section.sql`**: profile 自動作成 + routines の section nullable 化
- **`009_storage_privacy_and_avatars.sql`**: attachments の private 化 + avatars バケット/RLS
- **`010_api_role_grants.sql`**: authenticated/service_role の API テーブル・RPC 権限
- **`011_task_checklist.sql`**: 持ち物リスト（`tasks.checklist` jsonb 追加、
  `item_templates` テーブル + RLS + Realtime）

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

# 特定アカウントだけを移行する場合（以後の全コマンドで同じ値を指定）
npm run migrate:supabase -- --dry-run --email user@example.com

# 2) 問題なければ本移行
npm run migrate:supabase

# 3) 移行ユーザーへ初回パスワード設定メールを送るなら（SMTP必須）
npm run migrate:supabase -- --send-reset-emails
```

> `--send-reset-emails` を付けたwrite実行では、新規・既存どちらの移行対象にも
> 再設定メールを送る。重複送信を避けるため、通常は最初の本実行で1回だけ指定すること。

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

## 7. 残課題

### 7a. 追加対応済み（2回目の残課題対応で実装）

1. ✅ **添付ファイルのアプリ側結線** — `fetchTasks/fetchTaskById` で attachments を取得し
   `mapTask` に載せ、`upsertTask/updateTaskRow` で attachments テーブルへ差分同期
   （`syncTaskAttachments`）。保存・表示が結線された。
2. ✅ **移行スクリプトの添付パス再構築** — Supabase 規約 `users/{uid}/attachments/{id}_{name}`
   へ再構築。バケット未作成時は Firebase URL 据え置きを **明示 ERROR** で可視化。
3. ✅ **移行ユーザーのパスワード設定導線** — リカバリーリンクを
   `/auth/callback?next=/reset-password` に変更し、`/reset-password` ページを新設。
   ログイン画面に「Forgot / set password?」導線を追加。
4. ✅ **profiles 自動生成トリガ** — migration 008 で `handle_new_user`（SECURITY DEFINER）
   を auth.users に付与。email 無しユーザーは skip（ensureProfile がフォールバック）。
5. ✅ **routines.section_id nullable 化** — migration 008。移行時にセクション未解決の
   ルーチンを skip せず section_id=null で投入。

### 7b. 実 Supabase 環境での検証が必要（コードでは完結しない）

6. **Realtime の `in.()` フィルタ + RLS 認可** — プロジェクト単位の `in.()` フィルタ購読と、
   共有プロジェクトの RLS が realtime 認可コンテキストで正しく評価されるかは実 Supabase での
   検証が必要（§6 チェックリスト参照）。
7. **migration 001〜011 の実 DB 適用** と、dry-run→本移行の実データ検証。
8. **その他 Medium/Low**: 監査で 62 件検出。上記以外は Medium/Low で日常利用のブロッカーでは
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
