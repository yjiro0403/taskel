create or replace function public.accept_invitation(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
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
    where id = invite_token;

    if not found then
        raise exception 'Invitation not found';
    end if;

    if invitation_row.status = 'accepted' and not invitation_row.is_reusable then
        raise exception 'Invitation already used';
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
