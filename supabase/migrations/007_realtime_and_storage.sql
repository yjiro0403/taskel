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
--      アップロード/削除が Bucket not found / RLS 拒否で全失敗していた。バケットは
--      private(public=false) で作成する。public バケットは /object/public/... で CDN 配信され
--      SELECT RLS が一切評価されず、個人利用アプリの私的な添付が URL 入手だけで無認証取得
--      可能になるため。描画はアプリ側で storage_path から短命の署名付き URL を都度生成する。
--      （private 化の冪等な保証・avatars バケットは 009 を参照）

-- ---- Realtime publication ----
-- 既存の supabase_realtime publication に対象テーブルを追加（存在しなければ Supabase が既定で作成済み）。
-- 【冪等化】`alter publication ... add table` は、対象が既に publication のメンバーだと
-- 「relation is already member of publication」を投げる。ホスト版ダッシュボードで Realtime を
-- トグル済みの場合や 007 の再適用時にこれが発火すると 007 全体がロールバックし、後続の
-- REPLICA IDENTITY・attachments バケット作成・Storage RLS まで一括で未適用になる。
-- そこで pg_publication_tables を検査し、未追加のテーブルのみ add する（再適用しても安全）。
do $$
declare
  target_table text;
  realtime_tables constant text[] := array[
    'tasks', 'projects', 'tags', 'sections', 'routines',
    'goals', 'notes', 'task_tags', 'project_members'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach target_table in array realtime_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end $$;

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

-- ---- Storage: attachments バケット（private）----
-- public=false。既存環境で既に別値で存在する場合に備え 009 で冪等に false へ収束させる。
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- ---- Storage RLS: 本人のフォルダ（users/{uid}/...）のみ読み書き可 ----
-- storage.ts のパス規約: users/${userId}/attachments/{fileId}_{fileName}
-- private バケットのため、この SELECT は署名付き URL 生成時に実際に評価される
-- （本人フォルダのみ＝共有プロジェクトの他メンバーは対象添付を署名できない。個人利用前提の方針）。
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
