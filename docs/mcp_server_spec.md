# Taskel MCP server (v1)

A stateless Streamable HTTP endpoint inside the Next.js app. Contract: `contracts/taskel-mcp.v1.json`. Migration: `supabase/migrations/20261114160000_mcp_server.sql`.

## 1. Purpose and scope

`POST /api/mcp` speaks one JSON-RPC message per request. It is for the owner's own assistant (AGIRU Beacon). The route never reads cookies and sends no CORS headers.

Six tools, in this order:

| Tool | Scope |
|---|---|
| `taskel_whoami` | any valid token |
| `taskel_list_tasks_for_day` | `tasks:read` |
| `taskel_search_tasks` | `tasks:read` |
| `taskel_get_task` | `tasks:read` |
| `taskel_create_task` | `tasks:create` |
| `taskel_revoke_current_token` | any valid token |

There is no update, complete, or delete tool. Memo, checklist, tags, and project ids are never read, searched, written, or returned.

The server name in `initialize` is `taskel-mcp-server` `1.0.0`, contract `1`. It is not the old stdio process. The route does not accept a Firebase refresh token or a Supabase session access token. The settings page (section 7) issues these tokens and no longer shows the browser session.

## 2. Identity model

No JWT impersonation and no new secret. The route hashes the bearer token, `mcp_authenticate` resolves the user id, and every later read or write is an `mcp_*` function. Each function takes that user id and filters by it in SQL. The caller cannot name another user.

`src/lib/mcp/db.ts` is the only file under `src/lib/mcp` and `src/app/api/mcp` that imports `@/lib/supabase/admin`. It only calls `.rpc(`. It does not query tables. Tool handlers do not import Supabase. The MCP route does not import `next/headers` and does not call `cookies()`.

The admin client uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the same variables the rest of the app already uses.

Every `mcp_*` function is `security definer` with `search_path = ''`. Postgres grants `EXECUTE` to `PUBLIC` on a new function; the migration revokes that. The four tables have RLS enabled and no policy. `anon` and `authenticated` have no privilege on the tables and no execute on the functions.

Functions `service_role` may execute:

| Function | What it does |
|---|---|
| `mcp_in_scope(user, project)` | True when the project id is null, or the user owns the project and no other member exists. |
| `mcp_issue_token` | Inserts one token for that user, or returns `TOKEN_LIMIT` / `INVALID_INPUT`. |
| `mcp_list_tokens` | That user's tokens (no hash) and the last 20 audit rows. |
| `mcp_revoke_token` | Sets `revoked_at`. One-way. `via` is `ui` or `self`. |
| `mcp_authenticate` | Looks up the SHA-256. Unknown hashes cause no write. Counts the per-token rate limit. |
| `mcp_day_snapshot` | One date: tasks, goals, active routines, sections. Writes one audit row. |
| `mcp_search_tasks` | Title search. Writes one audit row. |
| `mcp_get_task` | One stored task, or a null task. Writes one audit row. |
| `mcp_create_task` | Inserts one personal task. Writes one audit row. |
| `mcp_log_event` | Writes a `denied` audit row. The only event it accepts is `denied`. |

Internal helpers. Execute is revoked from `public`, `anon`, `authenticated`, and `service_role`. They run only inside the functions above:

| Function | What it does |
|---|---|
| `mcp_require_token` | Returns the token row when it belongs to the user, is not revoked, is not expired, and carries `p_scope` when one is given. Otherwise raises `MCP_TOKEN_NOT_ACTIVE` or `MCP_SCOPE_FORBIDDEN`. |
| `mcp_write_audit` | Inserts one audit row. Free text is dropped: tool names, error codes, request ids, and argument keys must match fixed patterns, and at most 12 keys are kept. |
| `mcp_task_json` | The only task projection that leaves the database: id, title, status, date, `scheduled_start` (`HH:mm`), section id, section name, estimated minutes, actual minutes, routine id, and `completed_at` when status is `done`. No memo, checklist, tags, or project id. Callers select the row under their own filter first. |

A missing function (`PGRST202` or `42883`) is `not_ready`, not an internal error. That is the state after the code is deployed and before the migration is applied.

