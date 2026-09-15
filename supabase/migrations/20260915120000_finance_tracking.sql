-- Optional task-linked money recording (JPY, per-user private).
--
-- Privacy model:
--   Finance rows are owned solely by finance_entries.user_id. Linking task_id to a
--   shared project task does NOT grant collaborators access. Each collaborator has
--   independent private finance data. Task deletion keeps history via
--   ON DELETE SET NULL plus immutable title/category snapshots.
--
-- Why these tables are NOT embedded on public.tasks:
--   tasks is a shared collaboration row. Money records must stay private even when
--   the linked task is visible to a project. Embedding would leak amounts through
--   task SELECT policies.
--
-- Feature preference vs paid entitlement:
--   finance_preferences.enabled is an explicit user setting (default off = no row).
--   It is not a billing/plan flag and must not be reused as a future paid gate.
--
-- Money semantics:
--   Currency is fixed JPY. amount_yen is bigint (never float/numeric). Values are
--   positive integers only. Date ranges used by summarize/list RPCs are half-open
--   [p_start, p_end).
--
-- Apply note:
--   Push this migration with `npx supabase db push` (or SQL editor, timestamp order)
--   after 20260714010036. Do not apply from app runtime.

create type public.finance_entry_type as enum ('expense', 'income');

create or replace function public.normalize_finance_category_label(p_label text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select lower(btrim(regexp_replace(normalize(p_label, nfkc), '\s+', ' ', 'g')));
$$;

revoke execute on function public.normalize_finance_category_label(text)
from public, anon, authenticated;

create table public.finance_preferences (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    enabled boolean not null default false,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.finance_categories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    label text not null,
    normalized_label text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint finance_categories_label_length_check
        check (char_length(label) between 1 and 80),
    constraint finance_categories_normalized_label_length_check
        check (char_length(normalized_label) between 1 and 80),
    constraint finance_categories_id_user_id_key
        unique (id, user_id),
    constraint finance_categories_user_normalized_label_key
        unique (user_id, normalized_label)
);

create table public.finance_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    -- Nullable so task deletion preserves history. Never cascade-delete money rows.
    task_id uuid references public.tasks (id) on delete set null,
    task_title_snapshot text not null,
    occurred_on date not null,
    entry_type public.finance_entry_type not null,
    -- Fixed JPY yen. Positive integer only; no fractional yen, no float.
    amount_yen bigint not null,
    category_id uuid not null,
    category_label_snapshot text not null,
    memo text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint finance_entries_amount_yen_positive_check
        check (amount_yen > 0 and amount_yen <= 1000000000000),
    constraint finance_entries_task_title_snapshot_length_check
        check (char_length(task_title_snapshot) between 1 and 500),
    constraint finance_entries_category_label_snapshot_length_check
        check (char_length(category_label_snapshot) between 1 and 80),
    constraint finance_entries_memo_length_check
        check (memo is null or char_length(memo) <= 500),
    -- Enforce that an entry cannot reference another user's category. Deferred
    -- NO ACTION lets profile deletion cascade entries and categories together.
    constraint finance_entries_category_owner_fkey
        foreign key (category_id, user_id)
        references public.finance_categories (id, user_id)
        on delete no action
        deferrable initially deferred
);

-- Range summaries and breakdowns filter (user_id, occurred_on) with [start, end).
-- INCLUDE covers the aggregate columns so summarize can index-only scan.
create index finance_entries_user_occurred_on_covering_idx
on public.finance_entries (user_id, occurred_on)
include (entry_type, amount_yen);

-- Replace-RPC delete/lock path: this user's rows for one task.
create index finance_entries_user_task_id_idx
on public.finance_entries (user_id, task_id);

-- FK indexes (Postgres does not create these automatically).
create index finance_entries_task_id_idx
on public.finance_entries (task_id);

create index finance_entries_category_id_idx
on public.finance_entries (category_id);

create trigger set_finance_preferences_updated_at
before update on public.finance_preferences
for each row execute function public.set_updated_at();

create trigger set_finance_categories_updated_at
before update on public.finance_categories
for each row execute function public.set_updated_at();

