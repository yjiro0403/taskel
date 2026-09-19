-- Analytics expansion + timeline preferences.
--
-- 1. projects.expected_minutes
--    Shared planning estimate (not a private money budget). Null = unset.
--
-- 2. user_ui_preferences
--    Per-user display flags. timeline_enabled defaults OFF so the existing
--    section list stays the default. hide_empty_intervals defaults ON:
--    empty gap hours outside user sections are omitted from the day view.
--    Same preference model as finance_preferences: explicit toggle, not a
--    paid entitlement. OFF must not delete other user data.
--
-- 3. analytics_period_plans
--    Private per-user week/month/year plan: expected minutes, overall yen
--    budget, and a free-text reflection for later review.
--
-- 4. finance_category_budgets
--    Private per-user yen budget for one finance category in one period.
--    Category ownership is enforced with a composite FK (category_id, user_id).
--
-- Apply with `npx supabase db push` (or SQL editor, timestamp order) after
-- 20260915120000_finance_tracking.sql. Do not apply from app runtime.

alter table public.projects
    add column expected_minutes integer;

alter table public.projects
    add constraint projects_expected_minutes_check
    check (
        expected_minutes is null
        or (expected_minutes >= 0 and expected_minutes <= 10000000)
    );

comment on column public.projects.expected_minutes is
    'Shared expected duration in minutes for the whole project. Null means unset.';

create table public.user_ui_preferences (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    timeline_enabled boolean not null default false,
    hide_empty_intervals boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create type public.analytics_period_type as enum ('week', 'month', 'year');

create table public.analytics_period_plans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    period_type public.analytics_period_type not null,
    period_key text not null,
    expected_minutes integer,
    overall_budget_yen bigint,
    reflection text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint analytics_period_plans_period_key_format_check
        check (
            (period_type = 'week' and period_key ~ '^[0-9]{4}-W[0-9]{2}$')
            or (period_type = 'month' and period_key ~ '^[0-9]{4}-[0-9]{2}$')
            or (period_type = 'year' and period_key ~ '^[0-9]{4}$')
        ),
    constraint analytics_period_plans_expected_minutes_check
        check (
            expected_minutes is null
            or (expected_minutes >= 0 and expected_minutes <= 10000000)
        ),
    constraint analytics_period_plans_budget_check
        check (
            overall_budget_yen is null
            or (overall_budget_yen >= 0 and overall_budget_yen <= 1000000000000)
        ),
    constraint analytics_period_plans_reflection_check
        check (reflection is null or char_length(reflection) <= 5000),
    constraint analytics_period_plans_user_period_key
        unique (user_id, period_type, period_key)
);

create table public.finance_category_budgets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    period_type public.analytics_period_type not null,
    period_key text not null,
    category_id uuid not null,
    amount_yen bigint not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint finance_category_budgets_period_key_format_check
        check (
            (period_type = 'week' and period_key ~ '^[0-9]{4}-W[0-9]{2}$')
            or (period_type = 'month' and period_key ~ '^[0-9]{4}-[0-9]{2}$')
            or (period_type = 'year' and period_key ~ '^[0-9]{4}$')
        ),
    constraint finance_category_budgets_amount_check
        check (amount_yen >= 0 and amount_yen <= 1000000000000),
    constraint finance_category_budgets_user_period_category_key
        unique (user_id, period_type, period_key, category_id),
    constraint finance_category_budgets_category_owner_fkey
        foreign key (category_id, user_id)
        references public.finance_categories (id, user_id)
        on delete cascade
);

create index finance_category_budgets_user_period_idx
    on public.finance_category_budgets (user_id, period_type, period_key);

create trigger set_user_ui_preferences_updated_at
before update on public.user_ui_preferences
for each row execute function public.set_updated_at();

create trigger set_analytics_period_plans_updated_at
before update on public.analytics_period_plans
for each row execute function public.set_updated_at();

create trigger set_finance_category_budgets_updated_at
before update on public.finance_category_budgets
for each row execute function public.set_updated_at();

alter table public.user_ui_preferences enable row level security;
alter table public.analytics_period_plans enable row level security;
alter table public.finance_category_budgets enable row level security;

create policy "users read own ui preferences"
on public.user_ui_preferences
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users insert own ui preferences"
on public.user_ui_preferences
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "users update own ui preferences"
on public.user_ui_preferences
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users read own period plans"
on public.analytics_period_plans
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users insert own period plans"
on public.analytics_period_plans
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "users update own period plans"
on public.analytics_period_plans
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users delete own period plans"
on public.analytics_period_plans
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy "users read own category budgets"
on public.finance_category_budgets
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users insert own category budgets"
on public.finance_category_budgets
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "users update own category budgets"
on public.finance_category_budgets
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "users delete own category budgets"
on public.finance_category_budgets
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke delete on public.user_ui_preferences from authenticated;

grant select, insert, update on public.user_ui_preferences to authenticated;
grant select, insert, update, delete on public.analytics_period_plans to authenticated;
grant select, insert, update, delete on public.finance_category_budgets to authenticated;
grant usage on type public.analytics_period_type to authenticated;
