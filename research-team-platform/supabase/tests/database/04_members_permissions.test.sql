-- Membership management, permission management and privilege escalation.
begin;
\ir _helpers.psql
select plan(39);

select tests.setup_world();

-- ---------------------------------------------------------------------------
-- A member cannot modify permissions, by RPC or by writing tables directly
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['tasks.edit']) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'PERMISSION_DENIED',
  'a user without permissions.manage cannot modify permissions'
);
select throws_ok(
  format($$ insert into public.user_permissions (project_id, user_id, permission_key) values (%L, %L, 'tasks.delete') $$, tests.uid('project_a'), tests.uid('member')),
  '42501', null,
  'a user cannot grant permissions by inserting rows directly'
);
select throws_ok(
  format($$ delete from public.user_permissions where user_id = %L $$, tests.uid('member2')),
  '42501', null,
  'a user cannot revoke permissions by deleting rows directly'
);
select throws_ok(
  format($$ update public.project_members set role = 'owner' where user_id = %L $$, tests.uid('member')),
  '42501', null,
  'a user cannot promote themselves by updating project_members'
);
select throws_ok(
  $$ update public.profiles set is_platform_admin = true where id = auth.uid() $$,
  '42501', null,
  'a user cannot make themselves platform admin'
);
select throws_ok(
  format($$ select public.add_project_member(%L, 'newcomer@example.test', 'member') $$, tests.uid('project_a')),
  '42501', 'PERMISSION_DENIED',
  'a member without members.add cannot add members'
);
select throws_ok(
  format($$ select public.remove_project_member(%L, %L) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'PERMISSION_DENIED',
  'a member without members.remove cannot remove members'
);

-- ---------------------------------------------------------------------------
-- Owner manages permissions; every change is audited old -> new
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select lives_ok(
  format(
    $$ select public.set_member_permissions(%L, %L, array['project.view', 'tasks.view', 'tasks.edit', 'tasks.edit_assigned', 'team.view']) $$,
    tests.uid('project_a'), tests.uid('member')
  ),
  'the owner can change the permissions of a member'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['tasks.view']) $$, tests.uid('project_a'), tests.uid('owner')),
  '42501', 'CANNOT_MODIFY_OWNER',
  'the owner''s permissions cannot be modified'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view', 'tasks.fly']) $$, tests.uid('project_a'), tests.uid('member')),
  '22023', 'UNKNOWN_PERMISSION',
  'unknown permission keys are rejected'
);
select tests.clear_authentication();
select results_eq(
  format($$ select permission_key from public.user_permissions where project_id = %L and user_id = %L order by permission_key $$, tests.uid('project_a'), tests.uid('member')),
  $$ values ('project.view'), ('tasks.edit'), ('tasks.edit_assigned'), ('tasks.view'), ('team.view') $$,
  'the new permission set is stored exactly'
);
select results_eq(
  format(
    $$ select old_values ->> 'tasks.edit', new_values ->> 'tasks.edit', old_values ->> 'documents.upload', new_values ->> 'documents.upload', actor_id
         from public.activity_logs
        where action = 'permissions.changed' and entity_id = %L $$,
    tests.uid('member')
  ),
  format($$ values ('false', 'true', 'true', 'false', %L::uuid) $$, tests.uid('owner')),
  'a permission change is audited as old/new values with the admin who made it'
);

-- ---------------------------------------------------------------------------
-- Anti privilege-escalation rules for a manager holding permissions.manage
-- ---------------------------------------------------------------------------
select tests.set_grants(
  'project_a', 'manager',
  array['project.view', 'team.view', 'tasks.view', 'tasks.edit', 'permissions.manage', 'members.add', 'members.remove', 'members.manage']
);
select tests.authenticate_as('manager');
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view', 'tasks.view', 'project.delete']) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'PERMISSION_ESCALATION',
  'a manager cannot grant a permission they do not hold'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view']) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'PERMISSION_ESCALATION',
  'a manager cannot revoke permissions outside their own set'
);
select lives_ok(
  format(
    $$ select public.set_member_permissions(%L, %L, array['project.view', 'tasks.view', 'tasks.edit_assigned', 'documents.view', 'documents.upload', 'comments.create', 'team.view', 'tasks.edit']) $$,
    tests.uid('project_a'), tests.uid('member2')
  ),
  'a manager can grant permissions they hold to a lower-ranked member'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view', 'tasks.delete']) $$, tests.uid('project_a'), tests.uid('manager')),
  '42501', 'CANNOT_MODIFY_SELF',
  'nobody can change their own permissions'
);
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view']) $$, tests.uid('project_a'), tests.uid('owner')),
  '42501', 'CANNOT_MODIFY_OWNER',
  'a manager cannot change the owner''s permissions'
);
select throws_ok(
  format($$ select public.update_project_member(%L, %L, 'manager') $$, tests.uid('project_a'), tests.uid('member')),
  '42501', 'ROLE_NOT_ALLOWED',
  'a manager cannot promote somebody to their own rank'
);
select throws_ok(
  format($$ select public.add_project_member(%L, 'newcomer@example.test', 'manager') $$, tests.uid('project_a')),
  '42501', 'ROLE_NOT_ALLOWED',
  'a manager cannot add a member with a role equal to their own'
);

