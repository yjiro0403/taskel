create extension if not exists pgcrypto;

create type public.project_status as enum ('active', 'completed', 'archived');
create type public.hub_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.task_status as enum ('open', 'in_progress', 'done', 'skipped');
create type public.task_author_type as enum ('user', 'ai');
create type public.goal_type as enum ('yearly', 'monthly', 'weekly');
create type public.goal_status as enum ('pending', 'in_progress', 'achieved', 'missed', 'cancelled');
create type public.routine_frequency as enum ('daily', 'weekly', 'monthly', 'custom');
create type public.invitation_status as enum ('pending', 'accepted', 'expired');
create type public.subscription_plan as enum ('free', 'pro', 'business');
create type public.subscription_status as enum ('active', 'past_due', 'canceled', 'none');
create type public.note_type as enum ('daily', 'weekly', 'monthly', 'yearly');
create type public.attachment_file_type as enum ('image', 'file');
create type public.task_ai_status as enum ('pending', 'processing', 'completed', 'error');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    email text not null unique,
    avatar_url text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles (id) on delete cascade,
    title text not null,
    description text not null default '',
    status public.project_status not null default 'active',
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.project_members (
    project_id uuid not null references public.projects (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role public.hub_role not null default 'member',
    created_at timestamptz not null default timezone('utc', now()),
    primary key (project_id, user_id)
);

create table public.tags (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    name text not null,
    memo text,
    color text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (user_id, name)
);

create table public.goals (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    type public.goal_type not null,
    title text not null,
    description text,
    assigned_year text not null,
    assigned_month text,
    assigned_week text,
    status public.goal_status not null default 'pending',
    progress integer not null default 0 check (progress between 0 and 100),
    parent_goal_id uuid references public.goals (id) on delete set null,
    project_id uuid references public.projects (id) on delete set null,
    priority smallint not null check (priority between 1 and 5),
    tags text[] not null default '{}',
    reflection text,
    ai_analysis jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint goals_period_scope_check check (
        (type = 'yearly' and assigned_month is null and assigned_week is null)
        or (type = 'monthly' and assigned_month is not null and assigned_week is null)
        or (type = 'weekly' and assigned_month is not null and assigned_week is not null)
    )
);

create table public.sections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    name text not null,
    start_time time,
    end_time time,
    "order" integer not null default 0,
    unique (user_id, name)
);

