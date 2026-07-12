-- Keep the canonical projects.owner_id and the membership role model in sync.
-- Only that canonical owner may hold the `owner` role, and their membership
-- cannot be demoted through a crafted upsert or invitation acceptance.
do $$
begin
    if exists (
        select 1
        from public.project_members membership
        join public.projects project on project.id = membership.project_id
        where (membership.role = 'owner') <> (membership.user_id = project.owner_id)
    ) then
        raise exception 'Cannot enforce project owner roles while inconsistent memberships exist';
    end if;
end;
$$;

create or replace function public.enforce_project_membership_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    canonical_owner_id uuid;
begin
    select project.owner_id
    into canonical_owner_id
    from public.projects project
    where project.id = new.project_id;

    if canonical_owner_id is null then
        raise exception using errcode = '23503', message = 'Project not found';
    end if;

    if new.user_id = canonical_owner_id and new.role <> 'owner' then
        raise exception using errcode = '42501', message = 'The project owner role cannot be demoted';
    end if;

    if new.user_id <> canonical_owner_id and new.role = 'owner' then
        raise exception using errcode = '42501', message = 'Only the canonical project owner may hold the owner role';
    end if;

    return new;
end;
$$;

revoke execute on function public.enforce_project_membership_role()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_project_membership_role on public.project_members;

create trigger enforce_project_membership_role
before insert or update of project_id, user_id, role on public.project_members
for each row execute function public.enforce_project_membership_role();

drop policy if exists "owners can add themselves to new projects" on public.project_members;
drop policy if exists "owners and admins can update project memberships" on public.project_members;
drop policy if exists "owners and admins can delete project memberships" on public.project_members;

create policy "managers can add valid project memberships"
on public.project_members
for insert
to authenticated
with check (
    exists (
        select 1
        from public.projects project
        where project.id = project_id
          and (
              (
                  project.owner_id = (select auth.uid())
                  and user_id = (select auth.uid())
                  and role = 'owner'
              )
              or (
                  public.can_manage_project(project_id)
                  and user_id <> project.owner_id
                  and role <> 'owner'
              )
          )
    )
);

create policy "managers can update non-owner memberships"
on public.project_members
for update
to authenticated
using (
    public.can_manage_project(project_id)
    and exists (
        select 1
        from public.projects project
        where project.id = project_id
          and user_id <> project.owner_id
    )
)
with check (
    public.can_manage_project(project_id)
    and role <> 'owner'
    and exists (
        select 1
        from public.projects project
        where project.id = project_id
          and user_id <> project.owner_id
    )
);

create policy "managers can delete non-owner memberships"
on public.project_members
for delete
to authenticated
using (
    public.can_manage_project(project_id)
    and exists (
        select 1
        from public.projects project
        where project.id = project_id
          and user_id <> project.owner_id
    )
);

-- Upserts only need to change the role. Keeping the composite key immutable
-- prevents a membership row being moved to another project or user.
revoke update on public.project_members from authenticated;
grant update (role) on public.project_members to authenticated;
