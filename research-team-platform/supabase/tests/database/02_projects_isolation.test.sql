-- Project creation rights and cross-project isolation.
begin;
\ir _helpers.psql
select plan(26);

select tests.setup_world();

-- ---------------------------------------------------------------------------
-- Creating projects
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok(
  $$ select public.create_project('Member side project') $$,
  '42501', 'PROJECT_CREATE_FORBIDDEN',
  'a regular member cannot create projects'
);
select throws_ok(
  $$ insert into public.projects (name) values ('Direct insert') $$,
  '42501', null,
  'projects cannot be inserted directly through the API'
);

select tests.authenticate_as('owner');
select lives_ok(
  $$ select public.create_project('Climate Study', 'Long description', 'Measure X', 'planning', '2026-10-01', '2027-03-01') $$,
  'a platform admin can create a project'
);
select is(
  (
    select count(*)::int
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where p.name = 'Climate Study' and pm.user_id = tests.uid('owner') and pm.role = 'owner'
  ),
  1,
  'the creator becomes the owner of the new project'
);
select is(
  (select count(*)::int from public.activity_logs where action = 'project.created' and entity_label = 'Climate Study' and actor_id = tests.uid('owner')),
  1,
  'project creation is written to the activity log with its actor'
);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
select tests.authenticate_as('outsider');
select is_empty($$ select id from public.projects $$, 'an outsider sees no project');
select is_empty($$ select id from public.tasks $$, 'an outsider sees no task');
select is_empty($$ select id from public.project_members $$, 'an outsider sees no membership');
select is_empty($$ select id from public.activity_logs $$, 'an outsider sees no activity');
select is_empty(
  $$ select id from public.profiles where id <> tests.uid('outsider') $$,
  'an outsider cannot enumerate other users'
);

select tests.authenticate_as('member');
select is_empty(
  format($$ select id from public.projects where id = %L $$, tests.uid('project_b')),
  'a user cannot access another project'
);
select is_empty(
  format($$ select id from public.tasks where project_id = %L $$, tests.uid('project_b')),
  'a user cannot read the tasks of another project'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title) values (%L, 'Injected task') $$, tests.uid('project_b')),
  '42501', 'PERMISSION_DENIED',
  'a user cannot create tasks in another project'
);
update public.tasks set title = 'Hijacked' where id = tests.uid('task_project_b');
select tests.clear_authentication();
select is(
  (select title from public.tasks where id = tests.uid('task_project_b')),
  'Confidential B task',
  'a user cannot modify the tasks of another project'
);

select tests.authenticate_as('owner');
select is_empty(
  format($$ select id from public.projects where id = %L $$, tests.uid('project_b')),
  'owning one project (even as platform admin) gives no access to other projects'
);

-- ---------------------------------------------------------------------------
-- Editing / deleting a project
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
update public.projects set name = 'Renamed by member' where id = tests.uid('project_a');

select tests.authenticate_as('manager');
select lives_ok(
  format($$ update public.projects set description = 'Updated by manager' where id = %L $$, tests.uid('project_a')),
  'a manager with project.edit can edit the project'
);
delete from public.projects where id = tests.uid('project_a');

select tests.clear_authentication();
select is((select name from public.projects where id = tests.uid('project_a')), 'Project A', 'a member without project.edit cannot rename the project');
select is((select count(*)::int from public.projects where id = tests.uid('project_a')), 1, 'a manager without project.delete cannot delete the project');
select is(
  (
    select count(*)::int from public.activity_logs
    where action = 'project.updated'
      and project_id = tests.uid('project_a')
      and old_values ->> 'description' = 'Main research project'
      and new_values ->> 'description' = 'Updated by manager'
  ),
  1,
  'project changes are audited with old and new values'
);

-- ---------------------------------------------------------------------------
-- project.view gate and suspension
-- ---------------------------------------------------------------------------
select tests.set_grants('project_a', 'member', array['tasks.view', 'tasks.edit_assigned']);
select tests.authenticate_as('member');
select is_empty(
  format($$ select id from public.tasks where project_id = %L $$, tests.uid('project_a')),
  'without project.view a member has no access to the project data'
);

select tests.clear_authentication();
update public.project_members set status = 'suspended'
 where project_id = tests.uid('project_a') and user_id = tests.uid('member2');
select tests.authenticate_as('member2');
select is_empty($$ select id from public.projects $$, 'a suspended member loses access to the project');
select is(
  (select status::text from public.project_members where user_id = tests.uid('member2')),
  'suspended',
  'a suspended member can still read their own membership status'
);

-- ---------------------------------------------------------------------------
-- Deleting a project keeps its audit trail
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select lives_ok(
  format($$ delete from public.projects where id = %L $$, tests.uid('project_a')),
  'the owner can delete the project'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.activity_logs where project_id = tests.uid('project_a') and action = 'project.deleted'),
  1,
  'project deletion is audited'
);
select ok(
  (select count(*) from public.activity_logs where project_id = tests.uid('project_a')) > 1,
  'the audit trail of a deleted project is retained'
);
select is(
  (select count(*)::int from public.activity_logs where project_id = tests.uid('project_a') and action = 'task.deleted'),
  0,
  'cascaded task deletions are summarised by the project.deleted entry'
);

select * from finish();
rollback;
