-- 006_nullable_task_placement.sql
-- 日付なしタスク（週/月/年ゴール・バックログ）を保存可能にする。
--
-- 背景: アプリは「ゴール/バックログ」を tasks 行として扱い、日付なし = date:''(空文字)、
-- セクションなし = sectionId:'goal'(センチネル文字列) で表現する。しかし tasks.date は
-- DATE NOT NULL、tasks.section_id は uuid NOT NULL FK だったため、これらの行が INSERT/UPDATE
-- できず（invalid input syntax / not-null violation）、ゴール・バックログの作成/編集/移行が
-- 全滅していた。ここでは date と section_id を nullable 化し、アプリ層で空文字/センチネルを
-- NULL に正規化する（mapper で NULL→'' / '' 相当へ戻す双方向変換とセットで運用）。

alter table public.tasks alter column date drop not null;
alter table public.tasks alter column section_id drop not null;
