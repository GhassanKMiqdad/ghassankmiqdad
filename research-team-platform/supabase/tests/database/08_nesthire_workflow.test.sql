-- NestHire scheduling & execution control: role model, schedule calculation,
-- execution workflow, versioned submissions, reviews, PRIVATE → TEAM
-- publication and the A/B/C visibility scenario.
--
--   Director .......... owner (Ghassan)            — organization-wide
--   Team Alpha ........ lead: manager, members: member (A), member2 (B) → Project A
--   Team Beta ......... member: outsider (C)                            → Project B
begin;
\ir _helpers.psql
select plan(70);

select tests.setup_world();
-- The fixture's owner is the only Director inside this (rolled back) transaction.
update public.profiles set is_director = (id = tests.uid('owner'));

-- ---------------------------------------------------------------------------
-- Role model: only the Director manages teams and roles
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok($$ select public.create_team('Shadow team', '') $$, '42501', 'PERMISSION_DENIED', 'a team member cannot create teams');
select throws_ok(
  format($$ select public.set_user_director(%L, true) $$, tests.uid('member')),
  '42501', 'PERMISSION_DENIED',
  'a team member cannot promote themselves to Director'
);
select throws_ok(
  format($$ update public.profiles set is_director = true where id = %L $$, tests.uid('member')),
  '42501', null,
  'the Director flag cannot be written through the API'
);

