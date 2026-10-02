# Fixes and Features Log - October 2026

## [2026-10-02] Sync: catch up after the Android app (or a tab) comes back

- **Issue:** Tasks edited on the web sometimes never showed up in the Android app. The app is a WebView on the same web build, and tasks reach it only through Supabase Realtime. When Android backgrounds the WebView the WebSocket drops; Realtime does not replay what happened while disconnected, and nothing re-fetched on return. The realtime channels were also subscribed without a status callback, so a channel the server closed stayed dead silently.
- **Change:**
    - New catch-up resync (`src/lib/sync/resync.ts`, wired in `authSlice`): on `visibilitychange` back to visible (hidden ≥ 10 s, or always when a channel had dropped), `online`, `pageshow` (bfcache) and `resume`, and after a realtime channel goes from an error/closed state back to `SUBSCRIBED`. Light collections are re-read in full; tasks are read incrementally (`updated_at >=` the watermark of the last complete fetch, minus a 2-minute overlap, one page of 1,000 rows, else full reload); deletions are reconciled by an id list for the dates around today and the viewed date. Pending (in-flight) local writes are never overwritten. One resync at a time; a trigger during a run queues one more.
    - `subscribeTable` now passes a status callback. `CLOSED` channels are recreated with backoff (1/2/5/10 s); `CHANNEL_ERROR` / `TIMED_OUT` are left to realtime-js's own rejoin and the recovery is detected on the next `SUBSCRIBED`.
    - Realtime task events are coalesced per task id for 150 ms before `fetchTaskById` (a save with k tags used to trigger 1 + 2k fetches).
    - `AuthSlice` gains `lastResyncAt` and `resyncFromServer(reason)`.
    - Migration `20261002120000_tasks_updated_at_index.sql` adds `tasks(user_id, updated_at)` for the incremental query. Optional; apply with `npx supabase db push`.
- **Spec:** `docs/resync_spec.md`. QA: SYNC-01〜03.
- **Impact:** No schema or store-shape changes beyond the two new auth fields. Browsers get the same behaviour (background tabs also drop Realtime). The Android widget is unchanged; it re-syncs from the fresher store once the app is open. No APK rebuild needed.

## [2026-10-02] Performance: lighter task page and fewer rerenders

- **Issue:** The app felt heavy. Every store change re-rendered 32 components that subscribed to the whole store (`useStore()` without a selector); `AddTaskModal` (1,000+ lines, ~50 hooks) stayed mounted and subscribed in up to 13 places while closed; the `/tasks` header recomputed a "finish at" time over every task the user ever had on every change and every minute, then rendered twice; the AI chat panel pulled framer-motion, the AI SDK and react-markdown into the initial bundle; driver.js (one-time tour) was always loaded; every client navigation re-ran `getUser` + a `profiles` upsert + a `sections` select and replaced the `user` object; attachment images re-signed their URL on every mount.
- **Change:**
    - All `useStore()` whole-store subscriptions converted to `useShallow` selectors (32 files; destructuring kept as-is).
    - `LazyAddTaskModal`: same props as `AddTaskModal`, renders nothing while closed, loads the modal chunk with `next/dynamic` on first open and prefetches it when idle. All 12 import sites switched.
    - `/tasks` header "finish at" is a `useMemo` over the viewed day's merged tasks in the list's own order (`sortTasksForDisplay`), taking the latest slot end.
    - `TaskList`: tasks grouped per section once per render (`tasksBySection`) instead of filter+sort twice per section; the timeline's task array is memoized so `DayTimeline` keeps its layout memo; `AIChatPanel` is loaded with `next/dynamic` (ssr off).
    - `useTour` imports driver.js and its CSS only when the tour actually starts.
    - `AuthProvider` runs its auth effect once; the current path is read from a ref for the login redirect.
    - `getAttachmentSignedUrl` caches signed URLs until 5 minutes before expiry and dedupes concurrent requests; `deleteAttachment` evicts.
    - `CalendarView` memoizes per-date merged tasks across the month grid.
- **Impact:** No behaviour change intended apart from "finish at" now reflecting the viewed day (it used to include open tasks from every date). Lint findings on the touched files did not increase; typecheck, unit tests and `next build` pass.
