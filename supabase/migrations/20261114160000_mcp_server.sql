-- Taskel MCP server: personal access tokens, audit trail and the data
-- functions behind POST /api/mcp.
--
-- Security model
--   * The MCP route authenticates a bearer token, then reaches data only
--     through the mcp_* functions below. Each takes the user id resolved from
--     the token and hard-codes the ownership filter, so a caller cannot widen
--     its own reach by choosing arguments.
--   * Only service_role may execute them. Browser sessions (authenticated)
--     and anon have no privilege on the tables and no execute on the
--     functions: tokens are issued, listed and revoked through the functions
--     as well.
--   * The four tables have RLS enabled and no policy.
--
-- Grants
--   * 010_api_role_grants.sql gives every new table select/insert/update/
--     delete for authenticated through default privileges, so each table
--     below revokes that explicitly.
--   * Postgres grants EXECUTE on a new function to PUBLIC. The per-schema
--     default revoke does not remove that built-in grant, so each function is
--     revoked explicitly too.
--
-- The migration is additive: no existing table, policy or function changes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.mcp_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 60),
    token_prefix text not null check (char_length(token_prefix) = 16),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    scopes text[] not null check (
        cardinality(scopes) between 1 and 2
        and scopes <@ array['tasks:read', 'tasks:create']
    ),
    timezone text not null check (char_length(timezone) between 1 and 64),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    last_used_at timestamptz,
    revoked_at timestamptz,
    revoked_via text check (revoked_via in ('ui', 'self')),
    constraint mcp_tokens_expiry_check check (
        expires_at > created_at
        and expires_at <= created_at + interval '366 days'
    )
);

create index mcp_tokens_user_created_idx
    on public.mcp_tokens (user_id, created_at desc);

comment on table public.mcp_tokens is
    'Personal access tokens for the MCP endpoint. Only the SHA-256 of a token is stored.';

-- Append-only. Rows hold argument keys, never titles or search text.
create table public.mcp_audit_logs (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    user_id uuid references auth.users (id) on delete cascade,
    token_id uuid references public.mcp_tokens (id) on delete set null,
    token_prefix text,
    event text not null check (
        event in ('tool_call', 'token_issued', 'token_revoked', 'rate_limited', 'denied')
    ),
    tool text,
    ok boolean not null,
    error_code text,
    target_task_id uuid,
    arg_keys text[] not null default '{}',
    request_id text check (char_length(request_id) <= 64)
);

create index mcp_audit_logs_user_created_idx
    on public.mcp_audit_logs (user_id, created_at desc);
create index mcp_audit_logs_token_created_idx
    on public.mcp_audit_logs (token_id, created_at desc);

create table public.mcp_rate_windows (
    token_id uuid not null references public.mcp_tokens (id) on delete cascade,
    window_start timestamptz not null,
    count integer not null,
    primary key (token_id, window_start)
);

