-- Old Taskel clients synchronized attachments by deleting every metadata row
-- before re-inserting the full list. That behavior is no longer compatible
-- with immutable uploader ownership and could lose metadata during an
-- app-only rollback. Deny direct deletes and expose one validated operation
-- for current clients instead; an old client now fails before changing data.

drop policy if exists "task editors can delete attachments" on public.attachments;
revoke delete on public.attachments from authenticated;

create or replace function public.delete_task_attachments(
    task_uuid uuid,
    attachment_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    deleted_rows integer;
begin
    if caller_id is null then
        raise exception 'Unauthorized';
    end if;

    if not public.can_edit_task(task_uuid) then
        raise exception using errcode = '42501', message = 'Insufficient task permissions';
    end if;

    if attachment_ids is null or cardinality(attachment_ids) = 0 then
        return 0;
    end if;

    delete from public.attachments attachment
    where attachment.task_id = task_uuid
      and attachment.id = any (attachment_ids);

    get diagnostics deleted_rows = row_count;
    return deleted_rows;
end;
$$;

revoke execute on function public.delete_task_attachments(uuid, uuid[])
from public, anon;

grant execute on function public.delete_task_attachments(uuid, uuid[])
to authenticated;
