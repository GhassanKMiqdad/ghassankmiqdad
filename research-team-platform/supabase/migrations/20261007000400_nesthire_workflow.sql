-- =============================================================================
-- NestHire upgrade 4/5 — execution workflow and audit trail
--
--   submit_task          responsible member → SUBMITTED (new version each time)
--   start_task_review    reviewer           → UNDER_REVIEW
--   review_task          reviewer           → APPROVED | REVISION_REQUIRED
--                                             (+ review record, optional new deadline)
--   complete_task        reviewer           → COMPLETED, final submission marked
--                                             official, visibility TEAM, sanitized
--                                             publication for the team, notifications
--
-- "Reviewer" = tasks.review in the project (Directors hold it everywhere,
-- Team Leads in their team's projects). This historical migration retained an
-- audited Director self-review override; migration
-- 20261008000200_final_privacy_hardening removes it. Final rule: no user may
-- review, approve or publish their own work.
-- Every transition is written to the audit log by the tasks trigger with a
-- semantic action name (task.submitted, task.approved, …).
-- =============================================================================

-- Name of whoever is responsible for a task: the assignee's profile, or the
-- roster entry when the person has no account yet.
create or replace function private.responsible_name(p_assigned_to uuid, p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.profile_name(p_assigned_to),
    (select tm.display_name from public.team_members tm where tm.id = p_member_id)
  );
$$;

-- Can the current user see this task row? (Same rule as the tasks RLS policy.)
create or replace function private.can_see_task(p_project_id uuid, p_assigned_to uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_project_id, 'tasks.view')
      or (
        ((select auth.uid()) in (p_assigned_to, p_created_by))
        and private.has_permission(p_project_id, 'project.view')
      );
$$;

-- Loads and locks a task for a workflow step, hiding tasks the caller cannot see.
create or replace function private.lock_task_for_workflow(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id for update;
  if not found or not private.can_see_task(v_task.project_id, v_task.assigned_to, v_task.created_by) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  return v_task;
end;
$$;

create or replace function private.assert_task_reviewer(p_task public.tasks)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_task.project_id, 'tasks.review') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if p_task.assigned_to = auth.uid() and not private.is_director() then
    raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
  end if;
end;
$$;

-- Context for the audit entry written by the tasks trigger in the same statement.
create or replace function private.set_task_event_meta(p_meta jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('app.task_event_meta', coalesce(p_meta, '{}'::jsonb)::text, true);
$$;

-- People to notify when work is handed in: the task's creator and the
-- reviewers among the team leads of its team.
create or replace function private.task_supervisor_ids(p_task public.tasks)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id
  from (
    select p_task.created_by as user_id
    union
    select tm.user_id
    from public.team_members tm
    where tm.team_id = p_task.team_id
      and tm.role = 'team_lead'
      and tm.status = 'active'
      and tm.user_id is not null
  ) s
  where s.user_id is not null
    and private.member_has_permission(p_task.project_id, s.user_id, 'tasks.review');
$$;

-- -----------------------------------------------------------------------------
-- Submit / resubmit
-- -----------------------------------------------------------------------------
create or replace function public.submit_task(
  p_task_id uuid,
  p_summary text,
  p_deliverable_links text[] default '{}',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_version integer;
  v_id uuid;
  v_links text[];
  v_supervisor uuid;
begin
  if v_task.assigned_to is distinct from v_uid
     or not private.has_permission(v_task.project_id, 'tasks.edit_assigned') then
    raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
  end if;

  if v_task.status not in ('in_progress', 'revision_required') then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select coalesce(array_agg(btrim(l)), '{}'::text[]) into v_links
  from unnest(coalesce(p_deliverable_links, '{}'::text[])) as l
  where btrim(l) <> '';

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.task_submissions s where s.task_id = p_task_id;

  insert into public.task_submissions (task_id, project_id, version, summary, deliverable_links, notes, submitted_by)
  values (p_task_id, v_task.project_id, v_version, btrim(p_summary), v_links, coalesce(btrim(p_notes), ''), v_uid)
  returning id into v_id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_version, 'submission_id', v_id));
  update public.tasks
     set status = 'submitted',
         submitted_at = now(),
         actual_start_at = coalesce(actual_start_at, now())
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  for v_supervisor in select * from private.task_supervisor_ids(v_task) loop
    perform private.notify(
      v_supervisor, 'task_submitted', v_task.project_id, v_task.id,
      jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title, 'version', v_version)
    );
  end loop;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Review
