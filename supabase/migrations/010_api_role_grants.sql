-- 010_api_role_grants.sql
-- PostgREST が public schema を利用するための権限を明示的に付与する。
--
-- RLS policy だけではテーブル権限は付与されない。001〜009 は全テーブルで RLS を有効化
-- している一方、authenticated/service_role への GRANT が無かったため、REST/Supabase SDK
-- からの全アクセスが permission denied for table で失敗していた。
--
-- authenticated は通常の CRUD のみ許可し、実際の行アクセスは各テーブルの RLS で制限する。
-- service_role は API routes、Stripe webhook、移行スクリプトの管理処理に必要な全権限を持つ。
-- anon には schema の解決権限だけを付け、public table/function の実行権限は付与しない。

grant usage on schema public to anon, authenticated, service_role;

revoke all privileges
on all tables in schema public
from public, anon, authenticated;

grant select, insert, update, delete
on all tables in schema public
to authenticated;

grant all privileges
on all tables in schema public
to service_role;

revoke all privileges
on all sequences in schema public
from public, anon, authenticated;

grant usage, select
on all sequences in schema public
to authenticated;

grant all privileges
on all sequences in schema public
to service_role;

revoke execute
on all functions in schema public
from public, anon, authenticated;

grant execute
on all functions in schema public
to authenticated, service_role;

-- 今後 migration で追加される table/sequence/function にも同じ原則を適用する。
alter default privileges for role postgres in schema public
revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
grant select, insert, update, delete on tables to authenticated;

alter default privileges for role postgres in schema public
grant all privileges on tables to service_role;

alter default privileges for role postgres in schema public
revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
grant usage, select on sequences to authenticated;

alter default privileges for role postgres in schema public
grant all privileges on sequences to service_role;

alter default privileges for role postgres in schema public
revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
grant execute on functions to authenticated, service_role;
