-- =============================================================================
-- NestHire upgrade 3/5 — field-level task rules (BEFORE triggers)
--
-- Direct writes from the API (role "authenticated") are checked field by
-- field. The workflow functions of migration 4/5 (submit, review, complete)
-- are SECURITY DEFINER: they authorize the caller themselves and their
-- statements reach these triggers as the function owner, which is how the
-- triggers tell the two paths apart (current_user).
--
-- Who may change what (direct API writes):
--   content (title, description, instructions, expected output, completion
--   criteria, priority) ............ tasks.edit, or tasks.edit_own on own tasks
--   planning & schedule (month, week, start, duration, due date)
--   ................................. tasks.edit only (members never)
--   assignee ........................ tasks.assign
--   progress / work notes ........... the responsible member
--                                     (tasks.edit_assigned) or tasks.edit
--   status .......................... see private.task_transition_allowed()
--   task ID, team, visibility, actual/submission/approval/completion
--   timestamps ...................... never (server-controlled)
-- =============================================================================

-- True for statements issued directly by an API user (not by a trusted
-- SECURITY DEFINER workflow function, a migration or a service script).
create or replace function private.is_direct_api_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon') and not private.is_system_context();
$$;

-- Server-side schedule calculation, shared by every write path.
create or replace function private.apply_task_schedule(p_task public.tasks)
returns public.tasks
language plpgsql
stable
set search_path = ''
as $$
declare
  v_task public.tasks := p_task;
begin
  if v_task.planned_duration is null then
    v_task.planned_duration_minutes := null;
  else
    v_task.planned_duration_minutes := round(
      v_task.planned_duration * case v_task.duration_unit
        when 'hours' then 60
        when 'days' then 1440
        when 'weeks' then 10080
      end
    )::integer;
  end if;

  if not v_task.due_at_overridden then
    if v_task.planned_start_at is not null and v_task.planned_duration_minutes is not null then
      v_task.due_at := v_task.planned_start_at + make_interval(mins => v_task.planned_duration_minutes);
    elsif v_task.due_at is not null then
      -- A deadline without start + duration is an explicit deadline.
      v_task.due_at_overridden := true;
    end if;
  elsif v_task.due_at is null then
    v_task.due_at_overridden := false;
    if v_task.planned_start_at is not null and v_task.planned_duration_minutes is not null then
      v_task.due_at := v_task.planned_start_at + make_interval(mins => v_task.planned_duration_minutes);
    end if;
  end if;

  -- NOT_STARTED <-> SCHEDULED follows whether a start is planned.
  if v_task.status = 'not_started' and v_task.planned_start_at is not null then
    v_task.status := 'scheduled';
  elsif v_task.status = 'scheduled' and v_task.planned_start_at is null then
    v_task.status := 'not_started';
  end if;

  return v_task;
end;
$$;

-- Keeps the responsible roster entry and the assignee consistent:
--   * a changed responsible entry decides the assignee (its account when it is
--     an active project member, otherwise none until the account is linked);
--   * otherwise a changed assignee decides the responsible entry (their roster
--     entry in the task's team, if any).
-- SECURITY DEFINER: reads the roster independently of the caller's policies.
create or replace function private.apply_task_responsible(p_task public.tasks, p_old public.tasks)
returns public.tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks := p_task;
  v_member public.team_members;
  v_insert boolean := p_old is null;
begin
  if v_task.responsible_member_id is not null
     and (v_insert or v_task.responsible_member_id is distinct from p_old.responsible_member_id) then
    select * into v_member from public.team_members tm where tm.id = v_task.responsible_member_id;
    if not found or v_member.team_id is distinct from v_task.team_id then
      raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
    end if;
    v_task.assigned_to := case
      when v_member.user_id is not null and private.is_active_member(v_task.project_id, v_member.user_id)
        then v_member.user_id
    end;
  elsif v_insert or v_task.assigned_to is distinct from p_old.assigned_to then
    if v_task.assigned_to is null then
      if not v_insert then
        v_task.responsible_member_id := null;
      end if;
    else
      select tm.id into v_task.responsible_member_id
      from public.team_members tm
      where tm.team_id = v_task.team_id and tm.user_id = v_task.assigned_to;
    end if;
  end if;
  return v_task;
end;
$$;

-- Member code used in a new task ID (responsible roster entry first).
create or replace function private.task_member_code(p_task public.tasks)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select tm.member_code from public.team_members tm where tm.id = p_task.responsible_member_id),
    private.team_member_code(p_task.team_id, p_task.assigned_to)
  );
