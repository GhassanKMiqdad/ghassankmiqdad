-- Task permissions: execution vs supervision, schedule protection, status
-- transitions, assignment, dependencies, admin.
begin;
\ir _helpers.psql
select plan(34);

select tests.setup_world();

-- ---------------------------------------------------------------------------
-- Team member (template: project.view, tasks.edit_assigned, documents, comments, team.view)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');

select lives_ok(
  format($$ update public.tasks set progress = 40, work_notes = 'First chapter drafted' where id = %L $$, tests.uid('task_assigned_member')),
  'the responsible member can update progress and work notes'
);
select throws_ok(
  format($$ update public.tasks set title = 'Renamed by member' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'the responsible member cannot edit the task definition'
);
select throws_ok(
  format($$ update public.tasks set planned_start_at = now() - interval '3 days' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'the responsible member cannot change the planned start'
);
select throws_ok(
  format($$ update public.tasks set status = 'completed' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a member cannot complete their own work'
);
select throws_ok(
  format($$ update public.tasks set visibility = 'team' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', null,
  'a member cannot publish a task by setting its visibility'
);
select throws_ok(
  format($$ update public.tasks set assigned_to = %L where id = %L $$, tests.uid('member2'), tests.uid('task_assigned_member')),
  '42501', 'TASK_ASSIGN_FORBIDDEN',
  'a member cannot re-assign a task'
);
select throws_ok(
  format($$ update public.tasks set project_id = %L where id = %L $$, tests.uid('project_b'), tests.uid('task_assigned_member')),
  '42501', null,
  'a task cannot be moved to another project'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, assigned_to) values (%L, 'Self assigned task', %L) $$, tests.uid('project_a'), tests.uid('member')),
  '42501', 'PERMISSION_DENIED',
  'a team member cannot create tasks'
);
select results_eq(
  $$ select id from public.tasks order by id $$,
  format(
    $$ values (%L::uuid), (%L::uuid), (%L::uuid) $$,
    tests.uid('task_assigned_member'), tests.uid('task_own_member'), tests.uid('task_review')
  ),
  'a member only sees their own tasks (other members'' tasks are private)'
);

-- A member who was explicitly granted task creation.
select tests.set_grants('project_a', 'member', array['project.view', 'tasks.create', 'tasks.edit_own', 'tasks.edit_assigned']);
select tests.authenticate_as('member');
select lives_ok(
  format($$ insert into public.tasks (project_id, title, assigned_to) values (%L, 'Self assigned task', %L) $$, tests.uid('project_a'), tests.uid('member')),
  'with tasks.create a member can create a task for themselves'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, assigned_to) values (%L, 'Assigned to someone else', %L) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'TASK_ASSIGN_FORBIDDEN',
  'without tasks.assign a new task cannot be assigned to someone else'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, created_by) values (%L, 'Spoofed creator', %L) $$, tests.uid('project_a'), tests.uid('owner')),
  '42501', null,
  'the creator of a task cannot be supplied by the client'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, status) values (%L, 'Born completed', 'completed') $$, tests.uid('project_a')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a task cannot be created directly in a later workflow state'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, planned_start_at) values (%L, 'Self scheduled', now()) $$, tests.uid('project_a')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'scheduling a task is a supervisor decision'
);
select lives_ok(
  format($$ update public.tasks set title = 'Methodology v2' where id = %L $$, tests.uid('task_own_member')),
  'with tasks.edit_own a member edits the content of tasks they created'
);
select tests.clear_authentication();
select is(
  (select created_by from public.tasks where title = 'Self assigned task'),
  tests.uid('member'),
  'created_by is always the authenticated caller'
);
select matches(
  (select task_code from public.tasks where title = 'Self assigned task'),
  '^M01-NA-00-[0-9]{2}$',
  'the server generates the task ID'
);