create trigger set_finance_entries_updated_at
before update on public.finance_entries
for each row execute function public.set_updated_at();

create or replace function public.sync_finance_category_normalized_label()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.normalized_label := public.normalize_finance_category_label(new.label);
    return new;
end;
$$;

revoke execute on function public.sync_finance_category_normalized_label()
from public, anon, authenticated;

create trigger sync_finance_category_normalized_label
before insert or update of label on public.finance_categories
for each row execute function public.sync_finance_category_normalized_label();

alter table public.finance_preferences enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_entries enable row level security;

-- Least privilege: authenticated can read their own rows. Category/entry writes
-- go through replace_task_finance_entries() only. Preferences are upserted by
-- the client (toggle) but cannot be deleted (off must preserve data).
create policy "users read own finance preferences"
on public.finance_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users insert own finance preferences"
on public.finance_preferences
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "users update own finance preferences"
on public.finance_preferences
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users read own finance categories"
on public.finance_categories
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users read own finance entries"
on public.finance_entries
for select
to authenticated
using (user_id = (select auth.uid()));

revoke insert, update, delete on public.finance_entries from authenticated;
revoke insert, update, delete on public.finance_categories from authenticated;
revoke delete on public.finance_preferences from authenticated;

grant select on public.finance_entries to authenticated;
grant select on public.finance_categories to authenticated;
grant select, insert, update on public.finance_preferences to authenticated;

-- Atomic replace of this caller's rows for one task.
-- Validates the full JSON payload before deleting. Concurrent replaces for the
-- same (user, task) are serialized with a transaction-scoped advisory lock.
-- Retries with the same payload converge to the same set of rows (last writer).
create or replace function public.replace_task_finance_entries(
    p_task_id uuid,
    p_entries jsonb,
    p_source_task_id uuid default null
)
returns setof public.finance_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := (select auth.uid());
    v_task_title text;
    v_occurred_on date;
    v_len integer;
    v_elem jsonb;
    v_idx integer;
    v_type text;
    v_label text;
    v_normalized text;
    v_amount_text text;
    v_amount bigint;
    v_memo text;
    v_target_lock bigint;
    v_source_lock bigint;
