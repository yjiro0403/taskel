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

特定のアカウントだけを移行する場合は、全工程で同じ `--email` を指定します。
このモードでは対象メールに紐づくユーザーデータと、そのユーザーが所有するプロジェクトだけを扱い、
他ユーザーや旧招待は移行しません。

```bash
npm run migrate:supabase -- --dry-run --email user@example.com
```

件数、警告、失敗行を確認してから本移行を実行します。

```bash
npm run migrate:supabase
```

単一アカウント移行:

```bash
npm run migrate:supabase -- --email user@example.com
```

初回パスワード設定メールも送る場合は SMTP 設定後に実行します。

```bash
npm run migrate:supabase -- --send-reset-emails
```

`--send-reset-emails` を付けたwrite実行では、新規・既存どちらの移行対象にも
再設定メールを送ります。重複送信を避けるため、通常は最初の本実行で1回だけ指定します。

```bash
npm run migrate:supabase -- --email user@example.com --send-reset-emails
```

詳細は [Supabase 移行 Runbook](../docs/supabase-migration-runbook.md) を参照してください。
