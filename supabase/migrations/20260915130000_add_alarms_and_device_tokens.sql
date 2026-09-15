-- 20260915000000_add_alarms_and_device_tokens.sql
-- 目覚まし型アラーム機能 Phase A（Web + DB）。
--
--  (1) alarms: ユーザーごとのアラーム設定。task_id は null 可（タスクに紐付かない
--      単発アラーム）。設定は Supabase を単一の情報源とし、後続フェーズで
--      Capacitor アプリが同期して端末の AlarmManager に登録する。
--      status: scheduled（予約中）/ fired（発火済み）/ dismissed（解除・OFF）。
--  (2) device_tokens: プッシュ通知（FCM）用の端末トークン。Phase A では書き込み
--      API のみ用意し、UI は持たない（後続フェーズのアプリ登録用）。
--
-- 権限: 010_api_role_grants.sql の default privileges により、新規テーブルにも
-- authenticated への CRUD / service_role への全権限が自動付与される（明示 GRANT 不要）。
-- 行アクセスは下記 RLS で本人のみに制限する。

create table public.alarms (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    task_id uuid references public.tasks (id) on delete cascade,
    label text,
    fire_at timestamptz not null,
    snooze_minutes int not null default 5,
    status text not null default 'scheduled' check (status in ('scheduled', 'fired', 'dismissed')),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table public.device_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    fcm_token text not null unique,
    device_name text,
    updated_at timestamptz not null default timezone('utc', now())
);

-- 「自分の今後のアラーム」取得（user_id 絞り込み + fire_at 範囲/並び替え）用。
create index alarms_user_id_fire_at_idx on public.alarms (user_id, fire_at);
create index alarms_task_id_idx on public.alarms (task_id);
create index device_tokens_user_id_idx on public.device_tokens (user_id);

create trigger set_alarms_updated_at
before update on public.alarms
for each row execute function public.set_updated_at();

create trigger set_device_tokens_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

alter table public.alarms enable row level security;
alter table public.device_tokens enable row level security;

-- 20260714 と同様、auth.uid() は (select auth.uid()) で statement ごとに 1 回だけ評価する。
create policy "owners manage their alarms"
on public.alarms
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "owners manage their device tokens"
on public.device_tokens
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ---- Realtime ----
-- 後続フェーズで Capacitor アプリがアラーム変更を購読して端末へ同期するため、
-- alarms のみ publication へ追加する（007/011 と同じ冪等ガード）。
-- device_tokens は書き込み専用のため realtime 不要。
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alarms'
  ) then
    alter publication supabase_realtime add table public.alarms;
  end if;
end $$;

alter table public.alarms replica identity full;