begin
    if caller_id is null then
        raise exception 'Unauthorized' using errcode = '28000';
    end if;

    if p_task_id is null then
        raise exception 'Task id is required' using errcode = '22004';
    end if;

    if p_entries is null or jsonb_typeof(p_entries) is distinct from 'array' then
        raise exception 'Finance payload must be a JSON array' using errcode = '22P02';
    end if;

    v_len := jsonb_array_length(p_entries);
    if v_len > 50 then
        raise exception 'Too many finance rows' using errcode = '22023';
    end if;

    -- Validate every element before taking locks or deleting existing rows.
    if v_len > 0 then
        for v_idx in 0 .. (v_len - 1) loop
            v_elem := p_entries -> v_idx;

            if jsonb_typeof(v_elem) is distinct from 'object' then
                raise exception 'Finance row % must be an object', v_idx using errcode = '22P02';
            end if;

            if jsonb_typeof(v_elem -> 'entry_type') is distinct from 'string' then
                raise exception 'Finance row % has invalid entry_type', v_idx using errcode = '22P02';
            end if;
            v_type := v_elem ->> 'entry_type';
            if v_type not in ('expense', 'income') then
                raise exception 'Finance row % has invalid entry_type', v_idx using errcode = '22P02';
            end if;

            if jsonb_typeof(v_elem -> 'category_label') is distinct from 'string' then
                raise exception 'Finance row % has invalid category_label', v_idx using errcode = '22P02';
            end if;
            v_label := btrim(coalesce(v_elem ->> 'category_label', ''));
            if char_length(v_label) = 0 or char_length(v_label) > 80 then
                raise exception 'Finance row % has invalid category_label', v_idx using errcode = '22P02';
            end if;

            v_normalized := public.normalize_finance_category_label(v_label);
            if v_normalized is null or v_normalized = '' or char_length(v_normalized) > 80 then
                raise exception 'Finance row % has invalid category_label', v_idx using errcode = '22P02';
            end if;

            if jsonb_typeof(v_elem -> 'amount_yen') is distinct from 'number' then
                raise exception 'Finance row % has invalid amount_yen', v_idx using errcode = '22P02';
            end if;

            -- Digits-only text BEFORE bigint: Postgres rounds jsonb numeric casts
            -- (20000.6::bigint => 20001). `->>` of a jsonb number is the canonical
            -- numeric text, so this rejects fractions, exponents, signs, and zero.
            v_amount_text := v_elem ->> 'amount_yen';
            if v_amount_text is null or v_amount_text !~ '^[1-9][0-9]*$' then
                raise exception 'Finance row % has invalid amount_yen', v_idx using errcode = '22P02';
            end if;

            if char_length(v_amount_text) > 13
               or (char_length(v_amount_text) = 13 and v_amount_text > '1000000000000') then
                raise exception 'Finance row % has invalid amount_yen', v_idx using errcode = '22003';
            end if;
            v_amount := v_amount_text::bigint;

            if v_elem ? 'memo'
               and jsonb_typeof(v_elem -> 'memo') not in ('string', 'null') then
                raise exception 'Finance row % has invalid memo', v_idx using errcode = '22P02';
            end if;
            v_memo := v_elem ->> 'memo';
            if v_memo is not null and char_length(v_memo) > 500 then
                raise exception 'Finance row % memo is too long', v_idx using errcode = '22P02';
            end if;
        end loop;
    end if;

    -- Serialize concurrent replaces for this caller + task. Lock is held only
    -- for the remaining statements in this function (short transaction).
    v_target_lock := hashtextextended(caller_id::text || ':' || p_task_id::text, 0);
    v_source_lock := case
        when p_source_task_id is null or p_source_task_id = p_task_id then v_target_lock
        else hashtextextended(caller_id::text || ':' || p_source_task_id::text, 0)
    end;
    perform pg_advisory_xact_lock(least(v_target_lock, v_source_lock));
    if v_source_lock <> v_target_lock then
        perform pg_advisory_xact_lock(greatest(v_target_lock, v_source_lock));
    end if;

    if not public.can_edit_task(p_task_id) then
        raise exception 'Task not found or not editable' using errcode = '42501';
    end if;

    select
        left(t.title, 500),
        coalesce(t.date, t.assigned_date)
    into v_task_title, v_occurred_on
    from public.tasks t
    where t.id = p_task_id;

    if v_task_title is null or btrim(v_task_title) = '' then
        raise exception 'Task not found or not editable' using errcode = '42501';
    end if;

    if v_occurred_on is null then
        raise exception 'Task has no exact date for finance entries' using errcode = '22004';
    end if;

    delete from public.finance_entries entry
    where entry.user_id = caller_id
      and entry.task_id = any (
          array_remove(array[p_task_id, p_source_task_id], null)
      );

    if v_len = 0 then
        return;
    end if;

    insert into public.finance_categories as category (user_id, label, normalized_label)
    select distinct on (public.normalize_finance_category_label(btrim(payload.value ->> 'category_label')))
        caller_id,
        btrim(payload.value ->> 'category_label'),
        public.normalize_finance_category_label(btrim(payload.value ->> 'category_label'))
    from jsonb_array_elements(p_entries) as payload(value)
    order by public.normalize_finance_category_label(btrim(payload.value ->> 'category_label'))
    on conflict (user_id, normalized_label)
    do update set updated_at = timezone('utc', now());

    return query
    insert into public.finance_entries (
        user_id,
        task_id,
        task_title_snapshot,
        occurred_on,
        entry_type,
        amount_yen,
        category_id,
        category_label_snapshot,
        memo
    )
    select
        caller_id,
        p_task_id,
        v_task_title,
        v_occurred_on,
        (payload.value ->> 'entry_type')::public.finance_entry_type,
        (payload.value ->> 'amount_yen')::bigint,
        category.id,
        category.label,
        nullif(btrim(coalesce(payload.value ->> 'memo', '')), '')
    from jsonb_array_elements(p_entries) with ordinality as payload(value, ordinality)
    join public.finance_categories as category
      on category.user_id = caller_id
     and category.normalized_label = public.normalize_finance_category_label(
         btrim(payload.value ->> 'category_label')
     )
    where (payload.value ->> 'amount_yen') ~ '^[1-9][0-9]*$'
    order by payload.ordinality
    returning *;