## 3. Tokens

Format `tsk_mcp_<8 chars>_<43 chars>`, 60 characters. `src/lib/mcp/token.ts` builds it from 6 random bytes and 32 random bytes, base64url. The shape check is `^tsk_mcp_[A-Za-z0-9_-]{52}$`. A token that fails the shape is rejected before any database call.

The database stores the SHA-256 hex of the whole token (`token_hash`, 64 lowercase hex digits, unique) and a 16-character display prefix (`token_prefix`). The prefix is the first 16 characters, `tsk_mcp_` plus the 8-character id portion, for example `tsk_mcp_AbCdEfGh`. It is not a secret. The plaintext is returned once, in the `201` body of `POST /api/mcp/tokens`, and is not logged.

Scopes stored on a token are one or both of `tasks:read` and `tasks:create`, with no duplicates. The issue API does not accept a scope list. It accepts `access`:

| `access` | Scopes stored |
|---|---|
| `read` | `tasks:read` |
| `read_create` | `tasks:read`, `tasks:create` |

What a scope allows:

| Who | Tools |
|---|---|
| Any valid token | `taskel_whoami`, `taskel_revoke_current_token` |
| `tasks:read` | `taskel_list_tasks_for_day`, `taskel_search_tasks`, `taskel_get_task` |
| `tasks:create` | `taskel_create_task` |

`tools/list` returns only the tools the token may call, in the order above. `tools/call` checks the scope again, and the SQL function checks it a third time.

Expiry is one of 30, 90, 180, or 365 days. `MCP_TOKEN_DEFAULT_EXPIRY_DAYS` is 90. The POST body must send `expiresInDays`; omitting it is `400`. There is no non-expiring option. `created_at` and `expires_at` are set in SQL (`now()` plus that many days). The caller cannot send either timestamp. The column check requires `expires_at` to be after `created_at` and at most 366 days later.

At most 5 active tokens per user. Active means `revoked_at` is null and `expires_at` is still in the future. Issuing takes an advisory lock per user so two requests cannot pass the count together. A sixth active token returns `TOKEN_LIMIT`.

The issue body also carries an IANA time zone (`timezone`, 1–64 characters, checked with `Intl` and again with `pg_timezone_names`). It is stored on the token. "Today" for every tool is the calendar date in that zone. The API does not read the browser zone itself; the caller sends the string.

## 4. Data scope

"My tasks" is `mcp_in_scope`: `user_id` is the token's user, and either `project_id` is null or the project is owned by that user and has no other row in `project_members`. A row in a project that has any other member is out of scope even when `user_id` is this user. The check is the membership at read time.

The day list does not return those rows. It counts them in `hidden_shared_count` and does not include their titles. Shared-project goals are omitted entirely and are not part of that count.

`taskel_list_tasks_for_day` loads one date through `mcp_day_snapshot`, then `buildDayView` in `src/lib/mcp/dayView.ts`:

1. Stored tasks for that date (up to 500; a 501st sets `tasks_truncated` and is dropped). In-scope rows take the 500 slots first and out-of-scope rows only fill what is left, so rows another project editor inserts with this user's id cannot push the user's own rows out. Out-of-scope titles are null in the snapshot.
2. Virtual routine occurrences. An active routine that `routineOccursOn` places on that date is added when no stored row has the same deterministic virtual id (`createVirtualRoutineTaskId`) or the same `routine_id`. A skipped row is the tombstone of a deleted occurrence and suppresses the virtual one. The virtual row is `open`, `is_virtual: true`, actual minutes 0. Nothing is written. A `custom` routine's interval is counted in calendar days (`differenceInCalendarDays`), so the result is the same in every process time zone, including across daylight-saving changes; `src/lib/routineUtils.timezone.test.ts` checks this under four zones.
3. Skipped rows are dropped and are not listed.
4. Rows that are out of scope, or whose title is null, are not listed. `hidden_shared_count` is how many non-skipped rows were removed here.
5. Sort: section start time (a section with no start time sorts as 00:00; a task with no section sorts last), then `scheduled_start` (none sorts last), then `order`, then id.
6. The `tasks` array is capped at 100 (`MCP_DAY_VIEW_LIMIT`). `truncated` is true when the visible list is longer than 100 or the snapshot was truncated at 500. `summary` counts every visible row, so `summary.total` can be larger than `tasks.length`.

