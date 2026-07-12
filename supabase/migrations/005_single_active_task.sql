create unique index if not exists tasks_single_active_per_user_idx
on public.tasks (user_id)
where status = 'in_progress';
