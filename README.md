# Taskel

Next.js と Supabase で構築したタスク・ゴール・ルーチン管理アプリです。

## ローカル開発

必要環境:

- Node.js 20 以上
- Docker Desktop
- Supabase CLI（`npx supabase` でも実行可能）

```bash
npm ci
npx supabase start
cp .env.example .env.local
```

`npx supabase status` に表示されるローカル値を `.env.local` の
`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、
`SUPABASE_SERVICE_ROLE_KEY` に設定してから起動します。

```bash
npm run dev
```

アプリは [http://localhost:3000](http://localhost:3000) で開けます。

## 検証

```bash
npm run typecheck
npm test
npm run build
```

ローカル Supabase 起動中は、Auth・RLS・Realtime・Storage の統合スモークテストも実行できます。

```bash
npm run smoke:supabase
```

## Firebase からの移行

スキーマ適用、dry-run、本移行、Vercel 設定の手順は
[Supabase 移行 Runbook](docs/supabase-migration-runbook.md) を参照してください。