-- ---------------------------------------------------------------------------
-- Reviewer (tasks.view + tasks.review): reviews only through the workflow
-- ---------------------------------------------------------------------------
select tests.authenticate_as('reviewer');
select throws_ok(
  format($$ update public.tasks set status = 'approved' where id = %L $$, tests.uid('task_review')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'approval cannot bypass the review workflow'
);
select throws_ok(
  format($$ update public.tasks set title = 'Reviewer rewrite' where id = %L $$, tests.uid('task_review')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'a reviewer cannot edit the content of a task'
);

-- ---------------------------------------------------------------------------
-- Manager (supervisor): assignment, schedule, dependencies
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
select lives_ok(
  format($$ update public.tasks set assigned_to = %L where id = %L $$, tests.uid('member2'), tests.uid('task_own_member')),
  'a manager with tasks.assign can assign a task to a project member'
);
select throws_ok(
  format($$ update public.tasks set assigned_to = %L where id = %L $$, tests.uid('outsider'), tests.uid('task_own_member')),
  '22023', 'ASSIGNEE_NOT_MEMBER',
  'a task can only be assigned to a member of the same project'
);
select lives_ok(
  format(
    $$ update public.tasks set planned_start_at = '2026-11-02 09:00+02', planned_duration = 2, duration_unit = 'days' where id = %L $$,
    tests.uid('task_member2')
  ),
  'a supervisor schedules a task'
);
insert into public.task_dependencies (task_id, depends_on_task_id, project_id)
values (tests.uid('task_member2'), tests.uid('task_review'), tests.uid('project_a'));
select throws_ok(
  format(
    $$ insert into public.task_dependencies (task_id, depends_on_task_id, project_id) values (%L, %L, %L) $$,
    tests.uid('task_review'), tests.uid('task_member2'), tests.uid('project_a')
  ),
  '22023', 'DEPENDENCY_CYCLE',
  'circular dependencies are rejected'
);
select tests.clear_authentication();
select is(
  (select assignee_name from (
     select new_values ->> 'assignee_name' as assignee_name from public.activity_logs
     where action = 'task.assigned' and entity_id = tests.uid('task_own_member') and actor_id = tests.uid('manager')
   ) s),
  'Sara',
  'task assignment is audited with the assignee name'
);
select results_eq(
  format($$ select status::text, due_at, planned_duration_minutes from public.tasks where id = %L $$, tests.uid('task_member2')),
  $$ values ('scheduled'::text, '2026-11-04 09:00+02'::timestamptz, 2880) $$,
  'the deadline is calculated by the server and the task becomes SCHEDULED'
);

-- The predecessor (in review) blocks the start.
select tests.authenticate_as('member2');
select throws_ok(
  format($$ update public.tasks set status = 'in_progress' where id = %L $$, tests.uid('task_member2')),
  '42501', 'TASK_BLOCKED',
  'a task cannot start before its predecessors are approved'
);
select tests.authenticate_as('manager');
delete from public.task_dependencies where task_id = tests.uid('task_member2');
select tests.authenticate_as('member2');
select lives_ok(
  format($$ update public.tasks set status = 'in_progress' where id = %L $$, tests.uid('task_member2')),
  'the responsible member starts the task once unblocked'
);
select tests.clear_authentication();
select isnt(
  (select actual_start_at from public.tasks where id = tests.uid('task_member2')),
  null,
  'the actual start is recorded by the server'
);

-- ---------------------------------------------------------------------------
-- Owner: cancel / reopen / delete, immutable task ID, closed records
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select lives_ok(
  format($$ update public.tasks set status = 'cancelled' where id = %L $$, tests.uid('task_own_member')),
  'a supervisor can cancel a task'
);
select lives_ok(
  format($$ update public.tasks set status = 'not_started' where id = %L $$, tests.uid('task_own_member')),
  'a supervisor can re-open a cancelled task'
);
select throws_ok(
  format($$ update public.tasks set task_code = 'M09-XX-09-99' where id = %L $$, tests.uid('task_own_member')),
  '42501', null,
  'the task ID is immutable'
);
select tests.clear_authentication();
update public.tasks set status = 'completed' where id = tests.uid('task_assigned_member');
select tests.authenticate_as('owner');
select throws_ok(
  format($$ update public.tasks set title = 'Rewritten history' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'a completed task is a closed record'
);
select lives_ok(
  format($$ delete from public.tasks where id = %L $$, tests.uid('task_own_member')),
  'the owner can delete a task'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.activity_logs where action = 'task.deleted' and entity_id = tests.uid('task_own_member') and actor_id = tests.uid('owner')),
  1,
  'task deletion is audited'
);

select * from finish();
rollback;
