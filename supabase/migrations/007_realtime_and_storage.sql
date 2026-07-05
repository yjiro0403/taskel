-- 007_realtime_and_storage.sql
-- Realtime配信とStorage（添付バケット/ポリシー）のセットアップ。
--
-- 背景:
--  (1) ホスト版Supabaseでは publication `supabase_realtime` にテーブルを追加しない限り
--      postgres_changes は一切配信されない。authSlice の購読(tasks/projects/tags/sections/
--      routines/goals/notes/task_tags/project_members)が全て無反応になっていた。
--  (2) REPLICA IDENTITY がデフォルト（主キーのみ）だと、user_id フィルタ購読や DELETE の
--      old 行に必要な列が載らず、DELETE/フィルタ購読が機能しない。→ FULL を付与。
--  (3) 添付用の 'attachments' バケットと storage.objects の RLS がどの migration にも無く、
--      アップロード/削除が Bucket not found / RLS 拒否で全失敗していた。

-- ---- Realtime publication ----
-- 既存の supabase_realtime publication に対象テーブルを追加（存在しなければ Supabase が既定で作成済み）
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.tags;
alter publication supabase_realtime add table public.sections;
alter publication supabase_realtime add table public.routines;
alter publication supabase_realtime add table public.goals;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.task_tags;
alter publication supabase_realtime add table public.project_members;

-- ---- REPLICA IDENTITY FULL（DELETE/フィルタ購読の old 行に全列を載せる）----
alter table public.tasks replica identity full;
alter table public.projects replica identity full;
alter table public.tags replica identity full;
alter table public.sections replica identity full;
alter table public.routines replica identity full;
alter table public.goals replica identity full;
alter table public.notes replica identity full;
alter table public.task_tags replica identity full;
alter table public.project_members replica identity full;

-- ---- Storage: attachments バケット ----
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- ---- Storage RLS: 本人のフォルダ（users/{uid}/...）のみ読み書き可 ----
-- storage.ts のパス規約: users/${userId}/attachments/{fileId}_{fileName}
drop policy if exists "attachments read own" on storage.objects;
create policy "attachments read own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "attachments insert own" on storage.objects;
create policy "attachments insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "attachments update own" on storage.objects;
create policy "attachments update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "attachments delete own" on storage.objects;
create policy "attachments delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