`daily_goals` are undated tasks (`date` is null) with `assigned_date` equal to that day, status not `skipped`, in scope, up to 50. Each item is id, title, status.

A listed task item is: id, title, status (`open`, `in_progress`, `done`), date, `scheduled_start`, section name, `estimated_minutes`, `actual_minutes`, `is_routine`, `is_virtual`. No section id, routine id, project id, memo, checklist, or tags.

The response also has `date`, `weekday` (`Sun`–`Sat`), `timezone`, and `today`.

## 5. HTTP layer

`POST /api/mcp` checks, in this order:

1. `TASKEL_MCP_DISABLED === '1'` → `503` `MCP_DISABLED`. The value `true` does not disable the route. GET and DELETE hit this check too.
2. Per-IP limit: 120 requests per 60 seconds, in-memory, key `mcp`. Over the limit → `429` `MCP_RATE_LIMITED` with `Retry-After`. A request with no client IP is not limited. See section 8.
3. `Authorization`. Missing, or not `Bearer` plus one token → `401` `MCP_UNAUTHORIZED`. Wrong shape → `401` `MCP_TOKEN_INVALID`. No database call yet.
4. Body. `Content-Type` must be `application/json` (a charset parameter is fine), or `415` with code `MCP_BAD_REQUEST`. Declared or streamed size over 65,536 bytes → `413` `MCP_BODY_TOO_LARGE`. The stream is cancelled once it passes the cap. Invalid JSON, or JSON that is not an object → `400` `MCP_BAD_REQUEST`. A JSON array → `400` `MCP_BATCH_UNSUPPORTED`. A batch is refused so the transport cannot run each element.
5. The body must parse as one JSON-RPC message, or `400` `MCP_BAD_REQUEST`.
6. `mcp-protocol-version`, when the header is present and not in the SDK's supported list (`SUPPORTED_PROTOCOL_VERSIONS`), is `400` `MCP_BAD_REQUEST`. The message is "Bad request." This check runs after the JSON-RPC shape and before the token lookup.
7. `mcp_authenticate` on the SHA-256. `not_ready` → `503` `MCP_NOT_READY`. Unknown hash → `401` `MCP_TOKEN_INVALID` (the log line is the 16-character prefix). Revoked → `401` `MCP_TOKEN_REVOKED`. Expired → `401` `MCP_TOKEN_EXPIRED`. Over 60 requests in the clock minute → `429` `MCP_RATE_LIMITED` and the SQL `retry_after_s`.
8. One server for this request, stateless (`sessionIdGenerator` unset, JSON responses on). The request handed to the SDK transport keeps only `accept`, `content-type`, and `mcp-protocol-version`. The `Authorization` header is not forwarded. Any throw → `500` `MCP_INTERNAL`. The message is fixed. The cause stays in the server log.

GET and DELETE, when the switch is off, return `405` with `Allow: POST`.

Taskel's own error body is:

```json
{"jsonrpc":"2.0","error":{"code":-32001,"message":"...","data":{"code":"..."}},"id":null}
```

`Content-Type` is `application/json`. `Cache-Control` is `no-store`. `401` adds `WWW-Authenticate: Bearer realm="taskel-mcp"`. `429` adds `Retry-After` (at least 1, at most 3600; 60 when the count is missing). `405` has no `data` field.

