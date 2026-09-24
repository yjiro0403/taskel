# Fixes and Features Log - September 2026

## [2026-09-24] Weekly timeline: title-first blocks and cross-day drag & drop

- **Issue:** In the weekly planning timeline each block printed `HH:mm–HH:mm` on its first line, so short tasks (≤ 30 min) never showed their title even though the hour axis on the left already gives the time. Blocks and no-start-time chips could only be dragged inside their own day; moving Wednesday's task to Thursday required opening the editor.
- **Change:**
    - `DayTimeline` renders the title first and lets it wrap to as many lines as the block height allows (`-webkit-line-clamp`, full title as tooltip). New props `compact` / `showTimeRange`: the week view hides the range and uses the smaller text; the daily view keeps the range as a small label to the right of the title.
    - Week view drag & drop across days: a block dragged onto another day's grid lands at the hovered time (5-minute snap, grab offset preserved); a chip from "No start time" dropped on another day's grid gets that day and time; a chip dropped on another day's "No start time" area only changes the date; a block dropped on a "No start time" area (own day or another) moves there and clears its start time. The source stays faded in place, the target column shows a dashed preview / highlighted area with a hint.
    - Implementation keeps the existing pointer drag: `WeekTimelineDragProvider` (shared drag state per week), `resolveWeekDropHit` (`elementFromPoint` + `data-timeline-*` attributes), and pure helpers `snapDropStart` / `buildTimelineDropUpdate` in `src/lib/timeline/weekDrag.ts` with unit tests. Without the provider (daily list) the new branches are never taken.
    - i18n: `Timeline.dropToMove`, `Timeline.dropToUnschedule`.
- **Spec:** `docs/weekly_timeline_dnd_spec.md`.
- **Impact:** No schema or store changes; date moves go through the existing `updateTask` path (routine detach / virtual materialization included). Daily timeline behavior is unchanged apart from the title-first order.

## [2026-09-19] Analytics expansion, timeline view, dual-axis landing

- **Issue:** Users could see time per project only after opening each project. There was no all-project actual-vs-expected list, no tag/meeting drill-down, no week/month/year budgets in analytics, and no calendar-style day view. The public homepage still described Taskel as time-only.
- **Change:**
    - `projects.expected_minutes` plus analytics period plans (expected hours, overall yen budget, reflection) and per-category yen budgets. UI preferences persist timeline on/off and whether empty gap hours are hidden (default: timeline off, empty gaps hidden).
    - Analytics lists every project's logged vs expected time, tag totals with click-to-breakdown, and (when money tracking is on) spend vs budget by category and project for week/month/year.
    - Optional Google Calendar-style day timeline: drag to move, resize duration, overlapping tasks sit side by side, unscheduled tasks stay visible at the top.
    - Landing copy frames Taskel as time + money together (time blindness / money blindness). Dummy product frames only — no personal tasks. Bank/card lag is not mentioned on the page.
- **Apply note:** `npx supabase db push` for `20260919120000_analytics_timeline.sql` after the finance migration.
- **Impact:** Existing list and finance behavior stay the default. Timeline and budgets appear only after the user turns them on or fills a plan.

## [2026-09-18] Now / Next widget on the daily task page

- **Issue:** Time blindness. A user misread a 10:01 bus as 10:09 and waited an hour; the list shows times, but nothing answers "what am I doing now, how long is left, what is next and when" at a glance.
- **Change:**
    - Added a sticky two-lane panel above the daily list (`src/components/NowNextWidget.tsx`): **Now** shows the running task with remaining / overrun / elapsed time; **Next** shows the next fixed-time task today with its start time and a live countdown (seconds under ten minutes, amber ≤ 15 min, red + pulse ≤ 5 min, "Now!" once the start time arrives). Tapping a title jumps to the task. The panel collapses to one line (`localStorage`).
    - Pure decision logic in `src/lib/tasks/nowNext.ts` (`computeNowNext`, `hasScheduleConflict`, `describeDuration`) with unit tests; the widget always reflects the system's local today, even while browsing another date, and includes timers still running on other dates.
    - Extracted the daily list's ordering into `src/lib/tasks/taskOrder.ts` (used by `TaskList`, `TasksDnDWrapper`, and the widget's queue fallback) so "next in list" cannot drift from what the list renders.
    - i18n: new `NowNext` namespace in `src/messages/{ja,en}.json`.
- **Spec:** `docs/now_next_widget_spec.md`.
- **Impact:** No schema or write-path changes. Existing list behavior is unchanged; the widget is read-only and adds one small sticky panel to `/tasks`.

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
