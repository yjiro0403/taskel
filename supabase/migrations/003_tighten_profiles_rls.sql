drop policy if exists "profiles are readable by authenticated users" on public.profiles;

create policy "users can read accessible profiles"
on public.profiles
for select
to authenticated
using (
    id = auth.uid()
    or exists (
        select 1
        from public.project_members viewer_membership
        join public.project_members profile_membership
            on profile_membership.project_id = viewer_membership.project_id
        where viewer_membership.user_id = auth.uid()
          and profile_membership.user_id = profiles.id
    )
);