| HTTP | `error.data.code` | Meaning |
|---|---|---|
| 400 | `MCP_BAD_REQUEST` | Not JSON, not an object, or not a JSON-RPC message. Message: "Bad request." |
| 400 | `MCP_BAD_REQUEST` | `mcp-protocol-version` is present and not in the SDK's supported list (`SUPPORTED_PROTOCOL_VERSIONS`); checked after the JSON-RPC shape and before the token lookup. Message: "Bad request." |
| 400 | `MCP_BATCH_UNSUPPORTED` | The body is a JSON array. Message: "Batch requests are not supported." |
| 401 | `MCP_UNAUTHORIZED` | No bearer token. Message: "Authentication required." |
| 401 | `MCP_TOKEN_INVALID` | Shape is wrong, or the hash is unknown. Message: "Invalid token." |
| 401 | `MCP_TOKEN_REVOKED` | `revoked_at` is set. Message: "Token revoked." |
| 401 | `MCP_TOKEN_EXPIRED` | `expires_at` has passed. Message: "Token expired." |
| 405 | (none) | GET or DELETE. Message: "Method not allowed." |
| 413 | `MCP_BODY_TOO_LARGE` | Body over 65,536 bytes. Message: "Request body too large." |
| 415 | `MCP_BAD_REQUEST` | `Content-Type` is not `application/json`. Message is still "Bad request." |
| 429 | `MCP_RATE_LIMITED` | 120 per minute per IP on this process, or 60 per clock minute per token. Message: "Too many requests." |
| 500 | `MCP_INTERNAL` | Unexpected failure. Message: "Internal error." |
| 503 | `MCP_NOT_READY` | `mcp_authenticate` is missing. Message: "MCP server is not ready." |
| 503 | `MCP_DISABLED` | `TASKEL_MCP_DISABLED=1`. Message: "MCP server is disabled." |

Errors produced by the SDK transport itself keep the SDK shape. They use JSON-RPC code `-32000`, have no `data.code`, and the message is the SDK's text:

- `406` when `Accept` does not include both `application/json` and `text/event-stream`.

A notification (no `id`) is `202` with an empty body. A `tools/call` failure is HTTP `200`; the error is in the tool result, not in this table.

`x-taskel-request-id` is stored on audit rows when it matches `^[A-Za-z0-9-]{1,64}$`. Otherwise the route generates a UUID. The header is not forwarded to tool code as an HTTP header; it is passed into the database binding.

## 6. Tools

`tools/call` runs `callTaskelMcpTool`. An unknown name is `TOOL_UNKNOWN`. A known name the token's scopes do not allow is `SCOPE_FORBIDDEN`. Both write a `denied` audit row when the token is still active. The handler then validates arguments. Unknown keys are refused. No schema has a user, project, section, status-to-write, or row-id-to-write field.

Success:

```json
{"ok":true,"data":{}}
```

Failure (`isError: true`):

```json
{"ok":false,"error":{"code":"...","message":"...","retryable":false}}
```

The same object is `structuredContent`. `content` is one text item: the JSON on success, or `[CODE] message` on failure. `retryable` is true only for `RATE_LIMITED` and `INTERNAL_ERROR`.

| Code | Message | When |
|---|---|---|
| `INVALID_INPUT` | Invalid arguments. | Shape, dates, title, or search span refused. |
| `SCOPE_FORBIDDEN` | This token does not have the required scope. | Scope check in the handler or in SQL. |
| `TOOL_UNKNOWN` | Unknown tool. | Name is not one of the six. |
| `NOT_FOUND` | Task not found. | `taskel_get_task` only. |
| `CONFLICT` | This idempotency key was already used for a different request. | Create replay that does not match. |
| `RATE_LIMITED` | Task creation limit reached. | Create caps. Not the HTTP 429. |
| `INTERNAL_ERROR` | Internal error. | Unexpected failure, or a revoke that is neither ok nor `ALREADY_REVOKED`. |

### taskel_whoami

Scope: any valid token. Input: `{}`. No database call and no audit row.

Returns `token` (name, prefix, scopes, `expires_at` as ISO when it parses, `days_until_expiry`), `timezone`, `today`, and `server` (`name`, `version`, `contract`). No task data.

### taskel_list_tasks_for_day

Scope: `tasks:read`. Input: `day` (`today`, `tomorrow`, `yesterday`) or `date` (`YYYY-MM-DD`), never both. Neither means today in the token zone. A date that is not a real civil date (`2026-02-30`) is `INVALID_INPUT`.

Returns the day view in section 4: `date`, `weekday`, `timezone`, `today`, `summary`, `tasks`, `daily_goals`, `hidden_shared_count`, `truncated`.

