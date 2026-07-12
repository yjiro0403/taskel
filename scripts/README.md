# 管理スクリプト

## Firestore から Supabase への移行

移行元 Firebase の Service Account JSON は Firebase Console の
**プロジェクトの設定 > サービス アカウント** から発行します。秘密鍵は Git にコミットせず、
次のいずれかで `.env.local` に設定します。

```dotenv
# JSON 全体を1行で設定
FIREBASE_SERVICE_ACCOUNT_KEY=

# または JSON ファイルの絶対パス
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json

# または既存の分割形式（3項目すべて必須）
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

移行先には `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY`、
添付コピーには `FIREBASE_STORAGE_BUCKET` も必要です。

最初に必ず dry-run を実行します。

```bash
npm run migrate:supabase -- --dry-run
```

件数、警告、失敗行を確認してから本移行を実行します。

```bash
npm run migrate:supabase
```

初回パスワード設定メールも送る場合は SMTP 設定後に実行します。

```bash
npm run migrate:supabase -- --send-reset-emails
```

詳細は [Supabase 移行 Runbook](../docs/supabase-migration-runbook.md) を参照してください。