select tests.authenticate_as('owner');
create temporary table ids (key text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('alpha', public.create_team('Team Alpha', 'Research team'));
insert into ids values ('beta', public.create_team('Team Beta', 'Another team'));
insert into ids values ('lead', public.upsert_team_member((select id from ids where key = 'alpha'), null, 'Research Manager', 'rm', 'Team Lead', 'team_lead', 'manager@example.test'));
insert into ids values ('a', public.upsert_team_member((select id from ids where key = 'alpha'), null, 'Ahmad', 'AH', 'ML Engineer', 'team_member', null));
insert into ids values ('b', public.upsert_team_member((select id from ids where key = 'alpha'), null, 'Sara', 'SA', 'Backend Developer', 'team_member', null));
insert into ids values ('c', public.upsert_team_member((select id from ids where key = 'beta'), null, 'Outsider', 'OU', 'Designer', 'team_member', null));
select public.link_team_member((select id from ids where key = 'a'), 'member@example.test');
select public.link_team_member((select id from ids where key = 'b'), 'member2@example.test');
select public.link_team_member((select id from ids where key = 'c'), 'outsider@example.test');
select public.set_project_team(tests.uid('project_a'), (select id from ids where key = 'alpha'));
select public.set_project_team(tests.uid('project_b'), (select id from ids where key = 'beta'));

select throws_ok(
  format($$ select public.set_user_director(%L, false) $$, tests.uid('owner')),
  '42501', 'LAST_DIRECTOR',
  'the last Director cannot be removed'
);
select tests.clear_authentication();

select results_eq(
  $$ select tm.member_code, tm.status::text, tm.user_id from public.team_members tm
     where tm.team_id in (select id from ids where key in ('alpha', 'beta')) order by tm.member_code $$,
  format(
    $$ values ('AH', 'active', %L::uuid), ('OU', 'active', %L::uuid), ('RM', 'active', %L::uuid), ('SA', 'active', %L::uuid) $$,
    tests.uid('member'), tests.uid('outsider'), tests.uid('manager'), tests.uid('member2')
  ),
  'roster entries are linked by e-mail (and automatically for a confirmed invitation)'
);
select results_eq(
  format($$ select role::text, status::text from public.project_members where project_id = %L and user_id = %L $$, tests.uid('project_b'), tests.uid('outsider')),
  $$ values ('member', 'active') $$,
  'linking a project to a team adds the roster to the project as members'
);
select is(
  (select count(*)::int from public.activity_logs
   where action in ('team.created', 'team.member_added', 'team.member_linked', 'project.team_changed')
     and (entity_id in (select id from ids where key in ('alpha', 'beta')) or project_id in (tests.uid('project_a'), tests.uid('project_b')))),
  12,
  'team and role changes are audited'
);

-- The Team Lead runs operations but cannot change roles.
select tests.authenticate_as('manager');
select throws_ok(
  format($$ select public.upsert_team_member(%L, %L, 'Ahmad', 'AH', 'ML Engineer', 'team_lead', null) $$,
         (select id from ids where key = 'alpha'), (select id from ids where key = 'a')),
  '42501', 'PERMISSION_DENIED',
  'a Team Lead cannot change roles'
);
select throws_ok(
  format($$ select public.set_project_team(%L, null) $$, tests.uid('project_a')),
  '42501', 'PERMISSION_DENIED',
  'a Team Lead cannot change the team structure'
);
select is_empty(
  format($$ select id from public.tasks where project_id = %L $$, tests.uid('project_b')),
  'a Team Lead has no authority over another team''s project'
);

-- The Director sees every project's tasks without being a member.
select tests.authenticate_as('owner');
select is(
  (select count(*)::int from public.tasks where project_id = tests.uid('project_b')),
  1,
  'the Director sees the data of every project'
);

-- ---------------------------------------------------------------------------
-- Audit test 1 — due date = start + duration (server-calculated)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
insert into public.tasks (
  project_id, title, description, original_instructions, expected_output, completion_criteria,
  priority, assigned_to, planning_month, planning_week, planned_start_at, planned_duration, duration_unit
) values (
  tests.uid('project_a'), 'Train baseline model', 'Train the first baseline', 'Use the cleaned dataset v2',
  'Model card and metrics table', 'F1 >= 0.80 on the validation set',
  'p0', tests.uid('member'), 1, 1, '2026-11-02 09:00+02', 3, 'days'
);
insert into ids select 'task', id from public.tasks where title = 'Train baseline model';
create temporary table ids_codes on commit drop as select task_code from public.tasks where title = 'Train baseline model';
grant select on ids_codes to authenticated;
insert into public.tasks (project_id, title, assigned_to, planned_start_at, planned_duration, duration_unit)
values (tests.uid('project_a'), 'Hours task', tests.uid('member2'), '2026-11-02 09:00+02', 6, 'hours');
insert into public.tasks (project_id, title, assigned_to, planned_start_at, planned_duration, duration_unit)
values (tests.uid('project_a'), 'Weeks task', tests.uid('member2'), '2026-11-02 09:00+02', 2, 'weeks');
insert into public.tasks (project_id, title, assigned_to, task_code, planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden)
values (tests.uid('project_a'), 'Overridden deadline', tests.uid('member2'), 't01-gh-01-01', '2026-11-02 09:00+02', 1, 'days', '2026-11-06 17:00+02', true);
insert into public.tasks (project_id, title, assigned_to)
values (tests.uid('project_a'), 'Not yet planned', tests.uid('member2'));
select tests.clear_authentication();

select results_eq(
  $$ select due_at, planned_duration_minutes, status::text from public.tasks where title = 'Train baseline model' $$,
  $$ values ('2026-11-05 09:00+02'::timestamptz, 4320, 'scheduled'::text) $$,
  'audit 1: due date = planned start + 3 days, stored explicitly; the task is SCHEDULED'
);
select is((select due_at from public.tasks where title = 'Hours task'), '2026-11-02 15:00+02'::timestamptz, 'audit 1: hours are added exactly');
select is((select due_at from public.tasks where title = 'Weeks task'), '2026-11-16 09:00+02'::timestamptz, 'audit 1: weeks are added exactly');
select is((select due_at from public.tasks where title = 'Overridden deadline'), '2026-11-06 17:00+02'::timestamptz, 'a supervisor can override the calculated deadline');
select results_eq(
  $$ select planned_start_at, due_at, status::text, public.schedule_status(t) from public.tasks t where title = 'Not yet planned' $$,
  $$ values (null::timestamptz, null::timestamptz, 'not_started'::text, 'unscheduled'::text) $$,
  'no dates are invented: an unplanned task stays unscheduled'
);
select matches((select task_code from public.tasks where title = 'Train baseline model'), '^M01-AH-01-[0-9]{2}$', 'the task ID uses month, member code, week and sequence');
select is((select task_code from public.tasks where title = 'Overridden deadline'), 'T01-GH-01-01', 'an existing task ID entered by the supervisor is preserved');
select throws_ok(
  format($$ insert into public.tasks (project_id, title, task_code) values (%L, 'Duplicate ID', 'T01-GH-01-01') $$, tests.uid('project_a')),
  '23505', null,
  'task IDs are unique'
);

-- ---------------------------------------------------------------------------
-- Audit test 2 — the member cannot change start, duration or deadline
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok(
  format($$ update public.tasks set planned_start_at = '2026-11-01 09:00+02' where id = %L $$, (select id from ids where key = 'task')),
  '42501', 'TASK_EDIT_FORBIDDEN', 'audit 2: a member cannot change the planned start'
);
select throws_ok(
  format($$ update public.tasks set planned_duration = 10 where id = %L $$, (select id from ids where key = 'task')),
  '42501', 'TASK_EDIT_FORBIDDEN', 'audit 2: a member cannot change the duration'
);
select throws_ok(
  format($$ update public.tasks set due_at = '2026-12-31 09:00+02', due_at_overridden = true where id = %L $$, (select id from ids where key = 'task')),
  '42501', 'TASK_EDIT_FORBIDDEN', 'audit 2: a member cannot change the deadline'
);
select throws_ok(
  format($$ update public.tasks set actual_start_at = '2026-10-01 09:00+02' where id = %L $$, (select id from ids where key = 'task')),
  '42501', null, 'a member cannot backdate the actual start'
);
select throws_ok(
  format($$ select public.submit_task(%L, 'Too early', '{}', '') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'work cannot be submitted before it starts'
);

-- ---------------------------------------------------------------------------
-- Audit test 3 — actual start
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ update public.tasks set status = 'in_progress' where id = %L $$, (select id from ids where key = 'task')),
  'the member starts the task'
);
select tests.clear_authentication();
select ok(
  (select actual_start_at is not null and actual_start_at <= now() from public.tasks where id = (select id from ids where key = 'task')),
  'audit 3: the actual start is recorded when the task moves to IN_PROGRESS'
);