### taskel_search_tasks

Scope: `tasks:read`. Input from the contract:

| Field | Rule |
|---|---|
| `query` | Optional. 1–100 characters. Split on whitespace (including the ideographic space) into 1–5 terms, each at most 50 code points. Every term must appear in the title. Case-insensitive. |
| `range` | Optional. `today`, `yesterday`, `this_week`, `last_week`, `last_7_days`, `last_30_days`, `last_90_days`, `this_month`, `last_month`. Weeks are Monday–Sunday in the token zone. `last_7_days` is today and the six days before it. `this_week` and `this_month` are the whole period. |
| `date_from`, `date_to` | Optional civil dates. Cannot be combined with `range`. When both are set, `date_to` must not be before `date_from`, and the span is at most 366 days. One side may be open. |
| `status` | Optional unique subset of `open`, `in_progress`, `done`. Default is all three. `skipped` is never searched. |
| `include_undated` | Optional. Default is true when no date bound is set, and false when one is. |
| `limit` | Optional integer 1–50. Default 20. |

At least one of `query`, `range`, `date_from`, and `date_to` is required. Terms are bound with `position()`, not `LIKE`.

Returns `query` (the terms joined, or null), `date_from`, `date_to`, `timezone`, `today`, `count`, `truncated`, `tasks`, `routine_matches`, and `note`. Each task is the task item plus `completed_on` (the calendar day of `completed_at` in the token zone, or null). Sort is date descending, nulls last, then `order`, then id. `routine_matches` (title, frequency, `active`, at most 10) are filled only when there are terms. Inactive routines can match. The note is: "Untouched past routine occurrences are not stored and cannot be found."

### taskel_get_task

Scope: `tasks:read`. Input: `id` (UUID shape; the handler lowercases it).

Returns `{task: ...}` with the same fields as a search hit, including `completed_on`. Another user's row, a shared-project row, a skipped row, and a virtual routine id are all `NOT_FOUND`.

### taskel_create_task

Scope: `tasks:create`. Input: `title` (required), and optional `day` (`today` or `tomorrow`), `date`, `scheduled_start` (`HH:mm`, 00:00–23:59), `estimated_minutes` (integer 0–1440), `idempotency_key` (`^[A-Za-z0-9_-]{16,64}$`). `day` and `date` cannot both be set. Neither means today. `yesterday` is refused.

Title (`cleanTaskTitle`): the raw string must be at most 200 code points; after trim it must be at least 1 character and at most 200. Characters that hide or reorder text are refused, not stripped: every control character (`\p{Cc}`: C0 including tab and newline, DEL, C1), every format character (`\p{Cf}`: soft hyphen, zero-width characters, the byte order mark, bidirectional marks, embeddings, overrides, isolates, U+2060-206F, interlinear annotation controls U+FFF9-FFFB, shorthand, Egyptian and number-sign format controls, the assigned tag characters), line and paragraph separators, and lone surrogates. Also refused, outside `\p{Cf}`: the combining grapheme joiner (U+034F), Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), Khmer inherent vowels (U+17B4, U+17B5), Mongolian variation selectors and vowel separator (U+180B-180F), the unassigned U+2065 and U+FFF0-FFF8, musical invisible format characters (U+1D173-1D17A), and the whole of plane 14 outside the ideographic variation selectors (U+E0000-E00FF, U+E01F0-E0FFF), which hides ASCII text from people ("ASCII smuggling"). Variation selectors (U+FE00-FE0F, U+E0100-E01EF) are allowed only where they pick a glyph, because a run of them can carry hidden bytes ("emoji smuggling"). The rule mirrors Beacon's `collapseVariationSelectors` but refuses instead of dropping: a selector must follow a character that is not a selector (never first, never two in a row); U+FE0E / U+FE0F need an emoji base, and an ASCII base (0-9 # *) also needs the keycap U+20E3 right after; U+FE00-FE0D and U+E0100-E01EF need a Han base, at most two per value. Ordinary emoji (`❤️`, `1️⃣`) and Japanese name variants (`葛\u{E0100}`) pass. The same check applies to token names.

