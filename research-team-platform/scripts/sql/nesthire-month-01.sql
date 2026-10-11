-- =============================================================================
-- NestHire demo plan — fictional development data only (6 tasks).
--
-- This public sample is intentionally not the real NestHire roadmap, roster,
-- schedule, or assignments. Use a separate private bootstrap process for any
-- real Production plan. It demonstrates task IDs, scheduling, dependencies,
-- assignment by roster code, and the database workflow.
--
-- Run after the 20261007* migrations and scripts/sql/nesthire-team.sql.
-- Safe to run twice: existing demo task IDs and dependencies are preserved.
-- =============================================================================
begin;
create temporary table demo_plan (
  code text primary key,
  member text not null,
  week smallint not null,
  priority public.task_priority not null,
  start_on date not null,
  days numeric not null,
  title text not null,
  description text not null,
  expected text not null,
  criteria text not null,
  depends text[] not null default '{}'
) on commit drop;

insert into demo_plan (code, member, week, priority, start_on, days, title, description, expected, criteria, depends) values
('M01-DL-01-01', 'DL', 1, 'p1', '2026-12-01', 1,
 'Demo: define a sample workflow outcome',
 'Fictional demo task: write one measurable outcome for the sample workflow.',
 'A short fictional outcome note.',
 'The outcome has an owner, a measure, and a review date.', '{}'),
('M01-UX-01-01', 'UX', 1, 'p2', '2026-12-02', 1,
 'Demo: sketch the sample workspace flow',
 'Fictional demo task: sketch the screens needed to move a sample item from intake to review.',
 'A fictional low-fidelity flow sketch.',
 'The sketch includes intake, work, review, and completion states.', '{M01-DL-01-01}'),
('M01-EN-01-01', 'EN', 1, 'p1', '2026-12-03', 1,
 'Demo: model a sample record',
 'Fictional demo task: describe the fields and relationships for one non-production sample record.',
 'A fictional record definition with example values.',
 'The definition has identifiers, ownership, status, and timestamps.', '{M01-UX-01-01}'),
('M01-EN-01-02', 'EN', 1, 'p1', '2026-12-04', 1,
 'Demo: implement a validation example',
 'Fictional demo task: implement validation for the sample record and document one rejected input.',
 'A local validation example and a fictional rejected-input case.',
 'Valid input passes and the documented invalid input is rejected.', '{M01-EN-01-01}'),
('M01-QA-01-01', 'QA', 1, 'p2', '2026-12-05', 1,
 'Demo: review the sample workflow',
 'Fictional demo task: review the sample flow and validation behavior using non-production data.',
 'A fictional review note with findings and disposition.',
 'The review identifies at least one check and records its disposition.', '{M01-EN-01-02}'),
('M01-DL-01-02', 'DL', 1, 'p1', '2026-12-06', 1,
 'Demo: publish a sample result',
 'Fictional demo task: approve the demo result and record the publication boundary.',
 'A fictional publication note containing only the approved sample result.',
 'Only the approved demo result is marked ready for team visibility.', '{M01-QA-01-01}');

do $$
declare
  v_director uuid := (select p.id from public.profiles p where p.is_director order by p.created_at limit 1);
  v_team uuid := (select t.id from public.teams t where lower(btrim(t.name)) = 'nesthire demo team');
  v_project uuid;
  v_missing text;
  v_row record;
begin
  if v_director is null then
    raise exception 'No Director found.';
  end if;
  if v_team is null then
    raise exception 'Run scripts/sql/nesthire-team.sql first (NestHire Demo Team not found).';
  end if;

  select string_agg(distinct p.member, ', ') into v_missing
  from demo_plan p
  where not exists (
    select 1 from public.team_members tm
    where tm.team_id = v_team and tm.member_code = p.member
  );
  if v_missing is not null then
    raise exception 'Demo roster codes missing: %', v_missing;
  end if;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_director, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true
  );

  select p.id into v_project
  from public.projects p
  where p.name = 'NestHire Demo Project'
  order by p.created_at
  limit 1;

  if v_project is null then
    v_project := public.create_project(
      'NestHire Demo Project',
      'Fictional demo workspace for local development only.',
      'Demonstrate a private task workflow without using production data.',
      'active',
      date '2026-12-01',
      date '2026-12-31'
    );
  end if;
  if (select p.team_id from public.projects p where p.id = v_project) is distinct from v_team then
    perform public.set_project_team(v_project, v_team);
  end if;

  for v_row in select * from demo_plan order by start_on, code loop
    insert into public.tasks (
      project_id, task_code, title, description, expected_output, completion_criteria, priority,
      responsible_member_id, planning_month, planning_week,
      planned_start_at, planned_duration, duration_unit
    )
    select
      v_project, v_row.code, v_row.title, v_row.description, v_row.expected, v_row.criteria, v_row.priority,
      (select tm.id from public.team_members tm where tm.team_id = v_team and tm.member_code = v_row.member),
      1, v_row.week,
      (v_row.start_on + time '09:00') at time zone 'UTC', v_row.days, 'days'
    where not exists (select 1 from public.tasks t where t.task_code = v_row.code);
  end loop;

  insert into public.task_dependencies (task_id, depends_on_task_id, project_id)
  select t.id, d.id, t.project_id
  from demo_plan p
  cross join lateral unnest(p.depends) as dep(code)
  join public.tasks t on t.task_code = p.code
  join public.tasks d on d.task_code = dep.code
  where t.project_id = d.project_id
    and not exists (
      select 1 from public.task_dependencies x
      where x.task_id = t.id and x.depends_on_task_id = d.id
    );

  if (select count(*) from public.tasks t where t.task_code in (select code from demo_plan)) <> 6 then
    raise exception 'Expected 6 fictional demo tasks.';
  end if;
  if exists (
    select 1
    from public.task_dependencies x
    join public.tasks t on t.id = x.task_id
    join public.tasks d on d.id = x.depends_on_task_id
    where t.task_code in (select code from demo_plan)
      and t.planned_start_at < d.due_at
  ) then
    raise exception 'A demo task starts before one of its predecessors is due.';
  end if;
end;
$$;
commit;
