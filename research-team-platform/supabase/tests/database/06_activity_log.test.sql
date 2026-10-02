-- Activity log: visibility, immutability, request metadata.
begin;
\ir _helpers.psql
select plan(14);

select tests.setup_world();

-- Activity produced through the API with forwarded request metadata.
select set_config(
  'request.headers',
  '{"x-client-ip": "203.0.113.7", "x-client-user-agent": "Mozilla/5.0 (Test)", "x-forwarded-for": "10.0.0.1"}',
  true
);
select tests.authenticate_as('member');
update public.tasks set status = 'review' where id = tests.uid('task_assigned_member');
select tests.authenticate_as('owner');
update public.tasks set priority = 'critical' where id = tests.uid('task_member2');
select set_config('request.headers', '{"x-forwarded-for": "not-an-ip, 10.0.0.2"}', true);
update public.tasks set priority = 'low' where id = tests.uid('task_member2');

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select is(
  (select count(*)::int from public.activity_logs where actor_id is distinct from tests.uid('member')),
  0,
  'a member without activity.view only sees their own actions'
);
select is(
  (select count(*)::int from public.activity_logs where actor_id = tests.uid('member')),
  1,
  'a member sees their own actions'
);

select tests.authenticate_as('owner');
select ok(
  (select count(*) from public.activity_logs where project_id = tests.uid('project_a') and actor_id is distinct from tests.uid('owner')) >= 1,
  'the owner sees the full activity log of the project'
);

select tests.set_grants('project_a', 'manager', array['project.view', 'activity.view']);
select tests.authenticate_as('manager');
select ok(
  (select count(*) from public.activity_logs where project_id = tests.uid('project_a')) >= 3,
  'a member granted activity.view sees the full project log'
);
select is_empty(
  format($$ select id from public.activity_logs where project_id = %L $$, tests.uid('project_b')),
  'activity.view in one project does not reveal the log of another project'
);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
select throws_ok(
  $$ insert into public.activity_logs (action, entity_type) values ('task.updated', 'task') $$,
  '42501', null,
  'clients cannot forge audit entries'
);
select throws_ok(
  $$ update public.activity_logs set action = 'task.created' $$,
  '42501', null,
  'clients (even the owner) cannot modify audit entries'
);
select throws_ok(
  $$ delete from public.activity_logs $$,
  '42501', null,
  'clients (even the owner) cannot delete audit entries'
);

select tests.clear_authentication();
select throws_ok(
  $$ update public.activity_logs set action = 'task.created' $$,
  '42501', 'ACTIVITY_LOG_IMMUTABLE',
  'the audit trail is immutable even for privileged database roles'
);
select throws_ok(
  $$ delete from public.activity_logs $$,
  '42501', 'ACTIVITY_LOG_IMMUTABLE',
  'audit entries cannot be deleted even by privileged database roles'
);
select throws_ok(
  $$ truncate public.activity_logs $$,
  '42501', 'ACTIVITY_LOG_IMMUTABLE',
  'the audit table cannot be truncated'
);

-- ---------------------------------------------------------------------------
-- Request metadata
-- ---------------------------------------------------------------------------
select results_eq(
  format(
    $$ select host(ip_address), user_agent from public.activity_logs where actor_id = %L and action = 'task.updated' $$,
    tests.uid('member')
  ),
  $$ values ('203.0.113.7'::text, 'Mozilla/5.0 (Test)'::text) $$,
  'the client IP address and user agent forwarded by the server are recorded'
);
select is(
  (
    select count(*)::int from public.activity_logs
    where actor_id = tests.uid('owner') and action = 'task.updated' and new_values ->> 'priority' = 'low' and ip_address is null
  ),
  1,
  'malformed IP addresses are ignored instead of failing the operation'
);
select is(
  (select actor_email from public.activity_logs where actor_id = tests.uid('owner') limit 1),
  'owner@example.test',
  'the actor e-mail is snapshotted on every entry'
);

select * from finish();
rollback;