-- -----------------------------------------------------------------------------
create or replace function public.start_task_review(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_submission public.task_submissions;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'submitted' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  select * into v_submission from public.task_submissions s
  where s.task_id = p_task_id order by s.version desc limit 1;

  update public.task_submissions set status = 'under_review' where id = v_submission.id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_submission.version, 'submission_id', v_submission.id));
  update public.tasks set status = 'under_review' where id = p_task_id;
  perform private.set_task_event_meta(null);
end;
$$;

create or replace function public.review_task(
  p_task_id uuid,
  p_decision public.review_decision,
  p_comment text default '',
  p_required_changes text default '',
  p_additional_instructions text default '',
  p_new_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_submission public.task_submissions;
  v_review_id uuid;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status not in ('submitted', 'under_review') then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  if p_decision is null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- A revision request must say what to change.
  if p_decision = 'revision_required'
     and char_length(btrim(coalesce(p_required_changes, ''))) = 0
     and char_length(btrim(coalesce(p_comment, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  if p_new_due_at is not null and v_task.planned_start_at is not null and p_new_due_at < v_task.planned_start_at then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select * into v_submission from public.task_submissions s
  where s.task_id = p_task_id order by s.version desc limit 1;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  insert into public.task_reviews (
    task_id, project_id, submission_id, decision, comment, required_changes, additional_instructions,
    previous_due_at, new_due_at, reviewer_id
  )
  values (
    p_task_id, v_task.project_id, v_submission.id, p_decision,
    coalesce(btrim(p_comment), ''), coalesce(btrim(p_required_changes), ''), coalesce(btrim(p_additional_instructions), ''),
    case when p_new_due_at is not null then v_task.due_at end, p_new_due_at, v_uid
  )
  returning id into v_review_id;

  update public.task_submissions
     set status = case when p_decision = 'approved' then 'approved'::public.submission_status
                       else 'revision_required'::public.submission_status end
   where id = v_submission.id;

  perform private.set_task_event_meta(jsonb_build_object(
    'version', v_submission.version, 'submission_id', v_submission.id, 'review_id', v_review_id,
    'new_due_at', p_new_due_at
  ));
  update public.tasks
     set status = case when p_decision = 'approved' then 'approved'::public.task_status
                       else 'revision_required'::public.task_status end,
         approved_at = case when p_decision = 'approved' then now() else approved_at end,
         due_at = coalesce(p_new_due_at, due_at),
         due_at_overridden = case when p_new_due_at is not null then true else due_at_overridden end
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  perform private.notify(
    v_task.assigned_to,
    case when p_decision = 'approved' then 'task_approved' else 'task_revision_requested' end,
    v_task.project_id, v_task.id,
    jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title, 'version', v_submission.version,
                       'new_due_at', p_new_due_at)
  );

  return v_review_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- MARK AS COMPLETED: the only way a task becomes COMPLETED and team-visible.
-- -----------------------------------------------------------------------------
create or replace function public.complete_task(p_task_id uuid, p_team_comment text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_final public.task_submissions;
  v_recipient uuid;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'approved' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  select * into v_final from public.task_submissions s
  where s.task_id = p_task_id and s.status = 'approved'
  order by s.version desc limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  update public.task_submissions set is_final = true where id = v_final.id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_final.version, 'submission_id', v_final.id));
  update public.tasks
     set status = 'completed',
         completed_at = now(),
         visibility = 'team',
         published_at = now()
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  insert into public.task_publications (
    task_id, project_id, team_id, task_code, title, responsible_id, responsible_name, responsible_title,
    final_result, deliverable_links, team_comment, final_submission_version, completed_at, published_by
  )
  values (
    v_task.id, v_task.project_id, v_task.team_id, v_task.task_code, v_task.title, v_task.assigned_to,
    private.profile_name(v_task.assigned_to),
    (select tm.job_title from public.team_members tm where tm.team_id = v_task.team_id and tm.user_id = v_task.assigned_to),
    v_final.summary, v_final.deliverable_links, coalesce(btrim(p_team_comment), ''), v_final.version, now(), v_uid
  );

  -- Notify the team (or, for a project without a team, its active members).
  for v_recipient in
    select tm.user_id from public.team_members tm
    where v_task.team_id is not null and tm.team_id = v_task.team_id and tm.status = 'active' and tm.user_id is not null
    union
    select pm.user_id from public.project_members pm
    where v_task.team_id is null and pm.project_id = v_task.project_id and pm.status = 'active'
  loop
    perform private.notify(
      v_recipient, 'task_published', v_task.project_id, v_task.id,
      jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title,
                         'responsible_name', private.profile_name(v_task.assigned_to))
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit trail for tasks (replaces the previous version)
-- -----------------------------------------------------------------------------
create or replace function private.task_status_event(p_from public.task_status, p_to public.task_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to = 'in_progress' and p_from = 'revision_required' then 'task.resumed'
    when p_to = 'in_progress' and p_from = 'blocked' then 'task.unblocked'
    when p_to = 'in_progress' then 'task.started'
    when p_to = 'submitted' and p_from = 'revision_required' then 'task.resubmitted'
    when p_to = 'submitted' then 'task.submitted'
    when p_to = 'under_review' then 'task.review_started'
    when p_to = 'revision_required' then 'task.revision_requested'
    when p_to = 'approved' then 'task.approved'
    when p_to = 'completed' then 'task.completed'
    when p_to = 'cancelled' then 'task.cancelled'
    when p_to = 'blocked' then 'task.blocked'
    when p_from = 'cancelled' then 'task.reopened'
    when p_to = 'scheduled' and p_from = 'not_started' then 'task.scheduled'
    when p_to = 'not_started' and p_from = 'scheduled' then 'task.unscheduled'
    when p_from = 'blocked' then 'task.unblocked'
    else 'task.status_changed'
  end;
$$;

create or replace function private.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes record;
  v_metadata jsonb := '{}'::jsonb;
  v_event_meta jsonb;
  v_label text;
begin
  -- Tasks removed together with their project are covered by project.deleted.
  if tg_op = 'DELETE' and not private.project_exists(old.project_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_label := new.task_code || ' · ' || new.title;
    perform private.log_activity(
      new.project_id, 'task.created', 'task', new.id, v_label, null,
      jsonb_build_object(
        'task_code', new.task_code, 'title', new.title, 'status', new.status, 'priority', new.priority,
        'assigned_to', new.assigned_to, 'responsible_member_id', new.responsible_member_id,
        'planning_month', new.planning_month, 'planning_week', new.planning_week,
        'planned_start_at', new.planned_start_at, 'planned_duration', new.planned_duration,
        'duration_unit', new.duration_unit, 'due_at', new.due_at
      ),
      jsonb_build_object('assignee_name', private.responsible_name(new.assigned_to, new.responsible_member_id))
    );
    perform private.notify(
      new.assigned_to, 'task_assigned', new.project_id, new.id,
      jsonb_build_object('task_code', new.task_code, 'task_title', new.title, 'due_at', new.due_at)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.log_activity(
      old.project_id, 'task.deleted', 'task', old.id, old.task_code || ' · ' || old.title,
      jsonb_build_object(
        'task_code', old.task_code, 'title', old.title, 'status', old.status, 'priority', old.priority,
        'assigned_to', old.assigned_to, 'due_at', old.due_at
      ),
      null,
      jsonb_build_object('assignee_name', private.profile_name(old.assigned_to))
    );
    return null;
  end if;

  -- UPDATE
  v_label := new.task_code || ' · ' || new.title;

  select * into v_changes
  from private.jsonb_changes(
    to_jsonb(old), to_jsonb(new),
    array['title', 'description', 'original_instructions', 'expected_output', 'completion_criteria', 'priority']
  );
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.updated', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  select * into v_changes
  from private.jsonb_changes(
    to_jsonb(old), to_jsonb(new),
    array['planning_month', 'planning_week', 'planned_start_at', 'planned_duration', 'duration_unit', 'due_at']
  );
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.schedule_changed', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  select * into v_changes
  from private.jsonb_changes(to_jsonb(old), to_jsonb(new), array['progress', 'work_notes']);
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.progress_updated', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  if new.status is distinct from old.status then
    begin
      v_event_meta := nullif(current_setting('app.task_event_meta', true), '')::jsonb;
    exception
      when others then
        v_event_meta := null;
    end;
    perform private.log_activity(
      new.project_id, private.task_status_event(old.status, new.status), 'task', new.id, v_label,
      jsonb_build_object('status', old.status),
      jsonb_strip_nulls(jsonb_build_object(
        'status', new.status,
        'actual_start_at', case when new.actual_start_at is distinct from old.actual_start_at then new.actual_start_at end,
        'submitted_at', case when new.submitted_at is distinct from old.submitted_at then new.submitted_at end,
        'approved_at', case when new.approved_at is distinct from old.approved_at then new.approved_at end,
        'completed_at', case when new.completed_at is distinct from old.completed_at then new.completed_at end
      )),
      coalesce(v_event_meta, '{}'::jsonb)
    );
  end if;

  if new.visibility is distinct from old.visibility then
    perform private.log_activity(
      new.project_id, 'task.published', 'task', new.id, v_label,
      jsonb_build_object('visibility', old.visibility),
      jsonb_build_object('visibility', new.visibility),
      jsonb_build_object('team_id', new.team_id)
    );
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.responsible_member_id is distinct from old.responsible_member_id then
    -- Un-assignment caused by removing the assignee from the project.
    if new.assigned_to is null and old.assigned_to is not null and not exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = old.assigned_to
    ) then
      v_metadata := jsonb_build_object('reason', 'member_removed');
    end if;

    perform private.log_activity(
      new.project_id, 'task.assigned', 'task', new.id, v_label,
      jsonb_build_object('assigned_to', old.assigned_to,
                         'assignee_name', private.responsible_name(old.assigned_to, old.responsible_member_id)),
      jsonb_build_object('assigned_to', new.assigned_to,
                         'assignee_name', private.responsible_name(new.assigned_to, new.responsible_member_id)),
      v_metadata
    );
    perform private.notify(
      new.assigned_to, 'task_assigned', new.project_id, new.id,
      jsonb_build_object('task_code', new.task_code, 'task_title', new.title, 'due_at', new.due_at)
    );
  end if;

  return null;
end;
$$;

-- Task comments: label entries with the task ID as well.
create or replace function private.audit_task_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_dependencies := case when tg_op = 'DELETE' then old else new end;
  v_task text;
  v_predecessor text;
begin
  if tg_op = 'DELETE' and (
       not private.project_exists(old.project_id)
       or not exists (select 1 from public.tasks t where t.id = old.task_id)
       or not exists (select 1 from public.tasks t where t.id = old.depends_on_task_id)
     ) then
    return null;
  end if;

  select t.task_code || ' · ' || t.title into v_task from public.tasks t where t.id = v_row.task_id;
  select t.task_code into v_predecessor from public.tasks t where t.id = v_row.depends_on_task_id;

  perform private.log_activity(
    v_row.project_id,
    case when tg_op = 'INSERT' then 'task.dependency_added' else 'task.dependency_removed' end,
    'task', v_row.task_id, v_task,
    case when tg_op = 'DELETE' then jsonb_build_object('depends_on', v_row.depends_on_task_id, 'depends_on_code', v_predecessor) end,
    case when tg_op = 'INSERT' then jsonb_build_object('depends_on', v_row.depends_on_task_id, 'depends_on_code', v_predecessor) end
  );
  return null;
end;
$$;

create trigger task_dependencies_audit
  after insert or delete on public.task_dependencies
  for each row execute function private.audit_task_dependencies();

-- -----------------------------------------------------------------------------
-- Read helpers updated for the new statuses / due_at
-- -----------------------------------------------------------------------------
create or replace function public.get_project_team(p_project_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.project_role,
  status public.member_status,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  permissions text[],
  assigned_open_tasks bigint,
  assigned_total_tasks bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'team.view') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  return query
  select
    pm.user_id,
    pr.full_name,
    pr.email,
    pm.role,
    pm.status,
    pm.created_at,
    pr.last_sign_in_at,
    case
      when pm.role = 'owner' then (select coalesce(array_agg(k.key order by k.sort_order), '{}'::text[]) from public.permissions k)
      else private.member_permission_keys(pm.project_id, pm.user_id)
    end,
    coalesce(t.open_count, 0),
    coalesce(t.total_count, 0),
    a.last_at
  from public.project_members pm
  join public.profiles pr on pr.id = pm.user_id
  left join lateral (
    select
      count(*) filter (where tk.status not in ('completed', 'cancelled')) as open_count,
      count(*) as total_count
    from public.tasks tk
    where tk.project_id = pm.project_id and tk.assigned_to = pm.user_id
  ) t on true
  left join lateral (
    select max(al.created_at) as last_at
    from public.activity_logs al
    where al.project_id = pm.project_id and al.actor_id = pm.user_id
  ) a on true
  where pm.project_id = p_project_id
  order by private.role_rank(pm.role) desc, lower(coalesce(nullif(pr.full_name, ''), pr.email));
end;
$$;

-- Dashboard aggregates (SECURITY INVOKER: every count respects RLS).
-- p_today is kept for compatibility; deadlines are compared with now().
create or replace function public.get_dashboard_stats(p_today date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with visible_projects as (
    select p.id, p.name, p.status from public.projects p
  ),
  visible_tasks as (
    select t.id, t.project_id, t.status, t.priority, t.assigned_to, t.due_at, public.schedule_status(t) as schedule
    from public.tasks t
  ),
  team_projects as (
    select project_id from private.project_ids_with_permission('team.view') as project_id
  ),
  team as (
    select distinct pm.user_id
    from public.project_members pm
    where pm.status = 'active'
      and pm.project_id in (select project_id from team_projects)
  )
  select jsonb_build_object(
    'total_projects', (select count(*) from visible_projects),
    'active_projects', (select count(*) from visible_projects where status = 'active'),
    'total_tasks', (select count(*) from visible_tasks),
    'active_tasks', (select count(*) from visible_tasks where status not in ('completed', 'cancelled')),
    'completed_tasks', (select count(*) from visible_tasks where status = 'completed'),
    'overdue_tasks', (select count(*) from visible_tasks where schedule = 'overdue'),
    'due_soon_tasks', (select count(*) from visible_tasks where schedule = 'due_soon'),
    'awaiting_review', (select count(*) from visible_tasks where status in ('submitted', 'under_review')),
    'awaiting_completion', (select count(*) from visible_tasks where status = 'approved'),
    'can_view_team', exists (select 1 from team_projects),
    'team_members', (select count(*) from team),
    'tasks_by_status', coalesce(
      (select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from visible_tasks group by status) s),
      '{}'::jsonb
    ),
    'tasks_by_priority', coalesce(
      (select jsonb_object_agg(s.priority, s.n) from (
        select priority, count(*) as n from visible_tasks where status not in ('completed', 'cancelled') group by priority
      ) s),
      '{}'::jsonb
    ),
    'tasks_by_member', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', m.assigned_to,
            'name', coalesce(private.profile_name(m.assigned_to), ''),
            'total', m.total,
            'open', m.open,
            'completed', m.completed,
            'overdue', m.overdue
          )
          order by m.total desc
        )
        from (
          select
            assigned_to,
            count(*) as total,
            count(*) filter (where status not in ('completed', 'cancelled')) as open,
            count(*) filter (where status = 'completed') as completed,
            count(*) filter (where schedule = 'overdue') as overdue
          from visible_tasks
          where assigned_to is not null
          group by assigned_to
          order by count(*) desc
          limit 12
        ) m
      ),
      '[]'::jsonb
    ),
    'project_progress', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'project_id', vp.id,
            'name', vp.name,
            'status', vp.status,
            'total', coalesce(c.total, 0),
            'completed', coalesce(c.completed, 0)
          )
          order by vp.name
        )
        from visible_projects vp
        left join (
          select project_id, count(*) filter (where status <> 'cancelled') as total,
                 count(*) filter (where status = 'completed') as completed
          from visible_tasks
          group by project_id
        ) c on c.project_id = vp.id
      ),
      '[]'::jsonb
    )
  );