create table public.routines (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    title text not null,
    frequency public.routine_frequency not null,
    days_of_week smallint[],
    interval integer check (interval is null or interval > 0),
    start_date date not null,
    next_run date not null,
    start_time time,
    section_id uuid not null references public.sections (id) on delete restrict,
    estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
    active boolean not null default true,
    project_id uuid references public.projects (id) on delete set null,
    tags text[] not null default '{}',
    memo text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    title text not null,
    assignee_id uuid references public.profiles (id) on delete set null,
    reporter_id uuid references public.profiles (id) on delete set null,
    section_id uuid not null references public.sections (id) on delete restrict,
    date date not null,
    status public.task_status not null default 'open',
    estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
    actual_minutes integer not null default 0 check (actual_minutes >= 0),
    started_at timestamptz,
    completed_at timestamptz,
    scheduled_start time,
    external_link text,
    parent_goal_id uuid references public.goals (id) on delete set null,
    project_id uuid references public.projects (id) on delete set null,
    milestone_id text,
    routine_id uuid references public.routines (id) on delete set null,
    assigned_week text,
    assigned_month text,
    assigned_year text,
    assigned_date date,
    score integer,
    "order" integer not null default 0,
    memo text,
    ai_tags text[] not null default '{}',
    ai_status public.task_ai_status,
    ai_error text,
    ai_completed_at timestamptz,
    comment_count integer not null default 0 check (comment_count >= 0),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.task_comments (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.tasks (id) on delete cascade,
    user_id uuid references public.profiles (id) on delete set null,
    author_type public.task_author_type not null,
    author_name text,
    content text not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.task_tags (
    task_id uuid not null references public.tasks (id) on delete cascade,
    tag_id uuid not null references public.tags (id) on delete cascade,
    primary key (task_id, tag_id)
);

create table public.invitations (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects (id) on delete cascade,
    email text,
    role public.hub_role not null,
    inviter_id uuid not null references public.profiles (id) on delete cascade,
    status public.invitation_status not null default 'pending',
    created_at timestamptz not null default timezone('utc', now()),
    expires_at timestamptz not null,
    is_reusable boolean not null default false
);

create table public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references public.profiles (id) on delete cascade,
    stripe_customer_id text,
    stripe_subscription_id text unique,
    plan public.subscription_plan not null default 'free',
    status public.subscription_status not null default 'none',
    current_period_end timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.usage_monthly (
    user_id uuid not null references public.profiles (id) on delete cascade,
    month date not null,
    ai_messages_count integer not null default 0 check (ai_messages_count >= 0),
    ai_messages_limit integer not null default 0 check (ai_messages_limit >= 0),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (user_id, month),
    constraint usage_monthly_month_start_check check (month = date_trunc('month', month)::date)
);

create table public.notes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    type public.note_type not null,
    period_key text not null,
    content text not null default '',
    updated_at timestamptz not null default timezone('utc', now()),
    unique (user_id, type, period_key)
);

create table public.attachments (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.tasks (id) on delete cascade,
    url text not null,
    storage_path text not null,
    name text not null,
    file_type public.attachment_file_type not null,
    size bigint,
    created_at timestamptz not null default timezone('utc', now())
);

create index projects_owner_id_idx on public.projects (owner_id);
create index project_members_user_id_idx on public.project_members (user_id);
create index tags_user_id_idx on public.tags (user_id);
create index goals_user_id_idx on public.goals (user_id);
create index goals_project_id_idx on public.goals (project_id);
create index sections_user_id_order_idx on public.sections (user_id, "order");
create index routines_user_id_idx on public.routines (user_id);
create index routines_project_id_idx on public.routines (project_id);
create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_section_id_date_idx on public.tasks (section_id, date);
create index task_comments_task_id_idx on public.task_comments (task_id, created_at);
create index invitations_project_id_idx on public.invitations (project_id);
create index invitations_email_idx on public.invitations (lower(email));
create index notes_user_id_type_period_key_idx on public.notes (user_id, type, period_key);
create index attachments_task_id_idx on public.attachments (task_id);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger set_tags_updated_at
before update on public.tags
for each row execute function public.set_updated_at();

create trigger set_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at();

create trigger set_routines_updated_at
before update on public.routines
for each row execute function public.set_updated_at();

create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create trigger set_task_comments_updated_at
before update on public.task_comments
for each row execute function public.set_updated_at();

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create or replace function public.can_access_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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
    );
$$;

create or replace function public.can_manage_project(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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
          and pm.role in ('owner', 'admin')
    );
$$;

create or replace function public.can_access_task(task_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.tasks t
        where t.id = task_uuid
          and (
              t.user_id = auth.uid()
              or (
                  t.project_id is not null
                  and public.can_access_project(t.project_id)
              )
          )
    );
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tags enable row level security;
alter table public.goals enable row level security;
alter table public.sections enable row level security;
alter table public.routines enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_tags enable row level security;
alter table public.invitations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_monthly enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

create policy "profiles are readable by authenticated users"
on public.profiles
for select
to authenticated
using (true);

create policy "users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "users can update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "members can read projects"
on public.projects
for select
to authenticated
using (public.can_access_project(id));

create policy "owners can create projects"
on public.projects
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "members can update projects"
on public.projects
for update
to authenticated
using (public.can_access_project(id))
with check (public.can_access_project(id));

create policy "owners and admins can delete projects"
on public.projects
for delete
to authenticated
using (public.can_manage_project(id));

