-- Split logged task time into the person's work and AI work.
--
-- ai_minutes is the closed portion of actual_minutes that belonged to AI.
-- It stays within actual_minutes. The open run is different: segment_ai_minutes
-- holds AI time already finished in the current timer, and stop folds it in
-- at the same moment actual_minutes grows. work_actor is who the next minutes
-- belong to. actor_since is when that open segment started.

alter table public.tasks
    add column ai_minutes integer not null default 0,
    add column segment_ai_minutes integer not null default 0,
    add column work_actor text not null default 'human',
    add column actor_since timestamptz;

alter table public.tasks
    add constraint tasks_ai_minutes_check check (ai_minutes >= 0),
    add constraint tasks_segment_ai_minutes_check check (segment_ai_minutes >= 0),
    add constraint tasks_work_actor_check check (work_actor in ('human', 'ai'));

comment on column public.tasks.ai_minutes is
    'Closed logged minutes attributed to AI. A finished run keeps this at or below actual_minutes.';

comment on column public.tasks.segment_ai_minutes is
    'AI minutes already finished in the current run. Folded into ai_minutes when the timer stops.';

comment on column public.tasks.work_actor is
    'Who the current or next timer segment belongs to: human or ai.';

comment on column public.tasks.actor_since is
    'When the current open segment started. Null while the timer is not running.';
