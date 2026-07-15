-- 009_storage_privacy_and_avatars.sql
-- Storage の機密性強化（attachments の private 化を冪等に保証）と avatars バケットの新規作成。
--
-- 背景:
--  (1) 007 は当初 attachments バケットを public=true で作成していた。public バケットは
--      /object/public/... で CDN 配信され、storage.objects の SELECT RLS が一切評価されない。
--      個人利用アプリの私的な添付（画像・書類）が、URL を入手した第三者に無認証で取得可能に
--      なるため private (public=false) へ変更する。描画はアプリ側で storage_path から都度生成する
--      短命の署名付き URL に移行する。007 を新規適用する環境では 007 側で既に false になるが、
--      旧 007（public=true）が既に適用済みの環境でも確実に false へ収束させるため、ここで冪等に
--      update する（このファイル単体でも安全に再適用可能）。
--  (2) settings/account/page.tsx は 'avatars' バケットへアップロードするが、どの migration も
--      作成しておらず、storage.objects のポリシーも 'attachments' 用しか無い。このため avatars
--      は「Bucket not found」、仮にバケットがあっても INSERT が RLS で拒否されていた。
--      avatars は public=true で作成する（他ユーザーのアバターを一覧表示する仕様のため。
--      詳細は下記(2)のコメント参照）。書き込みのみ本人フォルダに限定する。
--
-- パス規約（実コードで確認済み）:
--   attachments: users/{uid}/attachments/{fileId}_{fileName}   (src/lib/storage.ts)
--   avatars:     {uid}/profile_{timestamp}.{ext}               (src/app/[locale]/settings/account/page.tsx)

-- ---- (1) attachments を private 化（冪等）----
-- 旧 007 で public=true のまま適用済みでも、ここで確実に false へ収束させる。
update storage.buckets
set public = false
where id = 'attachments'
  and public is distinct from false;

-- ---- (2) avatars バケットを public で作成（冪等）----
-- attachments と異なり avatars は **public=true** とする。理由:
--   アプリは profiles.avatar_url を <img src={...}> でそのまま描画し、しかも
--   ProjectMembers / ProjectInviteModal は「他ユーザーのアバター」を表示する。
--   private にすると、ユーザーAはユーザーBのアバターに対して署名付きURLを生成できず
--   （本人フォルダのみ SELECT 可のため）メンバー一覧のアバター表示が全崩壊する。
--   アバターは機微性が低く、チーム内で相互に表示するのが仕様であるため public が妥当。
--   一方 attachments は私的な書類・画像を含むため private のままとする（上記(1)）。
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- ---- (2) avatars の Storage RLS ----
-- avatars のパスは先頭フォルダが uid（例: {uid}/profile_1699999999.png）。
-- 読み取り: public バケットのため /object/public/... 経路では RLS は評価されないが、
--   認証API経由（list/download/署名）でも読めるよう authenticated に開放しておく。
-- 書き込み(INSERT/UPDATE/DELETE): 本人フォルダ（{uid}/...）のみに限定し、
--   他人のアバターを上書き・削除できないようにする。
drop policy if exists "avatars read own" on storage.objects;
drop policy if exists "avatars read authenticated" on storage.objects;
create policy "avatars read authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