-- Second manager: peers cannot manage each other.
select tests.authenticate_as('owner');
select lives_ok(
  format($$ select public.update_project_member(%L, %L, 'manager') $$, tests.uid('project_a'), tests.uid('member2')),
  'the owner can promote a member to manager'
);
select tests.authenticate_as('manager');
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view']) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'INSUFFICIENT_RANK',
  'a manager cannot change the permissions of another manager'
);
select throws_ok(
  format($$ select public.remove_project_member(%L, %L) $$, tests.uid('project_a'), tests.uid('member2')),
  '42501', 'INSUFFICIENT_RANK',
  'a manager cannot remove another manager'
);
select throws_ok(
  format($$ select public.remove_project_member(%L, %L) $$, tests.uid('project_a'), tests.uid('owner')),
  '42501', 'CANNOT_MODIFY_OWNER',
  'nobody can remove the project owner'
);

-- ---------------------------------------------------------------------------
-- Adding and removing members
-- ---------------------------------------------------------------------------
select lives_ok(
  format($$ select public.add_project_member(%L, 'NEWCOMER@example.test', 'member') $$, tests.uid('project_a')),
  'a manager with members.add can add a member (e-mail matched case-insensitively)'
);
select throws_ok(
  format($$ select public.add_project_member(%L, 'newcomer@example.test', 'member') $$, tests.uid('project_a')),
  '23505', 'ALREADY_MEMBER',
  'a user cannot be added twice'
);
select throws_ok(
  format($$ select public.add_project_member(%L, 'nobody@example.test', 'member') $$, tests.uid('project_a')),
  'P0002', 'USER_NOT_FOUND',
  'unknown e-mails are reported so the server can send an invitation'
);
select tests.clear_authentication();
select results_eq(
  format($$ select permission_key from public.user_permissions where project_id = %L and user_id = %L order by permission_key $$, tests.uid('project_a'), tests.uid('newcomer')),
  $$ values ('project.view'), ('team.view') $$,
  'initial permissions are the role template limited to what the adding manager holds'
);

update public.tasks set assigned_to = tests.uid('newcomer') where id = tests.uid('task_own_member');

select tests.authenticate_as('manager');
select lives_ok(
  format($$ select public.remove_project_member(%L, %L) $$, tests.uid('project_a'), tests.uid('newcomer')),
  'a manager with members.remove can remove a lower-ranked member'
);
select tests.clear_authentication();
select is(
  (select assigned_to from public.tasks where id = tests.uid('task_own_member')),
  null,
  'tasks of a removed member are un-assigned'
);
select is(
  (
    select metadata ->> 'reason' from public.activity_logs
    where action = 'task.assigned'
      and entity_id = tests.uid('task_own_member')
      and new_values ->> 'assigned_to' is null
  ),
  'member_removed',
  'the automatic un-assignment is audited with its reason'
);
select is(
  (select count(*)::int from public.user_permissions where user_id = tests.uid('newcomer')),
  0,
  'the permissions of a removed member are deleted'
);
select is(
  (select count(*)::int from public.activity_logs where action in ('member.added', 'member.removed') and entity_id = tests.uid('newcomer')),
  2,
  'adding and removing a member are audited'
);

-- ---------------------------------------------------------------------------
-- Role change resets permissions; suspension revokes access
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select lives_ok(
  format($$ select public.update_project_member(%L, %L, 'reviewer') $$, tests.uid('project_a'), tests.uid('member')),
  'the owner can change the role of a member'
);
select tests.clear_authentication();
select results_eq(
  format($$ select permission_key from public.user_permissions where project_id = %L and user_id = %L order by permission_key $$, tests.uid('project_a'), tests.uid('member')),
  $$ select permission_key from public.role_permissions where role = 'reviewer' order by permission_key $$,
  'changing the role applies the role template'
);

select tests.authenticate_as('owner');
select lives_ok(
  format($$ select public.update_project_member(%L, %L, null, 'suspended') $$, tests.uid('project_a'), tests.uid('reviewer')),
  'the owner can suspend a member'
);
select tests.authenticate_as('reviewer');
select is_empty($$ select id from public.tasks $$, 'a suspended member immediately loses access');

-- ---------------------------------------------------------------------------
-- Ownership transfer
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
select throws_ok(
  format($$ select public.transfer_project_ownership(%L, %L) $$, tests.uid('project_a'), tests.uid('manager')),
  '42501', 'PERMISSION_DENIED',
  'only the owner can transfer ownership'
);
select tests.authenticate_as('owner');
select lives_ok(
  format($$ select public.transfer_project_ownership(%L, %L) $$, tests.uid('project_a'), tests.uid('manager')),
  'the owner can transfer ownership to an active member'
);
select tests.clear_authentication();
select results_eq(
  format($$ select user_id, role::text from public.project_members where project_id = %L and user_id in (%L, %L) order by role $$, tests.uid('project_a'), tests.uid('owner'), tests.uid('manager')),
  format($$ values (%L::uuid, 'manager'), (%L::uuid, 'owner') $$, tests.uid('owner'), tests.uid('manager')),
  'ownership moved and the previous owner became a manager'
);

select * from finish();
rollback;
