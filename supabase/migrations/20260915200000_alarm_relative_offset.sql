-- アラームを「タスク開始時刻の何分前か」で保持できるようにする。
--
-- 背景: これまで alarms は絶対時刻（fire_at）しか持たず、タスクの開始時刻を
-- 後から動かしてもアラームが追従しなかった。Google カレンダーの通知と同様に
-- 相対指定を一次情報とし、fire_at は派生値として保つ。

alter table public.alarms
    add column if not exists offset_minutes integer;

-- 0 = 開始時刻ちょうど。上限は Google カレンダーの通知と同じ 4 週間。
alter table public.alarms
    drop constraint if exists alarms_offset_minutes_range;
alter table public.alarms
    add constraint alarms_offset_minutes_range
    check (offset_minutes is null or (offset_minutes >= 0 and offset_minutes <= 40320));

comment on column public.alarms.offset_minutes is
    'タスク開始時刻の何分前か（分）。NULL = 絶対時刻指定で fire_at をそのまま使う。';

-- タスクの開始時刻が変わったら、相対指定のアラームを追従させる。
--
-- tasks.date は date、tasks.scheduled_start は time で、どちらもタイムゾーンを
-- 持たない（クライアントのローカル時刻として解釈される）。そのため絶対時刻を
-- 再計算するとタイムゾーンを仮定することになり誤る。代わりに「変更前後の差分」
-- だけを fire_at へ加算する。同一のタイムゾーンで解釈した 2 値の差なので、
-- どのタイムゾーンで解釈しても差分は等しく、仮定を置かずに済む。
create or replace function public.shift_relative_alarms_on_task_reschedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    shift_amount interval;
begin
    -- 差分を出せない場合は何もしない（開始時刻が未設定 / 解除された等）
    if old.scheduled_start is null or new.scheduled_start is null then
        return new;
    end if;

    shift_amount := (new.date::timestamp + new.scheduled_start)
                  - (old.date::timestamp + old.scheduled_start);

    if shift_amount = interval '0' then
        return new;
    end if;

    update public.alarms
    set fire_at = fire_at + shift_amount,
        updated_at = timezone('utc', now())
    where task_id = new.id
      -- security definer で RLS を迂回するため、所有者一致も明示的に確認する
      and user_id = new.user_id
      and offset_minutes is not null;

    return new;
end;
$$;

comment on function public.shift_relative_alarms_on_task_reschedule() is
    'タスクの再スケジュール時に、相対指定アラーム（offset_minutes not null）の fire_at を同じ差分だけずらす。';

drop trigger if exists shift_relative_alarms_on_task_reschedule on public.tasks;
create trigger shift_relative_alarms_on_task_reschedule
    after update of date, scheduled_start on public.tasks
    for each row
    execute function public.shift_relative_alarms_on_task_reschedule();