-- ---------------------------------------------------------------------------
-- A/B/C: while private, B (same team) and C (other team) see nothing
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select lives_ok(
  format($$ select public.submit_task(%L, 'Draft v1: baseline F1 0.71', array['https://example.com/v1'], 'Not tuned yet') $$, (select id from ids where key = 'task')),
  'researcher A submits'
);

select tests.authenticate_as('member2');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')), 'B cannot see A''s private task');
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, (select id from ids where key = 'task')), 'B cannot see A''s submission');
select is_empty($$ select task_id from public.task_publications $$, 'nothing is published before completion');
select tests.authenticate_as('outsider');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')), 'C cannot see A''s private task');

-- ---------------------------------------------------------------------------
-- Audit test 4 — submission recorded
-- ---------------------------------------------------------------------------
select tests.clear_authentication();
select results_eq(
  format($$ select t.status::text, t.submitted_at is not null, s.version, s.status::text
            from public.tasks t join public.task_submissions s on s.task_id = t.id where t.id = %L $$, (select id from ids where key = 'task')),
  $$ values ('submitted'::text, true, 1, 'submitted'::text) $$,
  'audit 4: the submission is recorded as version 1 with its timestamp'
);
select ok(
  exists (select 1 from public.notifications where user_id = tests.uid('manager') and type = 'task_submitted'),
  'the Team Lead is notified of the submission'
);