$$;

-- Unfinished predecessors (bypasses RLS: the caller may not see them).
create or replace function private.task_has_open_dependencies(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_dependencies d
    join public.tasks p on p.id = d.depends_on_task_id
    where d.task_id = p_task_id
      and p.status not in ('approved', 'completed')
  );
$$;

-- Status changes allowed through direct API writes. SUBMITTED, UNDER_REVIEW,
-- REVISION_REQUIRED, APPROVED and COMPLETED are reachable only through the
-- workflow functions (versioned submission, review record, publication).
create or replace function private.task_transition_allowed(
  p_from public.task_status,
  p_to public.task_status,
  p_is_supervisor boolean,
  p_is_executor boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then true
    -- Start (or resume after a revision request); only a supervisor unblocks.
    when p_to = 'in_progress' then
      (p_from in ('not_started', 'scheduled', 'revision_required') and (p_is_supervisor or p_is_executor))
      or (p_from = 'blocked' and p_is_supervisor)
    when p_to = 'blocked' then
      p_from in ('not_started', 'scheduled', 'in_progress') and p_is_supervisor
    when p_to in ('not_started', 'scheduled') then
      p_from in ('blocked', 'cancelled', 'not_started', 'scheduled') and p_is_supervisor
    when p_to = 'cancelled' then
      p_from not in ('completed', 'cancelled') and p_is_supervisor
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- INSERT
-- -----------------------------------------------------------------------------
create or replace function private.tasks_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_supervisor boolean;
begin
  new.created_at := now();
  new.updated_at := now();
  -- The task follows the team of its project.
  new.team_id := (select p.team_id from public.projects p where p.id = new.project_id);

  -- Planning for a roster entry is an assignment decision.
  if private.is_direct_api_write() and new.responsible_member_id is not null
     and not private.has_permission(new.project_id, 'tasks.assign') then
    raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
  end if;
  new := private.apply_task_responsible(new, null);

  if private.is_direct_api_write() then
    if v_uid is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;

    if not private.has_permission(new.project_id, 'tasks.create') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;

    -- The creator is always the caller; it cannot be spoofed.
    new.created_by := v_uid;
    v_supervisor := private.has_permission(new.project_id, 'tasks.edit');

    if new.assigned_to is not null then
      -- Without tasks.assign a user may only assign a new task to themselves.
      if new.assigned_to <> v_uid and not private.has_permission(new.project_id, 'tasks.assign') then
        raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
      end if;
      if not private.is_active_member(new.project_id, new.assigned_to) then
        raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
      end if;
    end if;

    -- A new task starts in the plan; the workflow moves it forward.
    if new.status not in ('not_started', 'scheduled') then
      raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
    end if;

    -- Schedule and manual task IDs are supervisor decisions.
    if not v_supervisor and (
         new.planned_start_at is not null or new.planned_duration is not null or new.due_at is not null
         or new.planning_week is not null or new.planning_month <> 1
         or nullif(btrim(coalesce(new.task_code, '')), '') is not null
       ) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    -- Server-controlled fields.
    new.visibility := 'private';
    new.published_at := null;
    new.actual_start_at := null;
    new.submitted_at := null;
    new.approved_at := null;
    new.progress := 0;
    new.work_notes := '';
  end if;

  new.task_code := nullif(upper(btrim(coalesce(new.task_code, ''))), '');
  if new.task_code is null then
    new.task_code := private.next_task_code_for(private.task_member_code(new), new.planning_month, new.planning_week);
  end if;

  new := private.apply_task_schedule(new);
  new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) else null end;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- UPDATE
-- -----------------------------------------------------------------------------
create or replace function private.tasks_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_supervisor boolean;
  v_content boolean;
  v_executor boolean;
