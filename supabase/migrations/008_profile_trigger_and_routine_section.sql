-- 008_profile_trigger_and_routine_section.sql
--
--  (1) auth.users への新規ユーザー作成時に profiles を自動生成するトリガ。
--      従来はクライアントの ensureProfile upsert 任せで、一時的な失敗（RLS/ネットワーク/
--      email UNIQUE 衝突）でプロフィール未作成→ログイン不安定になり得た。SECURITY DEFINER
--      のトリガでサーバー側生成に寄せ、クリティカルパスから外す（ensureProfile はフォールバック
--      として残す）。
--  (2) routines.section_id を nullable 化。参照先セクションが削除済みのルーチンを移行時に
--      skip して欠損させないため（tasks と同様の救済）。

-- ---- (1) profiles 自動生成トリガ ----
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- email が無い認証方式では profiles を作らない（NOT NULL 違反で auth.users 作成を
    -- 巻き込まないため）。その場合はクライアントの ensureProfile が後段で補う。
    if new.email is not null then
        insert into public.profiles (id, email, display_name, avatar_url)
        values (
            new.id,
            new.email,
            coalesce(
                new.raw_user_meta_data->>'display_name',
                new.raw_user_meta_data->>'full_name',
                new.raw_user_meta_data->>'name'
            ),
            new.raw_user_meta_data->>'avatar_url'
        )
        on conflict (id) do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---- (2) routines.section_id を nullable 化 ----
alter table public.routines alter column section_id drop not null;
