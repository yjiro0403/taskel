-- Deleting a section requires moving every referencing row out of it first:
-- tasks.section_id and routines.section_id are both `on delete restrict`
-- (001_initial_schema.sql), so the DELETE fails while a single reference remains.
--
-- The client used to do this as three separate PostgREST requests
-- (update tasks -> update routines -> delete section). When the DELETE failed
-- after the updates had committed, the tasks were permanently reassigned - or
-- dumped into the backlog with section_id = null - while the UI reported
-- "deletion failed", implying nothing had happened. Run the whole thing in one
-- transaction instead, so it either fully happens or not at all.
--
-- reassign_to_section_id = null means "tasks go to the backlog" (section_id null,
-- allowed since 006). Routines must keep a section (the app needs one to place the
-- generated virtual task), so deleting a section that still has routines without a
-- target is rejected rather than silently nulling them out.
--
-- security definer + explicit auth.uid() ownership checks: the function bypasses
-- RLS, so every table it touches is scoped to the caller by hand.

create or replace function public.delete_section_with_reassign(
    target_section_id uuid,
    reassign_to_section_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    routine_count integer;
    deleted_rows integer;
begin
    if caller_id is null then
        raise exception 'Unauthorized';
    end if;

    if target_section_id is null then
        raise exception using errcode = '22004', message = 'Section id is required';
    end if;

    if reassign_to_section_id = target_section_id then
        raise exception using errcode = '22023',
            message = 'Cannot reassign rows to the section being deleted';
    end if;

    if not exists (
        select 1
        from public.sections section
        where section.id = target_section_id
          and section.user_id = caller_id
    ) then
        raise exception using errcode = '42501',
            message = 'Section not found or not owned by the caller';
    end if;

    if reassign_to_section_id is not null and not exists (
        select 1
        from public.sections section
        where section.id = reassign_to_section_id
          and section.user_id = caller_id
    ) then
        raise exception using errcode = '42501',
            message = 'Reassign target section not found or not owned by the caller';
    end if;

    select count(*) into routine_count
    from public.routines routine
    where routine.section_id = target_section_id
      and routine.user_id = caller_id;

    if routine_count > 0 and reassign_to_section_id is null then
        raise exception using errcode = '23514',
            message = 'Routines reference this section; a target section is required';
    end if;

    update public.tasks task
    set section_id = reassign_to_section_id
    where task.section_id = target_section_id
      and task.user_id = caller_id;

    update public.routines routine
    set section_id = reassign_to_section_id
    where routine.section_id = target_section_id
      and routine.user_id = caller_id;

    delete from public.sections section
    where section.id = target_section_id
      and section.user_id = caller_id;

    get diagnostics deleted_rows = row_count;

    if deleted_rows = 0 then
        raise exception using errcode = '42501',
            message = 'Section not found or not owned by the caller';
    end if;

    return deleted_rows;
end;
$$;

revoke execute on function public.delete_section_with_reassign(uuid, uuid)
from public, anon;

grant execute on function public.delete_section_with_reassign(uuid, uuid)
to authenticated;