-- Members never review or approve (their own or anyone's) work.
select tests.authenticate_as('member');
select throws_ok(
  format($$ select public.review_task(%L, 'approved', 'Looks good to me') $$, (select id from ids where key = 'task')),
  '42501', 'PERMISSION_DENIED', 'a member cannot approve their own work'
);

-- ---------------------------------------------------------------------------
-- Audit test 5 — revision request with a new deadline
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
select lives_ok(format($$ select public.start_task_review(%L) $$, (select id from ids where key = 'task')), 'the Team Lead starts the review');
select lives_ok(
  format(
    $$ select public.review_task(%L, 'revision_required', 'Close, but below target', 'Tune the learning rate; report per-class F1',
                                 'Keep the dataset fixed', '2026-11-07 17:00+02') $$,
    (select id from ids where key = 'task')
  ),
  'the Team Lead requests a revision'
);
select tests.clear_authentication();
select results_eq(
  format($$ select r.decision::text, r.required_changes, r.new_due_at, t.status::text, t.due_at
            from public.task_reviews r join public.tasks t on t.id = r.task_id where r.task_id = %L $$, (select id from ids where key = 'task')),
  $$ values ('revision_required'::text, 'Tune the learning rate; report per-class F1'::text,
             '2026-11-07 17:00+02'::timestamptz, 'revision_required'::text, '2026-11-07 17:00+02'::timestamptz) $$,
  'audit 5: the revision is recorded with required changes and the new deadline'
);

-- ---------------------------------------------------------------------------
-- Audit test 6 — resubmission creates a new version
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select is(
  (select required_changes from public.task_reviews where task_id = (select id from ids where key = 'task')),
  'Tune the learning rate; report per-class F1',
  'the responsible member sees the feedback on their task'
);
select lives_ok(
  format($$ select public.submit_task(%L, 'Final: baseline F1 0.83', array['https://example.com/v2'], 'Per-class report attached') $$, (select id from ids where key = 'task')),
  'researcher A resubmits'
);
select tests.clear_authentication();
select results_eq(
  format($$ select version, summary, status::text from public.task_submissions where task_id = %L order by version $$, (select id from ids where key = 'task')),
  $$ values (1, 'Draft v1: baseline F1 0.71'::text, 'revision_required'::text), (2, 'Final: baseline F1 0.83'::text, 'submitted'::text) $$,
  'audit 6: the resubmission is version 2 and version 1 is preserved unchanged'
);

-- ---------------------------------------------------------------------------
-- Audit test 7 — approval, then MARK AS COMPLETED
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
select public.start_task_review((select id from ids where key = 'task'));
select lives_ok(
  format($$ select public.review_task(%L, 'approved', 'Meets the criteria') $$, (select id from ids where key = 'task')),
  'the Team Lead approves'
);
select tests.clear_authentication();
select results_eq(
  format($$ select status::text, approved_at is not null, visibility::text, completed_at from public.tasks where id = %L $$, (select id from ids where key = 'task')),
  $$ values ('approved'::text, true, 'private'::text, null::timestamptz) $$,
  'an approved task stays PRIVATE until it is marked as completed'
);

-- Audit test 10 — the member cannot publish or complete
select tests.authenticate_as('member');
select throws_ok(
  format($$ update public.tasks set visibility = 'team' where id = %L $$, (select id from ids where key = 'task')),
  '42501', null, 'audit 10: A cannot set visibility = TEAM'
);
select throws_ok(
  format($$ update public.tasks set status = 'completed' where id = %L $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'audit 10: A cannot set status = COMPLETED'
);
select throws_ok(
  format($$ select public.complete_task(%L, 'Publishing my own work') $$, (select id from ids where key = 'task')),
  '42501', 'PERMISSION_DENIED', 'audit 10: A cannot mark their own task as completed'
);
select tests.authenticate_as('member2');
select throws_ok(
  format($$ select public.complete_task(%L, '') $$, (select id from ids where key = 'task')),
  'P0002', 'NOT_FOUND', 'B cannot complete (or even find) A''s task'
);

select tests.authenticate_as('manager');
select lives_ok(
  format($$ select public.complete_task(%L, 'Baseline approved — use it as the reference model') $$, (select id from ids where key = 'task')),
  'the Team Lead clicks MARK AS COMPLETED'
);
select tests.clear_authentication();
select results_eq(
  format($$ select status::text, completed_at is not null, visibility::text, published_at is not null from public.tasks where id = %L $$, (select id from ids where key = 'task')),
  $$ values ('completed'::text, true, 'team'::text, true) $$,
  'audit 7: approval + MARK AS COMPLETED completes the task and makes it team-visible'
);
select results_eq(
  format($$ select version, is_final from public.task_submissions where task_id = %L order by version $$, (select id from ids where key = 'task')),
  $$ values (1, false), (2, true) $$,
  'the approved final submission becomes the official one; earlier versions are preserved'
);

-- ---------------------------------------------------------------------------
-- Audit test 8 — team visibility after completion (B sees the final result only)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member2');
select results_eq(
  $$ select task_code = (select task_code from ids_codes), title, responsible_name, responsible_title, final_result,
            deliverable_links, team_comment
     from public.task_publications $$,
  $$ values (true, 'Train baseline model'::text, 'Ahmad'::text, 'ML Engineer'::text,
             'Final: baseline F1 0.83'::text, array['https://example.com/v2']::text[],
             'Baseline approved — use it as the reference model'::text) $$,
  'audit 8: B (same team) sees the task ID, title, responsible, final result, deliverables and team comment'
);
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')), 'B still cannot read the private task record');
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, (select id from ids where key = 'task')), 'B cannot see drafts or previous versions');
select is_empty(format($$ select id from public.task_reviews where task_id = %L $$, (select id from ids where key = 'task')), 'B cannot see review notes');
select ok(
  exists (select 1 from public.notifications where type = 'task_published' and task_id = (select id from ids where key = 'task')),
  'the team is notified of the published result'
);
select is_empty(
  format($$ select id from public.notifications where user_id = %L $$, tests.uid('member')),
  'B cannot read A''s notifications'
);

-- ---------------------------------------------------------------------------
-- Audit test 9 — an unrelated team cannot see it
-- ---------------------------------------------------------------------------
select tests.authenticate_as('outsider');
select is_empty($$ select task_id from public.task_publications $$, 'audit 9: C (other team) cannot see the published result');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')), 'C cannot see the task');