end;
$$;

revoke execute on function public.replace_task_finance_entries(uuid, jsonb, uuid)
from public, anon;

grant execute on function public.replace_task_finance_entries(uuid, jsonb, uuid)
to authenticated, service_role;

-- DB-side range aggregation. Callers must pass an explicit half-open [start, end).
-- Does not download row payloads; uses the covering (user_id, occurred_on) index.
create or replace function public.summarize_finance_range(
    p_start date,
    p_end date
)
returns table (
    -- Text preserves exact bigint values across JSON/JavaScript boundaries.
    expense_total text,
    income_total text,
    expense_count integer,
    income_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    caller_id uuid := (select auth.uid());
begin
    if caller_id is null then
        raise exception 'Unauthorized' using errcode = '28000';
    end if;

    if p_start is null or p_end is null or p_start >= p_end then
        raise exception 'Invalid half-open date range' using errcode = '22023';
    end if;

    return query
    select
        coalesce(sum(entry.amount_yen) filter (where entry.entry_type = 'expense'), 0)::text,
        coalesce(sum(entry.amount_yen) filter (where entry.entry_type = 'income'), 0)::text,
        count(*) filter (where entry.entry_type = 'expense')::integer,
        count(*) filter (where entry.entry_type = 'income')::integer
    from public.finance_entries as entry
    where entry.user_id = caller_id
      and entry.occurred_on >= p_start
      and entry.occurred_on < p_end;
end;
$$;

revoke execute on function public.summarize_finance_range(date, date)
from public, anon;

grant execute on function public.summarize_finance_range(date, date)
to authenticated, service_role;

-- Breakdown details. Loaded only when a summary modal opens — not on page load.
create or replace function public.list_finance_entries_in_range(
    p_start date,
    p_end date,
    p_offset integer default 0,
    p_limit integer default 1000
)
returns setof public.finance_entries
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    caller_id uuid := (select auth.uid());
begin
    if caller_id is null then
        raise exception 'Unauthorized' using errcode = '28000';
    end if;

    if p_start is null or p_end is null or p_start >= p_end then
        raise exception 'Invalid half-open date range' using errcode = '22023';
    end if;

    if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 1000 then
        raise exception 'Invalid finance page' using errcode = '22023';
    end if;

    return query
    select entry.*
    from public.finance_entries as entry
    where entry.user_id = caller_id
      and entry.occurred_on >= p_start
      and entry.occurred_on < p_end
    order by entry.occurred_on, entry.created_at, entry.id
    offset p_offset
    limit p_limit;
end;
$$;

revoke execute on function public.list_finance_entries_in_range(date, date, integer, integer)
from public, anon;

grant execute on function public.list_finance_entries_in_range(date, date, integer, integer)
to authenticated, service_role;

-- Apply-time assertions: fail the migration if the privacy/money invariants are missing.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'finance_entries'
          and column_name = 'task_id'
          and is_nullable = 'NO'
    ) then
        raise exception 'finance_entries.task_id must be nullable so task deletion preserves history';
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'finance_entries'
          and column_name = 'amount_yen'
          and data_type is distinct from 'bigint'
    ) then
        raise exception 'finance_entries.amount_yen must be bigint (fixed JPY, no float)';
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'finance_categories_user_normalized_label_key'
          and conrelid = 'public.finance_categories'::regclass
    ) then
        raise exception 'finance_categories must be unique per (user_id, normalized_label)';
    end if;

    if not exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and indexname = 'finance_entries_user_occurred_on_covering_idx'
    ) then
        raise exception 'covering index finance_entries_user_occurred_on_covering_idx is required';
    end if;

    if not exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'finance_entries'
          and c.relrowsecurity
    ) then
        raise exception 'RLS must be enabled on finance_entries';
    end if;
end $$;
