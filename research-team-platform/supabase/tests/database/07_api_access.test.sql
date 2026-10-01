-- Direct API calls: anonymous requests and authenticated IDOR attempts.
begin;
\ir _helpers.psql
select plan(18);

select tests.setup_world();

-- ---------------------------------------------------------------------------
-- Unauthenticated requests (anon key only) are rejected
-- ---------------------------------------------------------------------------
select tests.authenticate_as_anon();
select throws_ok($$ select id from public.projects $$, '42501', null, 'anon cannot read projects');
select throws_ok($$ select id from public.tasks $$, '42501', null, 'anon cannot read tasks');
select throws_ok($$ select id from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select id from public.activity_logs $$, '42501', null, 'anon cannot read the activity log');
select throws_ok(
  format($$ insert into public.tasks (project_id, title) values (%L, 'Anonymous task') $$, tests.uid('project_a')),
  '42501', null,
  'anon cannot create tasks'
);
select throws_ok($$ select public.create_project('Anonymous project') $$, '42501', null, 'anon cannot call create_project()');
select throws_ok(
  format($$ select public.set_member_permissions(%L, %L, array['project.view']) $$, tests.uid('project_a'), tests.uid('member')),
  '42501', null,
  'anon cannot call set_member_permissions()'
);
select throws_ok($$ select * from public.get_my_project_access() $$, '42501', null, 'anon cannot call get_my_project_access()');
select is_empty(
  $$ select id from storage.objects where bucket_id = 'project-documents' $$,
  'anon cannot list stored documents'
);

-- ---------------------------------------------------------------------------
-- Authenticated users forging identifiers (IDOR)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok(
  format($$ select * from public.get_project_team(%L) $$, tests.uid('project_b')),
  '42501', 'PERMISSION_DENIED',
  'a user cannot read the team of a project they do not belong to'
);
select throws_ok(
  format($$ select public.add_project_member(%L, 'member@example.test', 'manager') $$, tests.uid('project_b')),
  '42501', 'PERMISSION_DENIED',
  'a user cannot add themselves to another project'
);
select throws_ok(
  format($$ select public.record_project_export(%L, 'json', 'project') $$, tests.uid('project_a')),
  '42501', 'PERMISSION_DENIED',
  'a user without data.export cannot export project data'
);
select is_empty(
  format($$ select * from public.get_my_project_access(%L) $$, tests.uid('project_b')),
  'access information is only returned for the caller''s own memberships'
);
select throws_ok(
  format($$ select public.admin_update_user_flags(%L, true, true) $$, tests.uid('member')),
  '42501', 'PERMISSION_DENIED',
  'a regular user cannot change platform flags'
);
select throws_ok(
  format($$ select public.bootstrap_platform_admin(%L) $$, tests.uid('member')),
  '42501', null,
  'end users cannot execute the service-only bootstrap function'
);
select throws_ok(
  format($$ select public.transfer_project_ownership(%L, %L) $$, tests.uid('project_b'), tests.uid('member')),
  '42501', 'PERMISSION_DENIED',
  'a user cannot take over another project'
);

select results_eq(
  format($$ select role::text, cardinality(permissions) > 0 from public.get_my_project_access(%L) $$, tests.uid('project_a')),
  $$ values ('member'::text, true) $$,
  'get_my_project_access() returns the caller''s effective access'
);

select tests.authenticate_as('owner');
select ok(
  (select count(*) from public.get_project_team(tests.uid('project_a'))) = 5,
  'the owner reads the full team overview'
);

select * from finish();
rollback;
