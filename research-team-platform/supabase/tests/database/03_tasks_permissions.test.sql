-- Task permissions: own / assigned rules, review workflow, assignment, admin.
begin;
\ir _helpers.psql
select plan(28);

select tests.setup_world();

-- ---------------------------------------------------------------------------
-- Member (template: tasks.view, tasks.create, tasks.edit_own, tasks.edit_assigned)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');

select lives_ok(
  format($$ update public.tasks set status = 'review', description = 'First draft finished' where id = %L $$, tests.uid('task_assigned_member')),
  'a member can edit a task assigned to them'
);

update public.tasks set title = 'Hacked title' where id = tests.uid('task_member2');

select lives_ok(
  format($$ update public.tasks set priority = 'high' where id = %L $$, tests.uid('task_own_member')),
  'a member with tasks.edit_own can edit a task they created'
);

delete from public.tasks where id = tests.uid('task_own_member');

select throws_ok(
  format($$ update public.tasks set status = 'completed' where id = %L $$, tests.uid('task_assigned_member')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a member cannot approve (complete) their own work'
);
select throws_ok(
  format($$ update public.tasks set assigned_to = %L where id = %L $$, tests.uid('member2'), tests.uid('task_assigned_member')),
  '42501', 'TASK_ASSIGN_FORBIDDEN',
  'a member without tasks.assign cannot re-assign a task'
);
select throws_ok(
  format($$ update public.tasks set project_id = %L where id = %L $$, tests.uid('project_b'), tests.uid('task_assigned_member')),
  '42501', null,
  'a task cannot be moved to another project'
);
select lives_ok(
  format($$ insert into public.tasks (project_id, title, assigned_to) values (%L, 'Self assigned task', %L) $$, tests.uid('project_a'), tests.uid('member')),
  'a member can create a task assigned to themselves'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, assigned_to) values (%L, 'Assigned to someone else', %L) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'TASK_ASSIGN_FORBIDDEN',
  'a member cannot assign a new task to someone else'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, created_by) values (%L, 'Spoofed creator', %L) $$, tests.uid('project_a'), tests.uid('owner')),
  '42501', null,
  'the creator of a task cannot be supplied by the client'
);
select throws_ok(
  format($$ insert into public.tasks (project_id, title, status) values (%L, 'Born completed', 'completed') $$, tests.uid('project_a')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a member cannot create a task directly in a final state'
);

select tests.clear_authentication();
select is(
  (select title from public.tasks where id = tests.uid('task_member2')),
  'Data Collection',
  'a member cannot edit a task created by and assigned to another user'
);
select is(
  (select count(*)::int from public.tasks where id = tests.uid('task_own_member')),
  1,
  'a member cannot delete tasks without tasks.delete (not even their own)'
);
select is(
  (select created_by from public.tasks where title = 'Self assigned task'),
  tests.uid('member'),
  'created_by is always the authenticated caller'
);
select is(
  (
    select count(*)::int from public.activity_logs
    where action = 'task.updated'
      and entity_id = tests.uid('task_assigned_member')
      and actor_id = tests.uid('member')
      and actor_name = 'Ahmad'
      and old_values ->> 'status' = 'in_progress'
      and new_values ->> 'status' = 'review'
  ),
  1,
  'a status change is audited with actor, old value and new value'
);

-- edit_own only: without tasks.edit_own a creator loses edit rights.
select tests.set_grants('project_a', 'member', array['project.view', 'tasks.view', 'tasks.edit_assigned']);
select tests.authenticate_as('member');
update public.tasks set title = 'Edited without edit_own' where id = tests.uid('task_own_member');
select tests.clear_authentication();
select is(
  (select title from public.tasks where id = tests.uid('task_own_member')),
  'Draft Methodology',
  'without tasks.edit_own a member cannot edit tasks they created'
);

-- edit_assigned only: without tasks.edit_assigned the assignee loses edit rights.
select tests.set_grants('project_a', 'member', array['project.view', 'tasks.view', 'tasks.edit_own']);
select tests.authenticate_as('member');
update public.tasks set title = 'Edited without edit_assigned' where id = tests.uid('task_assigned_member');
select lives_ok(
  format($$ update public.tasks set title = 'Methodology v2' where id = %L $$, tests.uid('task_own_member')),
  'with only tasks.edit_own a member still edits the tasks they created'
);
select tests.clear_authentication();
select is(
  (select title from public.tasks where id = tests.uid('task_assigned_member')),
  'Literature Review',
  'without tasks.edit_assigned a member cannot edit tasks assigned to them'
);

-- Visibility without tasks.view: only own / assigned tasks.
select tests.set_grants('project_a', 'member2', array['project.view', 'tasks.edit_assigned']);
select tests.authenticate_as('member2');
select results_eq(
  $$ select id from public.tasks order by id $$,
  format($$ values (%L::uuid) $$, tests.uid('task_member2')),
  'without tasks.view a member only sees tasks created by or assigned to them'
);

-- ---------------------------------------------------------------------------
-- Reviewer (tasks.view + tasks.review)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('reviewer');
select lives_ok(
  format($$ update public.tasks set status = 'completed' where id = %L $$, tests.uid('task_review')),
  'a reviewer can approve a task that is in review'
);
select throws_ok(
  format($$ update public.tasks set title = 'Reviewer rewrite' where id = %L $$, tests.uid('task_review')),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'a reviewer cannot edit the content of a task'
);
select throws_ok(
  format($$ update public.tasks set status = 'in_progress' where id = %L $$, tests.uid('task_own_member')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a reviewer cannot move tasks that are not under review'
);
select tests.clear_authentication();
select isnt(
  (select completed_at from public.tasks where id = tests.uid('task_review')),
  null,
  'completed_at is set when a task is approved'
);

-- ---------------------------------------------------------------------------
-- Manager (tasks.assign) assignment rules
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
select tests.clear_authentication();
select is(
  (
    select new_values ->> 'assignee_name' from public.activity_logs
    where action = 'task.assigned' and entity_id = tests.uid('task_own_member') and actor_id = tests.uid('manager')
  ),
  'Sara',
  'task assignment is audited with the assignee name'
);

-- ---------------------------------------------------------------------------
-- Owner / admin can edit everything
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select lives_ok(
  format(
    $$ update public.tasks
          set title = 'Reworked collection', status = 'rejected', priority = 'low',
              due_date = '2027-01-01', assigned_to = %L, description = 'Owner notes'
        where id = %L $$,
    tests.uid('reviewer'), tests.uid('task_member2')
  ),
  'the owner (admin) can edit every field of any task'
);
select lives_ok(
  format($$ update public.tasks set status = 'todo' where id = %L $$, tests.uid('task_member2')),
  'the owner can re-open a rejected task'
);
select lives_ok(
  format($$ delete from public.tasks where id = %L $$, tests.uid('task_member2')),
  'the owner can delete any task'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.activity_logs where action = 'task.deleted' and entity_id = tests.uid('task_member2') and actor_id = tests.uid('owner')),
  1,
  'task deletion is audited'
);

select * from finish();
rollback;