$$;

-- Execution report: planned vs actual per responsible member, over the tasks
-- the caller can see (SECURITY INVOKER → RLS applies).
create or replace function public.get_execution_report(p_project_id uuid default null, p_planning_month integer default null)
returns table (
  user_id uuid,
  name text,
  total bigint,
  completed bigint,
  completed_on_time bigint,
  overdue bigint,
  in_review bigint,
  revisions bigint,
  submissions bigint,
  avg_start_delay_hours numeric,
  avg_completion_delay_hours numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select tk.*, public.schedule_status(tk) as schedule
    from public.tasks tk
    where tk.assigned_to is not null
      and (p_project_id is null or tk.project_id = p_project_id)
      and (p_planning_month is null or tk.planning_month = p_planning_month)
      and tk.status <> 'cancelled'
  )
  select
    t.assigned_to,
    coalesce(private.profile_name(t.assigned_to), ''),
    count(*),
    count(*) filter (where t.status = 'completed'),
    count(*) filter (where t.status in ('approved', 'completed') and t.due_at is not null
                     and coalesce(t.submitted_at, t.approved_at) <= t.due_at),
    count(*) filter (where t.schedule = 'overdue'),
    count(*) filter (where t.status in ('submitted', 'under_review')),
    (select count(*) from public.task_reviews r where r.task_id = any (array_agg(t.id)) and r.decision = 'revision_required'),
    (select count(*) from public.task_submissions s where s.task_id = any (array_agg(t.id))),
    round(avg(extract(epoch from (t.actual_start_at - t.planned_start_at)) / 3600)
          filter (where t.actual_start_at is not null and t.planned_start_at is not null)::numeric, 1),
    round(avg(extract(epoch from (coalesce(t.submitted_at, t.approved_at) - t.due_at)) / 3600)
          filter (where t.status in ('approved', 'completed') and t.due_at is not null)::numeric, 1)
  from t
  group by t.assigned_to
  order by 2;
$$;
