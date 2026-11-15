# Fixes and Features Log - November 2026

## [2026-11-15] MCP server for the owner's assistant, and removal of the session-token screen

- **Issue:** The integrations settings page displays the browser session's refresh token and access token, plus the Firebase API key and project id, for a stdio MCP process (`node /path/to/taskel-mcp-server/dist/index.js`, `TASKEL_REFRESH_TOKEN`) that this app does not run.
- **Change:**
    - `POST /api/mcp` is a stateless Streamable HTTP MCP endpoint in the Next.js app. Six tools: `taskel_whoami`, `taskel_list_tasks_for_day`, `taskel_search_tasks`, `taskel_get_task`, `taskel_create_task`, `taskel_revoke_current_token`. No update, complete, or delete. Memo, checklist, tags, and project ids are not read or returned. Shared-project rows are counted (`hidden_shared_count`), not listed.
    - Data access goes through `security definer` `mcp_*` functions. Only `service_role` may execute the ones the routes call. `src/lib/mcp/db.ts` is the only MCP file that imports the admin client, and it only calls `.rpc(`.
    - Personal access tokens, format `tsk_mcp_<8 chars>_<43 chars>`. Stored as SHA-256 hex plus a 16-character prefix. Plaintext is returned once by `POST /api/mcp/tokens`. Scopes come from `access`: `read` or `read_create`. Expiry is 30, 90, 180, or 365 days (the named default constant is 90; the body must send one). At most 5 active tokens. The token's IANA time zone defines "today".
    - `taskel_create_task` writes without the in-app confirmation card. Caps are 30 per hour and 100 per 24 hours per token. An idempotency key replays (`created: false`).
    - Migration `supabase/migrations/20261114160000_mcp_server.sql` adds `mcp_tokens`, `mcp_audit_logs`, `mcp_rate_windows`, `mcp_task_creations`. RLS on, no policy, no privilege for `anon` or `authenticated`. Audit rows store argument keys, not titles or queries. Rows older than 180 days are deleted when a token is issued. `taskel_whoami` writes no audit row.
    - `TASKEL_MCP_DISABLED=1` returns `503` `MCP_DISABLED`. Before the migration, a shaped token on `POST /api/mcp` returns `503` `MCP_NOT_READY`. `GET /api/mcp/tokens` returns `200` with `ready: false`.
    - New and changed code, by directory: `src/app/api/mcp/` (the endpoint and `/api/mcp/tokens`, `/api/mcp/tokens/[id]`), `src/lib/mcp/` (auth, body, dates, day view, db, errors, sanitize, scopes, section choice, server, token, tools), `src/lib/validations/mcp.ts` and `mcpToken.ts`, `contracts/taskel-mcp.v1.json`, `src/types/supabase.ts` (the new tables). Dependency `@modelcontextprotocol/sdk` (`^1.29.0`). npm scripts `mcp:e2e:seed` and `smoke:mcp`.
    - The integrations page now shows the MCP token section (endpoint URL, token table with revoke, issue form, one-time token, last 20 audit rows) and no longer reads the browser session or the Firebase variables. The requirement 21 source test runs.
    - The `Origin` check now compares with the host the browser reached. This fixes a `403` when the page is on localhost and the server is bound to `127.0.0.1`, and when the app is behind a TLS proxy.
    - An unsupported `mcp-protocol-version` is `400` `MCP_BAD_REQUEST` with fixed text.
    - Titles also refuse the Unicode tag block and invisible fillers.
    - Titles refuse every format character (`\p{Cf}`), the rest of plane 14 outside the ideographic selectors, and variation selectors that do not pick a glyph (leading, in a run, or after the wrong base). This closes hidden-text payloads carried by selector runs.
    - The day snapshot gives in-scope rows the 500 slots first, so rows another project editor inserts with the user's id cannot push the user's own tasks out of the MCP day list or the reminder.
    - Custom routines count their interval in calendar days. The app and the MCP day view drifted by a day across daylight-saving changes, depending on the process time zone. This also fixes the app itself in a daylight-saving zone.
    - `.gitleaks.toml` adds rule `taskel-mcp-pat`.
    - The local-stack scripts `scripts/mcp-e2e-seed.mjs` and `scripts/smoke-mcp.mjs` are in the repo.
- **Spec:** `docs/mcp_server_spec.md`. QA: MCP-01〜08.
- **Impact:** Additive migration. Existing tables, policies, and functions are unchanged. Nothing in the task list changes until a token is issued and a tool writes or the assistant reads. Apply with `npx supabase db push`. No new secret: the route uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The integrations page changes: the old session-token block is removed. Custom routines may move by one day for users in daylight-saving zones whose routine started before a clock change. That day was wrong before.
