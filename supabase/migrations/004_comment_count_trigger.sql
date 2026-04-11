create or replace function public.sync_task_comment_count()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        update public.tasks
        set comment_count = comment_count + 1
        where id = new.task_id;
        return new;
    end if;

    if tg_op = 'DELETE' then
        update public.tasks
        set comment_count = greatest(comment_count - 1, 0)
        where id = old.task_id;
        return old;
    end if;

    return null;
end;
$$;

update public.tasks t
set comment_count = coalesce(comment_totals.total_comments, 0)
from (
    select task_id, count(*)::integer as total_comments
    from public.task_comments
    group by task_id
) comment_totals
where t.id = comment_totals.task_id;

update public.tasks
set comment_count = 0
where id not in (
    select distinct task_id
    from public.task_comments
);

drop trigger if exists task_comments_sync_count_on_insert on public.task_comments;
create trigger task_comments_sync_count_on_insert
after insert on public.task_comments
for each row execute function public.sync_task_comment_count();

drop trigger if exists task_comments_sync_count_on_delete on public.task_comments;
create trigger task_comments_sync_count_on_delete
after delete on public.task_comments
for each row execute function public.sync_task_comment_count();