begin
  new.updated_at := now();

  if private.is_direct_api_write() and pg_trigger_depth() <= 1 then
    if v_uid is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;

    -- Identity and server-controlled fields never change through the API.
    if new.id is distinct from old.id
       or new.project_id is distinct from old.project_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.task_code is distinct from old.task_code
       or new.team_id is distinct from old.team_id
       or new.visibility is distinct from old.visibility
       or new.published_at is distinct from old.published_at
       or new.actual_start_at is distinct from old.actual_start_at
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
    end if;

    v_supervisor := private.has_permission(old.project_id, 'tasks.edit');
    v_content := v_supervisor
      or (old.created_by = v_uid and private.has_permission(old.project_id, 'tasks.edit_own'));
    v_executor := old.assigned_to = v_uid and private.has_permission(old.project_id, 'tasks.edit_assigned');

    -- A completed (published) task is a closed record.
    if old.status = 'completed' then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if (new.title, new.description, new.original_instructions, new.expected_output, new.completion_criteria, new.priority)
         is distinct from
       (old.title, old.description, old.original_instructions, old.expected_output, old.completion_criteria, old.priority)
       and not v_content then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    -- Members can never change the plan or the schedule of their tasks.
    if (new.planning_month, new.planning_week, new.planned_start_at, new.planned_duration, new.duration_unit,
        new.due_at, new.due_at_overridden)
         is distinct from
       (old.planning_month, old.planning_week, old.planned_start_at, old.planned_duration, old.duration_unit,
        old.due_at, old.due_at_overridden)
       and not v_supervisor then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if (new.progress, new.work_notes) is distinct from (old.progress, old.work_notes)
       and not (v_executor or v_supervisor) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if new.assigned_to is distinct from old.assigned_to
       or new.responsible_member_id is distinct from old.responsible_member_id then
      if not private.has_permission(old.project_id, 'tasks.assign') then
        raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
      end if;
      if new.assigned_to is not null and not private.is_active_member(old.project_id, new.assigned_to) then
        raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
      end if;
    end if;

    if new.status is distinct from old.status then
      if not private.task_transition_allowed(old.status, new.status, v_supervisor, v_executor) then
        raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
      end if;
      if new.status = 'in_progress' and private.task_has_open_dependencies(old.id) then
        raise exception using errcode = '42501', message = 'TASK_BLOCKED';
      end if;
    end if;
  end if;

  new := private.apply_task_responsible(new, old);

  -- Actual start: recorded by the server the first time work starts.
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' and new.actual_start_at is null then
    new.actual_start_at := now();
  end if;

  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) else null end;
  end if;

  new := private.apply_task_schedule(new);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Dependencies
-- -----------------------------------------------------------------------------
create or replace function private.task_dependencies_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();

  if not private.is_system_context() then
    if auth.uid() is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;
    if not private.has_permission(new.project_id, 'tasks.edit') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
    new.created_by := auth.uid();
  end if;

  -- Reject cycles: the predecessor must not (transitively) depend on the task.
  if exists (
    with recursive chain (id) as (
      select d.depends_on_task_id from public.task_dependencies d where d.task_id = new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception using errcode = '22023', message = 'DEPENDENCY_CYCLE';
  end if;

  return new;
end;
$$;

create trigger task_dependencies_before_insert
  before insert on public.task_dependencies
  for each row execute function private.task_dependencies_before_insert();

-- -----------------------------------------------------------------------------
-- Computed fields (PostgREST: select=*,schedule_status,is_blocked)
-- -----------------------------------------------------------------------------

-- Not Started / Scheduled / Active / Due Soon (< 24 h) / Overdue / Completed,
-- plus "unscheduled" (no start and no deadline) and "cancelled".
-- Always evaluated with the database clock.
create or replace function public.schedule_status(p_task public.tasks)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_task.status in ('approved', 'completed') then 'completed'
    when p_task.status = 'cancelled' then 'cancelled'
    when p_task.status in ('submitted', 'under_review') then 'active'
    when p_task.due_at is not null and p_task.due_at < now() then 'overdue'
    when p_task.due_at is not null and p_task.due_at < now() + interval '24 hours' then 'due_soon'
    when p_task.status in ('in_progress', 'revision_required') or p_task.actual_start_at is not null then 'active'
    when p_task.planned_start_at is null and p_task.due_at is null then 'unscheduled'
    when p_task.planned_start_at is not null and p_task.planned_start_at > now() then 'scheduled'
    else 'not_started'
  end;
$$;

create or replace function public.is_blocked(p_task public.tasks)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_task.status = 'blocked'
      or (
        p_task.status in ('not_started', 'scheduled')
        and private.task_has_open_dependencies(p_task.id)
      );
$$;