create table public.mcp_task_creations (
    token_id uuid not null references public.mcp_tokens (id) on delete cascade,
    idempotency_key text not null,
    request_hash text not null,
    task_id uuid references public.tasks (id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (token_id, idempotency_key)
);

create index mcp_task_creations_token_created_idx
    on public.mcp_task_creations (token_id, created_at desc);

alter table public.mcp_tokens enable row level security;
alter table public.mcp_audit_logs enable row level security;
alter table public.mcp_rate_windows enable row level security;
alter table public.mcp_task_creations enable row level security;

revoke all on table public.mcp_tokens from public, anon, authenticated;
revoke all on table public.mcp_audit_logs from public, anon, authenticated;
revoke all on table public.mcp_rate_windows from public, anon, authenticated;
revoke all on table public.mcp_task_creations from public, anon, authenticated;
revoke all on sequence public.mcp_audit_logs_id_seq from public, anon, authenticated;

grant all on table public.mcp_tokens to service_role;
grant all on table public.mcp_audit_logs to service_role;
grant all on table public.mcp_rate_windows to service_role;
grant all on table public.mcp_task_creations to service_role;
grant all on sequence public.mcp_audit_logs_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Scope helper
-- ---------------------------------------------------------------------------

-- "My tasks" for MCP: a row with no project, or a project this user owns that
-- has no other member. Rows in a project shared with anyone else are out of
-- scope even when user_id is this user.
create or replace function public.mcp_in_scope(p_user_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select p_user_id is not null
       and (
            p_project_id is null
            or (
                exists (
                    select 1
                    from public.projects p
                    where p.id = p_project_id
                      and p.owner_id = p_user_id
                )
                and not exists (
                    select 1
                    from public.project_members m
                    where m.project_id = p_project_id
                      and m.user_id <> p_user_id
                )
            )
       );
$$;

revoke execute on function public.mcp_in_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_in_scope(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers. No API role may execute these, service_role included;
-- they run only inside the definer functions below.
-- ---------------------------------------------------------------------------

-- Returns the token row when it belongs to p_user_id, is neither revoked nor
-- expired, and (when p_scope is given) carries that scope. Raises otherwise.
-- Every data function calls this first, so a wrong user/token pair coming
-- from the application layer cannot read or write anything.
create or replace function public.mcp_require_token(
    p_user_id uuid,
    p_token_id uuid,
    p_scope text
)
returns public.mcp_tokens
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
begin
    if p_user_id is null or p_token_id is null then
        raise exception 'MCP_TOKEN_NOT_ACTIVE' using errcode = '42501';
    end if;

    select t.*
    into v_token
    from public.mcp_tokens t
    where t.id = p_token_id
      and t.user_id = p_user_id
      and t.revoked_at is null
      and t.expires_at > now();

    if not found then
        raise exception 'MCP_TOKEN_NOT_ACTIVE' using errcode = '42501';
    end if;

    if p_scope is not null and not (p_scope = any (v_token.scopes)) then
        raise exception 'MCP_SCOPE_FORBIDDEN' using errcode = '42501';
    end if;

    return v_token;
end;
$$;

revoke execute on function public.mcp_require_token(uuid, uuid, text)
    from public, anon, authenticated, service_role;

-- One audit row. Free text is never stored: argument keys, tool names, error
-- codes and request ids that do not look like identifiers are dropped.
create or replace function public.mcp_write_audit(
    p_user_id uuid,
    p_token_id uuid,
    p_token_prefix text,
    p_event text,
    p_tool text,
    p_ok boolean,
    p_error_code text,
    p_target_task_id uuid,
    p_arg_keys text[],
    p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.mcp_audit_logs (
        user_id,
        token_id,
        token_prefix,
        event,
        tool,
        ok,
        error_code,
        target_task_id,
        arg_keys,
        request_id
    )
    values (
        p_user_id,
        p_token_id,
        p_token_prefix,
        p_event,
        case when p_tool ~ '^[a-z0-9_]{1,64}$' then p_tool end,
        p_ok,
        case when p_error_code ~ '^[A-Z0-9_]{1,40}$' then p_error_code end,
        p_target_task_id,
        coalesce(
            (
                select array_agg(k.key order by k.ord)
                from (
                    select u.key, u.ord
                    from unnest(coalesce(p_arg_keys, '{}'::text[])) with ordinality as u (key, ord)
                    where u.key ~ '^[a-z_]{1,32}$'
                    order by u.ord
                    limit 12
                ) k
            ),
            '{}'::text[]
        ),
        case when p_request_id ~ '^[A-Za-z0-9-]{1,64}$' then p_request_id end
    );
end;
$$;

revoke execute on function public.mcp_write_audit(
    uuid, uuid, text, text, text, boolean, text, uuid, text[], text
) from public, anon, authenticated, service_role;

-- The only task projection that leaves the database. It has no memo,
-- checklist, tags or project id. It applies no ownership filter: callers
-- select the row under their own filter first and pass its id.
-- (It takes an id, not a tasks row: PostgREST would treat a function of a
-- table row as a computed column of that table.)
create or replace function public.mcp_task_json(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'date', t.date,
        'scheduled_start', to_char(t.scheduled_start, 'HH24:MI'),
        'section_id', t.section_id,
        'section', (
            select s.name
            from public.sections s
            where s.id = t.section_id
              and s.user_id = t.user_id
        ),
        'estimated_minutes', t.estimated_minutes,
        'actual_minutes', t.actual_minutes,
        'routine_id', t.routine_id,
        'completed_at', case when t.status = 'done' then t.completed_at end
    )
    from public.tasks t
    where t.id = p_task_id;
$$;

revoke execute on function public.mcp_task_json(uuid)
    from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Token lifecycle (called by the cookie-session token routes)
-- ---------------------------------------------------------------------------

create or replace function public.mcp_issue_token(
    p_user_id uuid,
    p_name text,
    p_token_hash text,
    p_token_prefix text,
    p_scopes text[],
    p_expires_days integer,
    p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_now timestamptz := now();
    v_name text := btrim(coalesce(p_name, ''));
    v_active integer;
    v_token public.mcp_tokens;
begin
    if p_user_id is null then
        raise exception 'MCP_USER_REQUIRED' using errcode = '22023';
    end if;

    if char_length(v_name) not between 1 and 60
        or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
        or p_token_prefix is null or p_token_prefix !~ '^tsk_mcp_[A-Za-z0-9_-]{8}$'
        or p_scopes is null
        or cardinality(p_scopes) not between 1 and 2
        or not (p_scopes <@ array['tasks:read', 'tasks:create'])
        or cardinality(p_scopes) <> (select count(distinct s) from unnest(p_scopes) as s)
        or p_expires_days is null or p_expires_days not between 1 and 365
        or p_timezone is null or char_length(p_timezone) not between 1 and 64
        or not exists (
            select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone
        )
    then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    -- Serialises issuing per user so the limit of five cannot be raced.
    perform pg_advisory_xact_lock(hashtextextended('mcp_issue_token:' || p_user_id::text, 0));

    select count(*)
    into v_active
    from public.mcp_tokens t
    where t.user_id = p_user_id
      and t.revoked_at is null
      and t.expires_at > now();

    if v_active >= 5 then
        return jsonb_build_object('ok', false, 'code', 'TOKEN_LIMIT');
    end if;

    -- created_at and expires_at are set here. The caller chooses only a
    -- number of days.
    insert into public.mcp_tokens (
        user_id, name, token_prefix, token_hash, scopes, timezone, created_at, expires_at
    )
    values (
        p_user_id,
        v_name,
        p_token_prefix,
        p_token_hash,
        p_scopes,
        p_timezone,
        v_now,
        v_now + make_interval(days => p_expires_days)
    )
    returning * into v_token;

    perform public.mcp_write_audit(
        p_user_id, v_token.id, v_token.token_prefix, 'token_issued', null, true, null, null, null, null
    );

    delete from public.mcp_audit_logs a
    where a.user_id = p_user_id
      and a.created_at < now() - interval '180 days';

    return jsonb_build_object(
        'ok', true,
        'token', jsonb_build_object(
            'id', v_token.id,
            'name', v_token.name,
            'prefix', v_token.token_prefix,
            'scopes', v_token.scopes,
            'timezone', v_token.timezone,
            'created_at', v_token.created_at,
            'expires_at', v_token.expires_at,
            'last_used_at', v_token.last_used_at,
            'revoked_at', v_token.revoked_at,
            'revoked_via', v_token.revoked_via
        )
    );
end;
$$;

revoke execute on function public.mcp_issue_token(uuid, text, text, text, text[], integer, text)
    from public, anon, authenticated;
grant execute on function public.mcp_issue_token(uuid, text, text, text, text[], integer, text)
    to service_role;

create or replace function public.mcp_list_tokens(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_tokens jsonb;
    v_recent jsonb;
begin
    if p_user_id is null then
        raise exception 'MCP_USER_REQUIRED' using errcode = '22023';
    end if;

    -- token_hash is never selected.
    select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb)
    into v_tokens
    from (
        select
            t.created_at,
            t.id,
            jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'prefix', t.token_prefix,
                'scopes', t.scopes,
                'timezone', t.timezone,
                'created_at', t.created_at,
                'expires_at', t.expires_at,
                'last_used_at', t.last_used_at,
                'revoked_at', t.revoked_at,
                'revoked_via', t.revoked_via
            ) as item
        from public.mcp_tokens t
        where t.user_id = p_user_id
        order by t.created_at desc, t.id
        limit 50
    ) x;

    select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_recent
    from (
        select
            a.created_at,
            a.id,
            jsonb_build_object(
                'created_at', a.created_at,
                'event', a.event,
                'tool', a.tool,
                'ok', a.ok,
                'error_code', a.error_code,
                'token_id', a.token_id,
                'token_prefix', a.token_prefix
            ) as item
        from public.mcp_audit_logs a
        where a.user_id = p_user_id
        order by a.created_at desc, a.id desc
        limit 20
    ) x;

    return jsonb_build_object('tokens', v_tokens, 'recent', v_recent);
end;
$$;

revoke execute on function public.mcp_list_tokens(uuid) from public, anon, authenticated;
grant execute on function public.mcp_list_tokens(uuid) to service_role;

-- Revocation is one-way: no function clears revoked_at.
create or replace function public.mcp_revoke_token(
    p_user_id uuid,
    p_token_id uuid,
    p_via text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_prefix text;
begin
    if p_user_id is null or p_token_id is null then
        return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;

    if p_via is null or p_via not in ('ui', 'self') then
        raise exception 'MCP_INVALID_VIA' using errcode = '22023';
    end if;

    update public.mcp_tokens t
    set revoked_at = now(),
        revoked_via = p_via
    where t.id = p_token_id
      and t.user_id = p_user_id
      and t.revoked_at is null
    returning t.token_prefix into v_prefix;

    if not found then
        if exists (
            select 1
            from public.mcp_tokens t
            where t.id = p_token_id
              and t.user_id = p_user_id
        ) then
            return jsonb_build_object('ok', false, 'code', 'ALREADY_REVOKED');
        end if;
        return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_prefix, 'token_revoked', null, true, null, null, null, null
    );

    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.mcp_revoke_token(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_revoke_token(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Request authentication and the per-token rate limit
-- ---------------------------------------------------------------------------

-- An unknown hash returns before any write. The rate counter lives here, in
-- the database, so every server instance shares it: 60 requests per token per
-- clock minute.
create or replace function public.mcp_authenticate(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
    v_now timestamptz := now();
    v_window timestamptz := date_trunc('minute', v_now);
    v_count integer;
begin
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('status', 'unknown');
    end if;

    select t.*
    into v_token
    from public.mcp_tokens t
    where t.token_hash = p_token_hash;

    if not found then
        return jsonb_build_object('status', 'unknown');
    end if;

    if v_token.revoked_at is not null then
        return jsonb_build_object('status', 'revoked');
    end if;

    if v_token.expires_at <= v_now then
        return jsonb_build_object('status', 'expired');
    end if;

    insert into public.mcp_rate_windows as w (token_id, window_start, count)
    values (v_token.id, v_window, 1)
    on conflict (token_id, window_start)
    do update set count = w.count + 1
    returning w.count into v_count;

    if v_count = 1 then
        delete from public.mcp_rate_windows w
        where w.token_id = v_token.id
          and w.window_start < v_now - interval '10 minutes';
    end if;

    if v_count > 60 then
        if v_count = 61 then
            perform public.mcp_write_audit(
                v_token.user_id, v_token.id, v_token.token_prefix,
                'rate_limited', null, false, 'RATE_LIMITED', null, null, null
            );
        end if;

        return jsonb_build_object(
            'status', 'rate_limited',
            'retry_after_s', greatest(
                1,
                ceil(extract(epoch from (v_window + interval '1 minute' - clock_timestamp())))::integer
            )
        );
    end if;

    if v_token.last_used_at is null or v_token.last_used_at < v_now - interval '60 seconds' then
        update public.mcp_tokens t
        set last_used_at = v_now
        where t.id = v_token.id;
    end if;

    return jsonb_build_object(
        'status', 'ok',
        'token_id', v_token.id,
        'user_id', v_token.user_id,
        'name', v_token.name,
        'prefix', v_token.token_prefix,
        'scopes', v_token.scopes,
        'timezone', v_token.timezone,
        'expires_at', v_token.expires_at
    );
end;
$$;

revoke execute on function public.mcp_authenticate(text) from public, anon, authenticated;
grant execute on function public.mcp_authenticate(text) to service_role;

-- ---------------------------------------------------------------------------
-- Read functions
-- ---------------------------------------------------------------------------

-- Everything the day view needs for one date. The application merges routine
-- occurrences with the stored rows.
--
-- Tasks and routines outside the MCP scope are returned with a null title:
-- the day view needs their ids to suppress routine occurrences and to count
-- hidden rows, never their text.
--
-- p_tool names the tool on whose behalf the snapshot is read. For
-- 'taskel_create_task' (which only needs the sections to place a new task)
-- the token needs tasks:create and no task, goal or routine is returned.
create or replace function public.mcp_day_snapshot(
    p_user_id uuid,
    p_token_id uuid,
    p_request_id text,
    p_arg_keys text[],
    p_date date,
    p_tool text default 'taskel_list_tasks_for_day'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
    v_for_create boolean;
    v_tasks jsonb := '[]'::jsonb;
    v_goals jsonb := '[]'::jsonb;
    v_routines jsonb := '[]'::jsonb;
    v_sections jsonb;
    v_task_count integer := 0;
begin
    if p_tool is null or p_tool not in ('taskel_list_tasks_for_day', 'taskel_create_task') then
        raise exception 'MCP_INVALID_TOOL' using errcode = '22023';
    end if;
    if p_date is null then
        raise exception 'MCP_DATE_REQUIRED' using errcode = '22023';
    end if;

    v_for_create := p_tool = 'taskel_create_task';
    v_token := public.mcp_require_token(
        p_user_id,
        p_token_id,
        case when v_for_create then 'tasks:create' else 'tasks:read' end
    );

    select coalesce(jsonb_agg(x.item order by x.ord, x.id), '[]'::jsonb)
    into v_sections
    from (
        select
            s."order" as ord,
            s.id,
            jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'start_time', to_char(s.start_time, 'HH24:MI'),
                'end_time', to_char(s.end_time, 'HH24:MI'),
                'order', s."order"
            ) as item
        from public.sections s
        where s.user_id = p_user_id
    ) x;

    if not v_for_create then
        select coalesce(jsonb_agg(x.item order by x.ord, x.id), '[]'::jsonb), count(*)
        into v_tasks, v_task_count
        from (
            select
                t."order" as ord,
                t.id,
                jsonb_build_object(
                    'id', t.id,
                    'title', case when sc.in_scope then t.title end,
                    'status', t.status,
                    'date', t.date,
                    'scheduled_start', to_char(t.scheduled_start, 'HH24:MI'),
                    'section_id', t.section_id,
                    'estimated_minutes', t.estimated_minutes,
                    'actual_minutes', t.actual_minutes,
                    'routine_id', t.routine_id,
                    'order', t."order",
                    'in_scope', sc.in_scope
                ) as item
            from public.tasks t
            cross join lateral (
                select public.mcp_in_scope(p_user_id, t.project_id) as in_scope
            ) sc
            where t.user_id = p_user_id
              and t.date = p_date
            order by t."order", t.id
            limit 501
        ) x;

        select coalesce(jsonb_agg(x.item order by x.ord, x.id), '[]'::jsonb)
        into v_goals
        from (
            select
                t."order" as ord,
                t.id,
                jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status) as item
            from public.tasks t
            where t.user_id = p_user_id
              and t.date is null
              and t.assigned_date = p_date
              and t.status <> 'skipped'
              and public.mcp_in_scope(p_user_id, t.project_id)
            order by t."order", t.id
            limit 50
        ) x;

        select coalesce(jsonb_agg(x.item order by x.id), '[]'::jsonb)
        into v_routines
        from (
            select
                r.id,
                jsonb_build_object(
                    'id', r.id,
                    'title', case when sc.in_scope then r.title end,
                    'frequency', r.frequency,
                    'days_of_week', r.days_of_week,
                    'interval', r.interval,
                    'start_date', r.start_date,
                    'next_run', r.next_run,
                    'start_time', to_char(r.start_time, 'HH24:MI'),
                    'section_id', r.section_id,
                    'estimated_minutes', r.estimated_minutes,
                    'in_scope', sc.in_scope
                ) as item
            from public.routines r
            cross join lateral (
                select public.mcp_in_scope(p_user_id, r.project_id) as in_scope
            ) sc
            where r.user_id = p_user_id
              and r.active
            order by r.id
            limit 500
        ) x;
    end if;

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_token.token_prefix, 'tool_call', p_tool,
        true, null, null, p_arg_keys, p_request_id
    );

    return jsonb_build_object(
        'tasks', case when v_task_count > 500 then v_tasks - 500 else v_tasks end,
        'tasks_truncated', v_task_count > 500,
        'goals', v_goals,
        'routines', v_routines,
        'sections', v_sections
    );
end;
$$;

revoke execute on function public.mcp_day_snapshot(uuid, uuid, text, text[], date, text)
    from public, anon, authenticated;
grant execute on function public.mcp_day_snapshot(uuid, uuid, text, text[], date, text)
    to service_role;

-- Title-only search. Terms are bound parameters matched with position(), so
-- there is no LIKE pattern and no filter string to inject into.
create or replace function public.mcp_search_tasks(
    p_user_id uuid,
    p_token_id uuid,
    p_request_id text,
    p_arg_keys text[],
    p_terms text[],
    p_date_from date,
    p_date_to date,
    p_statuses text[],
    p_include_undated boolean,
    p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
    v_terms text[] := coalesce(p_terms, '{}'::text[]);
    v_statuses text[] := coalesce(p_statuses, array['open', 'in_progress', 'done']);
    v_include_undated boolean := coalesce(p_include_undated, false);
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
    v_tasks jsonb;
    v_count integer;
    v_routines jsonb := '[]'::jsonb;
begin
    v_token := public.mcp_require_token(p_user_id, p_token_id, 'tasks:read');

    if cardinality(v_terms) = 0 and p_date_from is null and p_date_to is null then
        raise exception 'MCP_SEARCH_NEEDS_FILTER' using errcode = '22023';
    end if;

    if cardinality(v_terms) > 5
        or exists (
            select 1
            from unnest(v_terms) as term
            where term is null or char_length(term) not between 1 and 50
        )
    then
        raise exception 'MCP_INVALID_TERMS' using errcode = '22023';
    end if;

    if cardinality(v_statuses) = 0
        or not (v_statuses <@ array['open', 'in_progress', 'done'])
    then
        raise exception 'MCP_INVALID_STATUS' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(x.item order by x.rn), '[]'::jsonb), count(*)
    into v_tasks, v_count
    from (
        select
            row_number() over (order by t.date desc nulls last, t."order", t.id) as rn,
            public.mcp_task_json(t.id) as item
        from public.tasks t
        where t.user_id = p_user_id
          and t.status <> 'skipped'
          and t.status::text = any (v_statuses)
          and public.mcp_in_scope(p_user_id, t.project_id)
          and (
                (t.date is null and v_include_undated)
                or (
                    t.date is not null
                    and (p_date_from is null or t.date >= p_date_from)
                    and (p_date_to is null or t.date <= p_date_to)
                )
          )
          and not exists (
                select 1
                from unnest(v_terms) as term
                where position(lower(term) in lower(t.title)) = 0
          )
        order by t.date desc nulls last, t."order", t.id
        limit v_limit + 1
    ) x;

    if cardinality(v_terms) > 0 then
        select coalesce(jsonb_agg(x.item order by x.title, x.id), '[]'::jsonb)
        into v_routines
        from (
            select
                r.title,
                r.id,
                jsonb_build_object(
                    'title', r.title,
                    'frequency', r.frequency,
                    'active', r.active
                ) as item
            from public.routines r
            where r.user_id = p_user_id
              and public.mcp_in_scope(p_user_id, r.project_id)
              and not exists (
                    select 1
                    from unnest(v_terms) as term
                    where position(lower(term) in lower(r.title)) = 0
              )
            order by r.title, r.id
            limit 10
        ) x;
    end if;

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_search_tasks',
        true, null, null, p_arg_keys, p_request_id
    );

    return jsonb_build_object(
        'tasks', case when v_count > v_limit then v_tasks - v_limit else v_tasks end,
        'truncated', v_count > v_limit,
        'routine_matches', v_routines
    );
end;
$$;

revoke execute on function public.mcp_search_tasks(
    uuid, uuid, text, text[], text[], date, date, text[], boolean, integer
) from public, anon, authenticated;
grant execute on function public.mcp_search_tasks(
    uuid, uuid, text, text[], text[], date, date, text[], boolean, integer
) to service_role;

-- One task by id. Another user's row, a row in a shared project and a skipped
-- row are all indistinguishable from a missing row.
create or replace function public.mcp_get_task(
    p_user_id uuid,
    p_token_id uuid,
    p_request_id text,
    p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
    v_task jsonb;
begin
    v_token := public.mcp_require_token(p_user_id, p_token_id, 'tasks:read');

    select public.mcp_task_json(t.id)
    into v_task
    from public.tasks t
    where t.id = p_task_id
      and t.user_id = p_user_id
      and t.status <> 'skipped'
      and public.mcp_in_scope(p_user_id, t.project_id);

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_get_task',
        v_task is not null,
        case when v_task is null then 'NOT_FOUND' end,
        p_task_id,
        array['id'],
        p_request_id
    );

    return jsonb_build_object('task', v_task);
end;
$$;

revoke execute on function public.mcp_get_task(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mcp_get_task(uuid, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The one write
-- ---------------------------------------------------------------------------

-- Creates a personal task (project_id is always null) for the token's user.
-- The id is generated here: a caller-chosen id could collide with a
-- deterministic virtual-routine id and hide that occurrence.
--
-- The advisory lock serialises creates per token, so the caps (30 per hour,
-- 100 per 24 hours) and the idempotency check cannot be raced. Task,
-- idempotency row and audit row are one transaction.
create or replace function public.mcp_create_task(
    p_user_id uuid,
    p_token_id uuid,
    p_request_id text,
    p_idempotency_key text,
    p_request_hash text,
    p_title text,
    p_date date,
    p_scheduled_start time,
    p_estimated_minutes integer,
    p_section_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
    v_title text := btrim(coalesce(p_title, ''));
    v_estimate integer := coalesce(p_estimated_minutes, 15);
    v_today date;
    v_key text;
    v_existing public.mcp_task_creations;
    v_task public.tasks;
    v_json jsonb;
    v_hour integer;
    v_day integer;
    v_order integer;
    v_arg_keys text[];
begin
    v_token := public.mcp_require_token(p_user_id, p_token_id, 'tasks:create');
    v_today := (now() at time zone v_token.timezone)::date;

    v_arg_keys := array['title', 'date']
        || case when p_scheduled_start is not null then array['scheduled_start'] else '{}'::text[] end
        || case when p_estimated_minutes is not null then array['estimated_minutes'] else '{}'::text[] end
        || case when p_idempotency_key is not null then array['idempotency_key'] else '{}'::text[] end;

    if char_length(v_title) not between 1 and 200
        or p_date is null
        or p_date < v_today - 31
        or p_date > v_today + 731
        or v_estimate not between 0 and 1440
        or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
        or (p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$')
    then
        perform public.mcp_write_audit(
            p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
            false, 'INVALID_INPUT', null, v_arg_keys, p_request_id
        );
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    perform pg_advisory_xact_lock(hashtextextended('mcp_create_task:' || p_token_id::text, 0));

    if p_idempotency_key is not null then
        select c.*
        into v_existing
        from public.mcp_task_creations c
        where c.token_id = p_token_id
          and c.idempotency_key = p_idempotency_key;

        if found then
            if v_existing.request_hash = p_request_hash and v_existing.task_id is not null then
                select public.mcp_task_json(t.id)
                into v_json
                from public.tasks t
                where t.id = v_existing.task_id
                  and t.user_id = p_user_id
                  and t.status <> 'skipped'
                  and public.mcp_in_scope(p_user_id, t.project_id);
            end if;

            if v_json is null then
                perform public.mcp_write_audit(
                    p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
                    false, 'CONFLICT', null, v_arg_keys, p_request_id
                );
                return jsonb_build_object('ok', false, 'code', 'CONFLICT');
            end if;

            perform public.mcp_write_audit(
                p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
                true, null, v_existing.task_id, v_arg_keys, p_request_id
            );
            return jsonb_build_object('ok', true, 'created', false, 'task', v_json);
        end if;
    end if;

    select
        count(*) filter (where c.created_at > now() - interval '1 hour'),
        count(*)
    into v_hour, v_day
    from public.mcp_task_creations c
    where c.token_id = p_token_id
      and c.created_at > now() - interval '24 hours';

    if v_hour >= 30 or v_day >= 100 then
        perform public.mcp_write_audit(
            p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
            false, 'RATE_LIMITED', null, v_arg_keys, p_request_id
        );
        return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
    end if;

    if p_section_id is not null and not exists (
        select 1
        from public.sections s
        where s.id = p_section_id
          and s.user_id = p_user_id
    ) then
        perform public.mcp_write_audit(
            p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
            false, 'INVALID_INPUT', null, v_arg_keys, p_request_id
        );
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    select coalesce(max(t."order"), 0) + 1
    into v_order
    from public.tasks t
    where t.user_id = p_user_id
      and t.date = p_date
      and t.section_id is not distinct from p_section_id;

    insert into public.tasks (
        id,
        user_id,
        title,
        section_id,
        date,
        status,
        estimated_minutes,
        actual_minutes,
        scheduled_start,
        project_id,
        "order",
        checklist,
        work_actor
    )
    values (
        gen_random_uuid(),
        p_user_id,
        v_title,
        p_section_id,
        p_date,
        'open',
        v_estimate,
        0,
        p_scheduled_start,
        null,
        v_order,
        '[]'::jsonb,
        'human'
    )
    returning * into v_task;

    -- A server-made key cannot collide with a client key: ':' is outside the
    -- client pattern.
    v_key := coalesce(p_idempotency_key, 'srv:' || gen_random_uuid()::text);

    insert into public.mcp_task_creations (token_id, idempotency_key, request_hash, task_id)
    values (p_token_id, v_key, p_request_hash, v_task.id);

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_token.token_prefix, 'tool_call', 'taskel_create_task',
        true, null, v_task.id, v_arg_keys, p_request_id
    );

    return jsonb_build_object('ok', true, 'created', true, 'task', public.mcp_task_json(v_task.id));
end;
$$;

revoke execute on function public.mcp_create_task(
    uuid, uuid, text, text, text, text, date, time, integer, uuid
) from public, anon, authenticated;
grant execute on function public.mcp_create_task(
    uuid, uuid, text, text, text, text, date, time, integer, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Handler-level denials (a tool the token's scope does not allow, or an
-- unknown tool name)
-- ---------------------------------------------------------------------------

create or replace function public.mcp_log_event(
    p_user_id uuid,
    p_token_id uuid,
    p_request_id text,
    p_event text,
    p_tool text,
    p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_token public.mcp_tokens;
begin
    if p_event is distinct from 'denied' then
        raise exception 'MCP_INVALID_EVENT' using errcode = '22023';
    end if;

    v_token := public.mcp_require_token(p_user_id, p_token_id, null);

    perform public.mcp_write_audit(
        p_user_id, p_token_id, v_token.token_prefix, 'denied', p_tool,
        false, p_error_code, null, null, p_request_id
    );

    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.mcp_log_event(uuid, uuid, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.mcp_log_event(uuid, uuid, text, text, text, text)
    to service_role;
