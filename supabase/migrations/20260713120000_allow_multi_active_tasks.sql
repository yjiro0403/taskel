-- Allow multiple concurrent in_progress tasks per user.
-- Previously 005_single_active_task enforced a single active task via partial unique index.
-- Multi-task workflows need several timers running at once.

drop index if exists public.tasks_single_active_per_user_idx;
