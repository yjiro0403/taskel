-- Keep routine placement consistent with the same time ranges used by the UI.
-- Explicit section end times can create gaps; routines in those gaps are left
-- unchanged because interval-* sections are display-only and have no DB row.
with section_ranges as (
    select
        section.id,
        section.user_id,
        section.start_time,
        coalesce(
            section.end_time,
            lead(section.start_time) over (
                partition by section.user_id
                order by section.start_time, section."order", section.id
            )
        ) as effective_end
    from public.sections section
    where section.start_time is not null
), matched_routines as (
    select
        routine.id as routine_id,
        section_range.id as section_id
    from public.routines routine
    join section_ranges section_range
      on section_range.user_id = routine.user_id
     and routine.start_time >= section_range.start_time
     and (
         section_range.effective_end is null
         or routine.start_time < section_range.effective_end
     )
    where routine.start_time is not null
)
update public.routines routine
set section_id = matched.section_id
from matched_routines matched
where routine.id = matched.routine_id
  and routine.section_id is distinct from matched.section_id;

-- Match the initial-load filter/order path and index routine relationships used
-- for occurrence checks and section reassignment.
create index if not exists tasks_user_id_date_order_id_idx
on public.tasks (user_id, date, "order", id);

create index if not exists tasks_routine_id_idx
on public.tasks (routine_id);

create index if not exists routines_section_id_idx
on public.routines (section_id);

-- Cache auth.uid() once per statement instead of re-evaluating it for every row.
-- The predicates otherwise remain identical to the existing access model.
drop policy if exists "owners manage their sections" on public.sections;
create policy "owners manage their sections"
on public.sections
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "owners manage their routines" on public.routines;
create policy "owners manage their routines"
on public.routines
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "owners and project members can read tasks" on public.tasks;
create policy "owners and project members can read tasks"
on public.tasks
for select
to authenticated
using (
    user_id = (select auth.uid())
    or (
        project_id is not null
        and public.can_access_project(project_id)
    )
);