create policy "members can read project memberships"
on public.project_members
for select
to authenticated
using (public.can_access_project(project_id));

create policy "owners can add themselves to new projects"
on public.project_members
for insert
to authenticated
with check (
    (
        user_id = auth.uid()
        and role = 'owner'
        and exists (
            select 1
            from public.projects p
            where p.id = project_id
              and p.owner_id = auth.uid()
        )
    )
    or public.can_manage_project(project_id)
);

create policy "owners and admins can update project memberships"
on public.project_members
for update
to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

create policy "owners and admins can delete project memberships"
on public.project_members
for delete
to authenticated
using (public.can_manage_project(project_id));

create policy "owners manage their tags"
on public.tags
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "owners manage their goals"
on public.goals
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "owners manage their sections"
on public.sections
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "owners manage their routines"
on public.routines
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "owners and project members can read tasks"
on public.tasks
for select
to authenticated
using (
    user_id = auth.uid()
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
);

create policy "owners and project members can create tasks"
on public.tasks
for insert
to authenticated
with check (
    user_id = auth.uid()
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
);

create policy "owners and project members can update tasks"
on public.tasks
for update
to authenticated
using (
    user_id = auth.uid()
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
)
with check (
    user_id = auth.uid()
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
);

create policy "owners and project members can delete tasks"
on public.tasks
for delete
to authenticated
using (
    user_id = auth.uid()
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
);

create policy "task viewers can read comments"
on public.task_comments
for select
to authenticated
using (public.can_access_task(task_id));

create policy "task viewers can create comments"
on public.task_comments
for insert
to authenticated
with check (
    public.can_access_task(task_id)
    and (
        user_id = auth.uid()
        or author_type = 'ai'
    )
);

create policy "comment authors can update comments"
on public.task_comments
for update
to authenticated
using (
    public.can_access_task(task_id)
    and user_id = auth.uid()
)
with check (
    public.can_access_task(task_id)
    and user_id = auth.uid()
);

create policy "comment authors can delete comments"
on public.task_comments
for delete
to authenticated
using (
    public.can_access_task(task_id)
    and user_id = auth.uid()
);

create policy "task viewers can read task tags"
on public.task_tags
for select
to authenticated
using (public.can_access_task(task_id));

create policy "task editors can write task tags"
on public.task_tags
for insert
to authenticated
with check (public.can_access_task(task_id));

create policy "task editors can delete task tags"
on public.task_tags
for delete
to authenticated
using (public.can_access_task(task_id));

create policy "related users can read invitations"
on public.invitations
for select
to authenticated
using (
    inviter_id = auth.uid()
    or public.can_access_project(project_id)
    or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "project owners and admins can create invitations"
on public.invitations
for insert
to authenticated
with check (
    inviter_id = auth.uid()
    and public.can_manage_project(project_id)
);

create policy "related users can update invitations"
on public.invitations
for update
to authenticated
using (
    inviter_id = auth.uid()
    or public.can_manage_project(project_id)
    or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
)
with check (
    inviter_id = auth.uid()
    or public.can_manage_project(project_id)
    or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "project owners and admins can delete invitations"
on public.invitations
for delete
to authenticated
using (public.can_manage_project(project_id));

create policy "owners can read subscriptions"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

create policy "owners can read monthly usage"
on public.usage_monthly
for select
to authenticated
using (user_id = auth.uid());

create policy "owners manage their notes"
on public.notes
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "task viewers can read attachments"
on public.attachments
for select
to authenticated
using (public.can_access_task(task_id));

create policy "task editors can manage attachments"
on public.attachments
for insert
to authenticated
with check (public.can_access_task(task_id));

create policy "task editors can update attachments"
on public.attachments
for update
to authenticated
using (public.can_access_task(task_id))
with check (public.can_access_task(task_id));

create policy "task editors can delete attachments"
on public.attachments
for delete
to authenticated
using (public.can_access_task(task_id));
