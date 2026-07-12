-- Durable, atomic invitation throttling. The counter is not directly exposed
-- through PostgREST, so an inviter cannot delete rows or race a count query to
-- bypass the hourly limit.
create table public.invitation_send_limits (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    window_started_at timestamptz not null,
    attempt_count smallint not null check (attempt_count between 1 and 10)
);

alter table public.invitation_send_limits enable row level security;

revoke all privileges
on public.invitation_send_limits
from public, anon, authenticated;

grant all privileges
on public.invitation_send_limits
to service_role;

create or replace function public.consume_invitation_send_attempt()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    allowed boolean;
begin
    if caller_id is null then
        raise exception 'Unauthorized';
    end if;

    insert into public.invitation_send_limits (
        user_id,
        window_started_at,
        attempt_count
    )
    values (caller_id, statement_timestamp(), 1)
    on conflict (user_id)
    do update
    set
        window_started_at = case
            when public.invitation_send_limits.window_started_at <= statement_timestamp() - interval '1 hour'
                then statement_timestamp()
            else public.invitation_send_limits.window_started_at
        end,
        attempt_count = case
            when public.invitation_send_limits.window_started_at <= statement_timestamp() - interval '1 hour'
                then 1
            else public.invitation_send_limits.attempt_count + 1
        end
    where public.invitation_send_limits.window_started_at <= statement_timestamp() - interval '1 hour'
       or public.invitation_send_limits.attempt_count < 10
    returning true into allowed;

    return coalesce(allowed, false);
end;
$$;

revoke execute on function public.consume_invitation_send_attempt()
from public, anon;

grant execute on function public.consume_invitation_send_attempt()
to authenticated, service_role;
