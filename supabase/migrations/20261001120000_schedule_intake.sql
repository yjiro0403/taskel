-- Schedule intake: text or one image becomes a reviewable candidate,
-- then a Taskel task linked to a Google Calendar event this app created.
--
-- Images stay in a private bucket. Rows are readable only by the owner.
-- Grants are explicit because 010 granted privileges only on tables that
-- already existed.

create table public.schedule_intake_settings (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    auto_register boolean not null default false,
    retention_days integer not null default 30,
    calendar_id text not null default 'primary',
    default_duration_minutes integer,
    updated_at timestamptz not null default now(),
    constraint schedule_intake_settings_retention_check
        check (retention_days between 1 and 365),
    constraint schedule_intake_settings_duration_check
        check (
            default_duration_minutes is null
            or default_duration_minutes between 5 and 1440
        ),
    constraint schedule_intake_settings_calendar_check
        check (char_length(calendar_id) between 1 and 256)
);

create table public.schedule_intakes (
    id uuid primary key,
    user_id uuid not null references public.profiles (id) on delete cascade,
    source text not null,
    status text not null,
    content_hash text not null,
    raw_text text,
    image_path text,
    image_mime text,
    image_notes text,
    candidates jsonb not null default '[]'::jsonb,
    reasons jsonb not null default '[]'::jsonb,
    audit jsonb not null default '[]'::jsonb,
    error_code text,
    google_event_id text,
    google_event_link text,
    google_calendar_id text,
    task_id uuid references public.tasks (id) on delete set null,
    input_tokens integer,
    output_tokens integer,
    expires_at timestamptz not null,
    purged_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint schedule_intakes_source_check
        check (source in ('text', 'image_upload', 'image_share')),
    constraint schedule_intakes_status_check
        check (status in (
            'received',
            'extracting',
            'needs_review',
            'registering',
            'registered',
            'failed',
            'cancelled'
        ))
);

create index schedule_intakes_user_created_idx
    on public.schedule_intakes (user_id, created_at desc);

create unique index schedule_intakes_open_content_idx
    on public.schedule_intakes (user_id, content_hash)
    where status <> 'cancelled';

alter table public.schedule_intake_settings enable row level security;
alter table public.schedule_intakes enable row level security;

create policy "owners manage schedule intake settings"
    on public.schedule_intake_settings
    for all
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create policy "owners manage schedule intakes"
    on public.schedule_intakes
    for all
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

grant select, insert, update, delete
    on public.schedule_intake_settings, public.schedule_intakes
    to authenticated;

grant all privileges
    on public.schedule_intake_settings, public.schedule_intakes
    to service_role;

insert into storage.buckets (id, name, public)
values ('schedule-intakes', 'schedule-intakes', false)
on conflict (id) do update set public = false;

drop policy if exists "schedule intakes read own" on storage.objects;
create policy "schedule intakes read own"
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'schedule-intakes'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid())::text
    );

drop policy if exists "schedule intakes insert own" on storage.objects;
create policy "schedule intakes insert own"
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'schedule-intakes'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (storage.foldername(name))[3] = 'intakes'
    );

drop policy if exists "schedule intakes update own" on storage.objects;
create policy "schedule intakes update own"
    on storage.objects
    for update
    to authenticated
    using (
        bucket_id = 'schedule-intakes'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'schedule-intakes'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and (storage.foldername(name))[3] = 'intakes'
    );

drop policy if exists "schedule intakes delete own" on storage.objects;
create policy "schedule intakes delete own"
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'schedule-intakes'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid())::text
    );
