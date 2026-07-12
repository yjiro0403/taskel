-- Align database authorization with the application's collaboration roles:
--   owner/admin: manage the project and its tasks
--   member:      edit tasks
--   viewer:      read-only
--
-- This migration also removes direct invitation updates. Invitation acceptance
-- is performed exclusively by accept_invitation(), so an invitee must never be
-- able to rewrite the invitation's project or role before accepting it.

-- Harden functions created by earlier migrations. All referenced application
-- objects are schema-qualified, so an empty search_path is safe and prevents
-- object shadowing.
alter function public.set_updated_at() set search_path = '';
alter function public.sync_task_comment_count() set search_path = '';
alter function public.can_access_project(uuid) set search_path = '';
alter function public.can_manage_project(uuid) set search_path = '';
alter function public.can_access_task(uuid) set search_path = '';
alter function public.handle_new_user() set search_path = '';

-- Trigger-only functions are not public RPC endpoints. Future functions are
-- private to authenticated clients until a migration grants them explicitly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_task_comment_count() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter default privileges for role postgres in schema public
revoke execute on functions from authenticated;

grant execute on function public.can_access_project(uuid) to authenticated, service_role;
grant execute on function public.can_manage_project(uuid) to authenticated, service_role;
grant execute on function public.can_access_task(uuid) to authenticated, service_role;

create or replace function public.can_edit_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.projects p
        where p.id = project_uuid
          and p.owner_id = auth.uid()
    )
    or exists (
        select 1
        from public.project_members pm
        where pm.project_id = project_uuid
          and pm.user_id = auth.uid()
          and pm.role in ('owner', 'admin', 'member')
    );
$$;

create or replace function public.can_edit_task(task_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.tasks t
        where t.id = task_uuid
          and (
              (t.project_id is null and t.user_id = auth.uid())
              or (
                  t.project_id is not null
                  and public.can_edit_project(t.project_id)
              )
          )
    );
$$;

revoke execute on function public.can_edit_project(uuid) from public, anon;
revoke execute on function public.can_edit_task(uuid) from public, anon;
grant execute on function public.can_edit_project(uuid) to authenticated, service_role;
grant execute on function public.can_edit_task(uuid) to authenticated, service_role;

-- Only owner/admin may edit project metadata. Limit authenticated clients to
-- the three mutable columns so owner_id cannot be reassigned through PostgREST.
drop policy if exists "members can update projects" on public.projects;

create policy "owners and admins can update projects"
on public.projects
for update
to authenticated
using (public.can_manage_project(id))
with check (public.can_manage_project(id));

revoke update on public.projects from authenticated;
grant update (title, description, status) on public.projects to authenticated;

-- A personal task must stay personal unless the caller can edit its target
-- project. Project viewers can read project tasks but cannot mutate them.
drop policy if exists "owners and project members can create tasks" on public.tasks;
drop policy if exists "owners and project members can update tasks" on public.tasks;
drop policy if exists "owners and project members can delete tasks" on public.tasks;

create policy "task editors can create tasks"
on public.tasks
for insert
to authenticated
with check (
    (project_id is null and user_id = (select auth.uid()))
    or (
        project_id is not null
        and public.can_edit_project(project_id)
    )
);

create policy "task editors can update tasks"
on public.tasks
for update
to authenticated
using (
    (project_id is null and user_id = (select auth.uid()))
    or (
        project_id is not null
        and public.can_edit_project(project_id)
    )
)
with check (
    (project_id is null and user_id = (select auth.uid()))
    or (
        project_id is not null
        and public.can_edit_project(project_id)
    )
);

create policy "task editors can delete tasks"
on public.tasks
for delete
to authenticated
using (
    (project_id is null and user_id = (select auth.uid()))
    or (
        project_id is not null
        and public.can_edit_project(project_id)
    )
);

-- Viewer means read-only across task-owned collaboration records as well.
drop policy if exists "task viewers can create comments" on public.task_comments;
drop policy if exists "comment authors can update comments" on public.task_comments;
drop policy if exists "comment authors can delete comments" on public.task_comments;