The date must fall on today−31 through today+731 in the token zone, inclusive. Omitted `estimated_minutes` is stored as 15. `0` is stored as 0.

The section is chosen in `chooseSectionId`, from the user's sections only:

1. A start time is given: the section that covers it.
2. No start time, and the task is for today: the section that covers now.
3. That time falls in a gap: the next section to start after it, or, when none starts later, the section that starts last.
4. No start time, and another day: the first section by `order`, then id.
5. The user has no sections: none (`section_id` null).

The id is always `gen_random_uuid()` in SQL. A caller-chosen id is not accepted; it could collide with a virtual routine id and hide that occurrence. `project_id` is null. Status is `open`. Actual minutes are 0. Checklist is `[]`. `work_actor` is `human`. `order` is one past the max for that user, date, and section.

The idempotency key is optional. The request hash is the SHA-256 of `title|date|scheduled_start` (empty string when there is no start time). The estimate is not part of the hash. The same key and the same hash, while the task is still in scope and not skipped, returns `created: false` and the existing task. A different hash, or a task that is gone, skipped, or out of scope, is `CONFLICT` and does not insert another row. A call with no key stores `srv:` plus a UUID, which cannot collide with a client key.

Caps, per token, counted on `mcp_task_creations` after the replay check: 30 rows in the last hour, or 100 in the last 24 hours, is `RATE_LIMITED`. An advisory lock per token serialises the check, the insert, the idempotency row, and the audit row. A replay does not consume a new slot.

Reading sections for the create is its own `mcp_day_snapshot` call (`p_tool = taskel_create_task`). It needs `tasks:create`, returns no tasks, goals, or routines, and writes its own audit row before the create row.

The success data is `{created, task}`. `task` is the task item without `completed_on`.

### taskel_revoke_current_token

Scope: any valid token. Input: `{}`. Revokes the token bound to this request (`revoked_via = self`). Returns `{revoked: true}`. `ALREADY_REVOKED` is still success. The next request with that bearer is `401` `MCP_TOKEN_REVOKED`.

## 7. Token API and settings screen

Cookie session (`requireAuth`, `supabase.auth.getUser()`). The session has no privilege on the token tables. The routes call `createTokenAdminDb(user.id)`.

