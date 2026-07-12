-- 011_task_checklist.sql
-- タスクの「持ち物リスト」機能。
--
--  (1) tasks.checklist: タスクごとの持ち物チェックリスト本体。
--      要素は { id: uuid文字列, name: text, checked: boolean } の配列。並び順は配列順。
--      tasks 行に持たせる（別テーブルにしない）理由:
--        - チェック ON/OFF・項目編集が既存の tasks 楽観的更新／ロールバック／
--          realtime 再取得（syncTask → fetchTaskById）にそのまま乗る
--        - 共有プロジェクトタスクの認可も既存の tasks RLS がそのまま適用される
--  (2) item_templates: 「毎回持っていくもの」のユーザー別テンプレート。
--      items は持ち物名 text の配列（チェック状態は持たない）。
--      タスクへは適用時にコピーされるため、テンプレ変更が過去タスクへ波及しない。

alter table public.tasks
    add column checklist jsonb not null default '[]'::jsonb;

create table public.item_templates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    name text not null,
    items jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index item_templates_user_id_idx on public.item_templates (user_id);

create trigger set_item_templates_updated_at
before update on public.item_templates
for each row execute function public.set_updated_at();

alter table public.item_templates enable row level security;

create policy "owners manage their item templates"
on public.item_templates
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---- Realtime ----
-- 他テーブルと同様に publication へ追加（007 と同じ冪等ガード。既メンバー時の
-- 「relation is already member of publication」で migration 全体がロールバック
-- するのを防ぐ）。user_id フィルタ購読と DELETE の old 行のため REPLICA IDENTITY FULL。
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'item_templates'
  ) then
    alter publication supabase_realtime add table public.item_templates;
  end if;
end $$;

alter table public.item_templates replica identity full;
