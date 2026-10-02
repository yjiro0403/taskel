-- Deleting a task used to keep its money rows: finance_entries.task_id was
-- ON DELETE SET NULL, and occurred_on stayed on the row. summarize_finance_range
-- and list_finance_entries_in_range count every row in the date window, so the
-- day and week totals still included the amount after the task was gone. The
-- task editor is the only place those rows can be changed, so the leftover
-- amount could not be removed.
--
-- Money recorded on a task belongs to that task. Deleting the task deletes
-- every collaborator's finance rows for it. Amounts are not shared; they are
-- removed. A routine date move does not delete the source row (it is marked
-- skipped, then replace_task_finance_entries moves the caller's rows), so this
-- cascade does not run on that path.
--
-- Rows already detached by the old behavior are deleted here. They are the
-- amounts still showing on days whose task no longer exists.

delete from public.finance_entries
where task_id is null;

alter table public.finance_entries
    drop constraint finance_entries_task_id_fkey;

alter table public.finance_entries
    alter column task_id set not null;

alter table public.finance_entries
    add constraint finance_entries_task_id_fkey
    foreign key (task_id)
    references public.tasks (id)
    on delete cascade;

comment on column public.finance_entries.task_id is
    'Task this money belongs to. Deleting the task deletes these rows.';

-- Cascade lookups use finance_entries_task_id_idx (created with the table).
-- The covering (user_id, occurred_on) index does not include task_id.

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'finance_entries'
          and column_name = 'task_id'
          and is_nullable = 'YES'
    ) then
        raise exception 'finance_entries.task_id must be NOT NULL so a deleted task cannot leave a counted row';
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'finance_entries_task_id_fkey'
          and conrelid = 'public.finance_entries'::regclass
          and pg_get_constraintdef(oid) ilike '%ON DELETE CASCADE%'
    ) then
        raise exception 'finance_entries.task_id must reference tasks ON DELETE CASCADE';
    end if;

    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'finance_entries_task_id_idx'
    ) then
        raise exception 'finance_entries_task_id_idx is required for ON DELETE CASCADE';
    end if;
end $$;
