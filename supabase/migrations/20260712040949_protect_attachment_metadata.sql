-- Bind every attachment metadata row to the user-owned Storage path that
-- created it. Without an immutable uploader/path relationship, an editor
-- could point metadata at another user's known object path and obtain a
-- signed URL through the shared-task SELECT policy.

alter table public.attachments
add column if not exists uploader_id uuid
    default auth.uid()
    references public.profiles (id) on delete cascade;

-- Existing Taskel uploads have always used users/{uid}/attachments/{file}.
-- Backfill that owner before making the relationship mandatory. Abort rather
-- than silently certifying or deleting a path that does not follow the
-- application convention.
update public.attachments attachment
set uploader_id = profile.id
from public.profiles profile
where attachment.uploader_id is null
  and (storage.foldername(attachment.storage_path))[1] = 'users'
  and (storage.foldername(attachment.storage_path))[2] = profile.id::text;

do $$
begin
    if exists (
        select 1
        from public.attachments attachment
        where attachment.uploader_id is null
           or (storage.foldername(attachment.storage_path))[1] <> 'users'
           or (storage.foldername(attachment.storage_path))[2] <> attachment.uploader_id::text
    ) then
        raise exception 'Cannot verify the owner of one or more attachment paths';
    end if;
end;
$$;

alter table public.attachments
alter column uploader_id set not null;

create index if not exists attachments_uploader_id_idx
on public.attachments (uploader_id);

drop policy if exists "task editors can create attachments" on public.attachments;

create policy "task editors can create attachments"
on public.attachments
for insert
to authenticated
with check (
    public.can_edit_task(task_id)
    and uploader_id = (select auth.uid())
    and (storage.foldername(storage_path))[1] = 'users'
    and (storage.foldername(storage_path))[2] = (select auth.uid())::text
    and (storage.foldername(storage_path))[3] = 'attachments'
    and url = storage_path
    and exists (
        select 1
        from storage.objects stored_object
        where stored_object.bucket_id = 'attachments'
          and stored_object.name = storage_path
          and stored_object.owner_id = (select auth.uid())::text
    )
);

-- Attachment identity, task association, uploader, and path are immutable.
-- The client synchronizes metadata with insert/delete, so authenticated users
-- do not need UPDATE at all. service_role retains its table-wide privileges.
drop policy if exists "task editors can update attachments" on public.attachments;
revoke update on public.attachments from authenticated;

drop policy if exists "attachments read accessible tasks" on storage.objects;

create policy "attachments read accessible tasks"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'attachments'
    and (
        (
            (storage.foldername(name))[1] = 'users'
            and (storage.foldername(name))[2] = (select auth.uid())::text
        )
        or exists (
            select 1
            from public.attachments attachment
            where attachment.storage_path = storage.objects.name
              and attachment.uploader_id::text = (storage.foldername(storage.objects.name))[2]
              and public.can_access_task(attachment.task_id)
        )
    )
);

-- A task owner is immutable for authenticated clients. Moving a task to a
-- different project is allowed only when the caller owns every attached
-- object; otherwise the move could expose a collaborator's object to a new
-- audience. service_role/postgres calls have no auth.uid() and remain usable
-- for controlled migrations.
create or replace function public.protect_task_attachment_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
begin
    if caller_id is null then
        return new;
    end if;

    if new.user_id is distinct from old.user_id then
        raise exception using
            errcode = '42501',
            message = 'Task ownership cannot be changed';
    end if;

    if new.project_id is distinct from old.project_id
       and exists (
           select 1
           from public.attachments attachment
           where attachment.task_id = old.id
             and attachment.uploader_id <> caller_id
       ) then
        raise exception using
            errcode = '42501',
            message = 'A task with another user''s attachment cannot change project scope';
    end if;

    return new;
end;
$$;

revoke execute on function public.protect_task_attachment_scope()
from public, anon, authenticated, service_role;

drop trigger if exists protect_task_attachment_scope on public.tasks;

create trigger protect_task_attachment_scope
before update of project_id, user_id on public.tasks
for each row
when (
    old.project_id is distinct from new.project_id
    or old.user_id is distinct from new.user_id
)
execute function public.protect_task_attachment_scope();
