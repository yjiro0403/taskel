# Fixes and Features Log - September 2026

## [2026-09-15] Optional task-linked money tracking (JPY)

- **Issue:** Users needed a way to record yen expenses and income against dated tasks, without changing existing Taskel behavior when the feature is unused.
- **Change:**
    - Added private per-user tables `finance_preferences`, `finance_categories`, and `finance_entries` in `supabase/migrations/20260915120000_finance_tracking.sql`. Money is **not** stored on the shared `tasks` row.
    - Privacy: each collaborator has independent finance data. Linking a row to a shared project task does not expose amounts to others. Task deletion keeps history (`task_id` SET NULL + title/category snapshots). Task duplication does not copy finance rows.
    - Atomic `replace_task_finance_entries(task_id, jsonb)` RPC replaces the caller’s rows for one task after validating the full payload. `summarize_finance_range` aggregates `[start, end)` in the database over a covering `(user_id, occurred_on)` index. Breakdown details load only when the summary modal opens.
    - Settings toggle (default **OFF**). OFF hides finance UI, skips category/entry/summary loads, and never deletes stored data. The toggle is a feature preference, not a paid entitlement.
    - Task create/edit modal can add multiple expense/income rows (category combobox, positive integer JPY, optional memo) for dated tasks and daily goals. Weekly/monthly/yearly goals have no exact date, so finance entry is hidden.
    - Daily header and `/planning` header show expense/income totals for the selected day / ISO week / month / year. Clicking opens a breakdown grouped by type and category.
    - `addTask` / `updateTask` return `{ ok, persistedId }` so finance is written to the actual persisted row (including routine date-move detach to a new UUID). The modal does not close or report success if task or finance persistence fails.
    - Existing-task finance distinguishes loading / error / not-loaded from a successfully loaded empty list; replace is blocked until load succeeds.
    - Create-then-finance-fail retry updates the same id in place (no duplicate optimistic row, no rollback deletion).
- **Apply note:** Run `npx supabase db push` (or apply SQL in timestamp order) so `20260915120000_finance_tracking.sql` is applied after `20260714010036`. Do not apply this migration from the app runtime. Local Docker/Supabase was not required for the client change; apply on the target project before enabling the toggle in production.
- **Impact:** Existing Taskel behavior is unchanged while the setting is off. When on, users can record private yen cashflow against dated work.