-- ---------------------------------------------------------------------------
-- Self-review guard, and the audit trail of the whole workflow
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, assigned_to) values (tests.uid('project_a'), 'Lead own task', tests.uid('manager'));
update public.tasks set status = 'in_progress' where title = 'Lead own task';
select public.submit_task((select id from public.tasks where title = 'Lead own task'), 'Done', '{}', '');
select throws_ok(
  format($$ select public.review_task(%L, 'approved') $$, (select id from public.tasks where title = 'Lead own task')),
  '42501', 'SELF_REVIEW_FORBIDDEN', 'nobody below the Director approves their own work'
);
select tests.authenticate_as('owner');
select public.start_task_review((select id from public.tasks where title = 'Lead own task'));
select lives_ok(
  format($$ select public.review_task(%L, 'revision_required', 'Add the evaluation table') $$, (select id from public.tasks where title = 'Lead own task')),
  'the Director reviews the Team Lead''s work'
);
select tests.clear_authentication();

select results_eq(
  format($$ select action from public.activity_logs where entity_id = %L and action like 'task.%%' order by created_at $$, (select id from ids where key = 'task')),
  $$ values ('task.created'), ('task.started'), ('task.submitted'), ('task.review_started'), ('task.schedule_changed'),
            ('task.revision_requested'), ('task.resubmitted'), ('task.review_started'), ('task.approved'),
            ('task.completed'), ('task.published') $$,
  'every step of the workflow is in the audit log'
);
select is(
  (select (metadata ->> 'version')::int from public.activity_logs
   where entity_id = (select id from ids where key = 'task') and action = 'task.resubmitted'),
  2,
  'the audit entry of a resubmission carries its version'
);
select is(
  (select actor_id from public.activity_logs where entity_id = (select id from ids where key = 'task') and action = 'task.completed'),
  tests.uid('manager'),
  'the publication is attributed to the Team Lead who marked the task as completed'
);

-- Schedule status is computed by the server.
select results_eq(
  $$ select public.schedule_status(t) from public.tasks t where title = 'Weeks task' $$,
  $$ values ('scheduled'::text) $$,
  'a future planned start is SCHEDULED'
);
update public.tasks set planned_start_at = now() - interval '2 days', planned_duration = 1, duration_unit = 'days', due_at_overridden = false
 where title = 'Hours task';
update public.tasks set planned_start_at = now() - interval '1 hour', planned_duration = 5, duration_unit = 'hours', due_at_overridden = false
 where title = 'Weeks task';
select results_eq(
  $$ select title, public.schedule_status(t) from public.tasks t where title in ('Hours task', 'Weeks task') order by title $$,
  $$ values ('Hours task'::text, 'overdue'::text), ('Weeks task'::text, 'due_soon'::text) $$,
  'overdue and due-soon (< 24 h) are computed with the server clock'
);

-- ---------------------------------------------------------------------------
-- Planning for a roster member who has no account yet
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
insert into ids values ('pending', public.upsert_team_member((select id from ids where key = 'alpha'), null, 'Pending Person', 'PD', 'Data Analyst', 'team_member', null));
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, responsible_member_id, planning_week)
values (tests.uid('project_a'), 'Planned before the account exists', (select id from ids where key = 'pending'), 2);
select tests.authenticate_as('member');
select throws_ok(
  format(
    $$ insert into public.tasks (project_id, title, responsible_member_id) values (%L, 'Sneaky', %L) $$,
    tests.uid('project_a'), (select id from ids where key = 'pending')
  ),
  '42501', null,
  'only supervisors plan work for roster members'
);
select tests.clear_authentication();
select results_eq(
  $$ select assigned_to is null, task_code ~ '^M01-PD-02-[0-9]{2}$' from public.tasks where title = 'Planned before the account exists' $$,
  $$ values (true, true) $$,
  'a task can belong to a roster entry without an account; its ID uses the roster code'
);
select tests.authenticate_as('owner');
select public.link_team_member((select id from ids where key = 'pending'), 'newcomer@example.test');
select tests.clear_authentication();
select is(
  (select assigned_to from public.tasks where title = 'Planned before the account exists'),
  tests.uid('newcomer'),
  'linking the account assigns the planned tasks to it'
);
select ok(
  exists (select 1 from public.notifications where user_id = tests.uid('newcomer') and type = 'task_assigned'),
  'the newly linked member is notified of the assignment'
);

-- Roster deactivation revokes project access.
select tests.authenticate_as('owner');
select public.set_team_member_status((select id from ids where key = 'b'), 'inactive');
select tests.clear_authentication();
select is(
  (select status::text from public.project_members where project_id = tests.uid('project_a') and user_id = tests.uid('member2')),
  'suspended',
  'deactivating a roster entry suspends the member in the team''s projects'
);
select tests.authenticate_as('member2');
select is_empty($$ select task_id from public.task_publications $$, 'a deactivated member no longer sees the team''s results');

select * from finish();
rollback;
