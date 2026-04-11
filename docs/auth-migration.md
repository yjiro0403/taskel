# Auth migration notes

- Existing email/password users are created in Supabase Auth with a random temporary password during migration.
- Run `scripts/migrate-to-supabase.ts --send-reset-emails` to generate Supabase recovery links and send first-login password reset emails after each user is created.
- If SMTP credentials are not configured, the script logs each reset link instead of sending mail.
- Existing OAuth users are linked automatically when they sign in to Supabase with the same email address as their previous account.