create policy "task editors can create comments"
on public.task_comments
for insert
to authenticated
with check (
    public.can_edit_task(task_id)
    and (
        user_id = (select auth.uid())
        or author_type = 'ai'
    )
);

create policy "task editors can update their comments"
on public.task_comments
for update
to authenticated
using (
    public.can_edit_task(task_id)
    and user_id = (select auth.uid())
)
with check (
    public.can_edit_task(task_id)
    and user_id = (select auth.uid())
);

create policy "task editors can delete their comments"
on public.task_comments
for delete
to authenticated
using (
    public.can_edit_task(task_id)
    and user_id = (select auth.uid())
);

drop policy if exists "task editors can write task tags" on public.task_tags;
drop policy if exists "task editors can delete task tags" on public.task_tags;

create policy "task editors can write task tags"
on public.task_tags
for insert
to authenticated
with check (public.can_edit_task(task_id));

create policy "task editors can delete task tags"
on public.task_tags
for delete
to authenticated
using (public.can_edit_task(task_id));

drop policy if exists "task editors can manage attachments" on public.attachments;
drop policy if exists "task editors can update attachments" on public.attachments;
drop policy if exists "task editors can delete attachments" on public.attachments;

create policy "task editors can create attachments"
on public.attachments
for insert
to authenticated
with check (public.can_edit_task(task_id));

create policy "task editors can update attachments"
on public.attachments
for update
to authenticated
using (public.can_edit_task(task_id))
with check (public.can_edit_task(task_id));

create policy "task editors can delete attachments"
on public.attachments
for delete
to authenticated
using (public.can_edit_task(task_id));

-- The bucket remains private. Once an attachment metadata row is associated
-- with an accessible task, project members may generate a short-lived signed
-- URL for the object. Upload/update/delete remain restricted to the uploader's
-- own storage folder by the existing policies.
drop policy if exists "attachments read own" on storage.objects;
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
              and public.can_access_task(attachment.task_id)
        )
    )
);

update storage.buckets
set file_size_limit = 5242880
where id = 'attachments';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/*']::text[]
where id = 'avatars';

-- Invitation rows are immutable to authenticated clients. The SECURITY
-- DEFINER acceptance function below is the only path that marks one accepted.
drop policy if exists "related users can update invitations" on public.invitations;
revoke update on public.invitations from authenticated;

-- The UI exposes admin/member/viewer invitations only. Enforce the same rule
-- at the database boundary so a crafted request cannot create a co-owner.
drop policy if exists "project owners and admins can create invitations" on public.invitations;

create policy "project owners and admins can create invitations"
on public.invitations
for insert
to authenticated
with check (
    inviter_id = (select auth.uid())
    and role <> 'owner'
    and public.can_manage_project(project_id)
);

create or replace function public.accept_invitation(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    invitation_row public.invitations%rowtype;
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'Unauthorized';
    end if;

    select *
    into invitation_row
    from public.invitations
    where id = invite_token
    for update;

    if not found then
        raise exception 'Invitation not found';
    end if;

    if invitation_row.role = 'owner' then
        raise exception 'Owner invitations are not supported';
    end if;

    if invitation_row.status <> 'pending' then
        raise exception 'Invitation is no longer pending';
    end if;

    if invitation_row.expires_at < timezone('utc', now()) then
        raise exception 'Invitation expired';
    end if;

    if invitation_row.email is not null
       and lower(invitation_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
        raise exception 'Invitation is for a different email address';
    end if;

    insert into public.project_members (project_id, user_id, role)
    values (invitation_row.project_id, current_user_id, invitation_row.role)
    on conflict (project_id, user_id)
    do update set role = excluded.role;

    if not invitation_row.is_reusable then
        update public.invitations
        set status = 'accepted'
        where id = invite_token;
    end if;

    return invitation_row.project_id;
end;
$$;

revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated, service_role;