POST and DELETE call `rejectCrossOrigin` first. The `Origin` header, parsed, must equal the origin the browser reached: protocol from `X-Forwarded-Proto` (else the request URL's), host from `X-Forwarded-Host`, else `Host`, else the request URL's host. The first value of a comma-separated header is used. Next builds `request.url` from the address the server is bound to, not the host the browser used. A missing `Origin` is allowed. A mismatch is `403` `{error, code: "FORBIDDEN"}` and the session is not read. GET does not check `Origin`.

Token JSON errors are `{error, code}` with `Cache-Control: no-store`. Nothing the caller sent is echoed.

### GET /api/mcp/tokens

No body. `200` `{ready: true, tokens, recent}` or, when `mcp_list_tokens` is missing, `200` `{ready: false, tokens: [], recent: []}`. `tokens` is up to 50 rows, newest first, with no hash and no plaintext. `recent` is the last 20 audit rows: `created_at`, `event`, `tool`, `ok`, `error_code`, `token_id`, `token_prefix`. `401` `UNAUTHORIZED` with no session. `500` `INTERNAL_ERROR` on a database failure.

### POST /api/mcp/tokens

Body, strict object: `name` (trim, 1–60, no forbidden text characters), `access` (`read` or `read_create`), `expiresInDays` (30, 90, 180, or 365), `timezone` (IANA). Extra keys, a scope list, a caller-chosen secret, and a caller-chosen timestamp are `400`.

Same-origin issue is limited to 10 per minute per IP (`mcp-token-issue`). The `429` from that limiter is `{error: "Too many requests"}` and has no `code`. It also sets `Retry-After` and the `X-RateLimit-*` headers.

`201` `{token, record}`. `token` is the plaintext, shown in this response only. `record` is the row (id, name, prefix, scopes, timezone, timestamps, `revoked_at`, `revoked_via`). `409` `TOKEN_LIMIT`, message "Token limit reached. Revoke a token first.", and no `token` field. `400` `INVALID_INPUT` when the body or the SQL check fails. Invalid JSON is `400` `BAD_REQUEST`, message "Invalid JSON body". Missing migration on insert is `503` `MCP_NOT_READY`. `401` without a session. `500` `INTERNAL_ERROR` otherwise.

### DELETE /api/mcp/tokens/[id]

`id` must be a UUID shape or the response is `404` `NOT_FOUND` with no database call. The id is lowercased. Success is `200` `{ok: true}` and `revoked_via` is `ui`. Another user's id, or an unknown id, is `404` `NOT_FOUND`. Already revoked is `409` `ALREADY_REVOKED`. Missing migration is `503` `MCP_NOT_READY`. `401` without a session. `403` for a foreign `Origin`. There is no route that clears `revoked_at` or edits a token.

### Settings > 連携

`src/app/[locale]/settings/integrations/page.tsx` renders `McpTokensSection` under the heading 外部連携. The endpoint URL is `${window.location.origin}/api/mcp`, with a copy button. When the token list has loaded and `ready` is false, the screen shows 「サーバーの準備がまだです」 and 「データベースのマイグレーションがまだ適用されていません。」, and issuing is disabled. The token table columns are 名前, 接頭辞, 権限, タイムゾーン, 作成日, 最終使用, 有効期限, 状態, and 操作. An active row's 操作 is 取り消す, after a confirm. The issue form defaults the name to "Beacon", access to 読み取り＋追加, and expiry to 90 日. The time zone it sends is the browser's. A newly issued token is shown once, with a copy button, and the line 「この Mac で npm run beacon:taskel-link を実行して貼り付ける」. The last 20 audit rows are listed under 最近の利用. The page does not read the browser session or `NEXT_PUBLIC_FIREBASE_*`. The requirement 21 source test in `src/lib/mcp/__tests__/source.test.ts` runs: the page must not contain `refresh_token`, `access_token`, or `NEXT_PUBLIC_FIREBASE`.

The nav label 「連携」 is the integrations item in `SettingsLayout`.

## 8. Audit and rate limits

Tables: `mcp_tokens`, `mcp_audit_logs`, `mcp_rate_windows`, `mcp_task_creations`. RLS is enabled and there is no policy. `REVOKE ALL` from `public`, `anon`, and `authenticated`. `GRANT ALL` to `service_role`, including the audit id sequence. The migration does not change existing tables.

`mcp_audit_logs` is append-only from the application's point of view. Columns include `event` (`tool_call`, `token_issued`, `token_revoked`, `rate_limited`, `denied`), `tool`, `ok`, `error_code`, `target_task_id`, `arg_keys`, `request_id`, and the token prefix. Argument keys are names only (`title`, `date`, `query`, …). Titles, search text, and token plaintext are not stored. `mcp_get_task` records the key `id` and the task id, including on `NOT_FOUND`.

`taskel_whoami` writes no audit row.

Issuing a token writes `token_issued`, then deletes that user's audit rows older than 180 days. There is no separate schedule for that delete. Revoking writes `token_revoked`. The 61st request in a token's clock minute writes one `rate_limited` row; further requests in that minute do not.

Per token, `mcp_authenticate` counts in `mcp_rate_windows` for the current clock minute. The cap is 60. The counter is in the database, so every server instance shares it. Windows older than 10 minutes for that token are deleted when a new window's first request lands. `last_used_at` moves at most once per 60 seconds.

Per IP, `applyRateLimit` keeps a `Map` on `globalThis`. The MCP route uses 120 requests per 60 seconds from the first hit in the window. The issue route uses 10. The IP is the first address in `x-vercel-forwarded-for`, else `x-forwarded-for`, else `cf-connecting-ip`, else `x-real-ip`. No header means the limiter does not apply. The map is per Node process.

Create caps (30 per hour, 100 per 24 hours) are rows in `mcp_task_creations` for that token, not for the user.

## 9. Stated exception to the User Agency Pattern

`CLAUDE.md` ("Data Flow (User Agency Pattern)") says the in-app assistant returns a candidate, the client shows a confirmation card, and the user presses 「作成」 before anything is written.

`taskel_create_task` does not do that. It inserts the row in the same call. The owner's agency is issuing a token that carries `tasks:create`, and asking the assistant in chat. The controls around that write are: the only verb is create, the field list is fixed (title, day or date, optional start, optional estimate, optional idempotency key), the caps in section 6, the audit row, and revocation, which the next request already sees.

The in-app AI chat is unchanged. It still does not write through this endpoint.

## 10. Operations

Set `TASKEL_MCP_DISABLED=1` to make `POST`, `GET`, and `DELETE` `/api/mcp` return `503` `MCP_DISABLED` before the rate limit, the token check, or the database. Unset it, or set any other value, and the route runs.

Before `supabase/migrations/20261114160000_mcp_server.sql` is applied, a shaped token on `POST /api/mcp` gets `503` `MCP_NOT_READY`, and `POST` or `DELETE` `/api/mcp/tokens` gets `503` `MCP_NOT_READY`. `GET /api/mcp/tokens` gets `200` with `ready: false`. The settings page shows 「サーバーの準備がまだです」 and disables issuing. The rest of the app does not call these functions, so the code can be merged before `npx supabase db push`. How migrations are applied is `docs/supabase-migration-runbook.md`.

Revocation is immediate. `mcp_authenticate` reads `revoked_at` on every request. The route does not cache the auth result.

Environment variables, by name only:

| Name | Role |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Already used by the app. The admin client requires it. |
| `SUPABASE_SERVICE_ROLE_KEY` | Already used by the app. The admin client requires it. |
| `TASKEL_MCP_DISABLED` | Optional. The exact value `1` disables the MCP HTTP methods. |

No new secret.

## 11. Local test

```bash
npx supabase start
npm run mcp:e2e:seed -- --token-file <path>
npx next dev -p 3210
npm run smoke:mcp
```

`package.json` maps `mcp:e2e:seed` to `node scripts/mcp-e2e-seed.mjs` and `smoke:mcp` to `node scripts/smoke-mcp.mjs`. Both scripts refuse a Supabase URL whose host is not `127.0.0.1` or `localhost`.

Smoke check R2 passes only on permission denied (`42501`). It first calls each function (`mcp_issue_token`, `mcp_day_snapshot`, `mcp_authenticate`) as `service_role` to confirm it exists, so a missing migration fails as "migration not applied" instead of counting as denied.

Unit tests: `npm test` (`vitest run`).

### Secret scanning

`.gitleaks.toml` adds rule `taskel-mcp-pat` (regex `tsk_mcp_[A-Za-z0-9_-]{20,}`) on top of the default rules. Run it with `gitleaks git --config .gitleaks.toml --redact`. It is not run by CI or a hook yet. That needs the owner's approval. `npm test` runs the source test that scans every file git lists (tracked plus untracked, not ignored) for a full token, and checks that every `scripts/*` file an npm script runs is tracked.

## 12. Known limits and non-goals

- No update, complete, or delete. A token issued today cannot gain those verbs later; a new verb needs a new scope and a new token.
- The create caps are per token. Two active tokens can each create 100 tasks in 24 hours.
- Scope is the project's membership at read time. A task row in a project the user owns is out of scope while any other member exists. After that member leaves, `mcp_in_scope` is true and the row is returned, including a row that was inserted while the project still had that member.
- `buildDayView` duplicates the client's `getMergedTasks` (`src/store/slices/taskSlice.ts`). `src/lib/mcp/dayView.test.ts` runs both on the same fixtures. Two differences are deliberate: shared-project rows are counted instead of listed, and the sort is fixed in `buildDayView` because the app sorts in its components.
- The per-IP limiter is per server instance, and it does not run when the request has no IP header. The per-token limiter is shared.
- Search matches titles only. Untouched past routine occurrences are not rows, so they cannot be found. The day list can still show a future or today's virtual occurrence.
- `summary` on the day list counts every visible row. The `tasks` array stops at 100.
- A create that only changes `estimated_minutes` and reuses the idempotency key is a replay (`created: false`), because the estimate is not in the request hash.
