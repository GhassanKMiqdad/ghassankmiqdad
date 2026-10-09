begin;
\ir _helpers.psql
select plan(8);

select tests.setup_world();
select tests.authenticate_as('owner');

select is(
  (select allowed from public.check_project_export_rate_limit(tests.uid('project_a'), 2, 60)),
  true,
  'the first export is allowed'
);
select is(
  (select allowed from public.check_project_export_rate_limit(tests.uid('project_a'), 2, 60)),
  true,
  'the second export is allowed within the window'
);
select is(
  (select allowed from public.check_project_export_rate_limit(tests.uid('project_a'), 2, 60)),
  false,
  'the third export is rejected within the window'
);
select cmp_ok(
  (select retry_after from public.check_project_export_rate_limit(tests.uid('project_a'), 2, 60)),
  '>=', 1,
  'a rejected export returns a positive retry interval'
);
select is(
  (select allowed from public.check_project_export_rate_limit(tests.uid('project_b'), 2, 60)),
  true,
  'the limit is scoped to the project as well as the user'
);
select tests.authenticate_as('manager');
select is(
  (select allowed from public.check_project_export_rate_limit(tests.uid('project_a'), 2, 60)),
  true,
  'a different user has an independent bucket'
);
select throws_ok(
  $$ select public.check_project_export_rate_limit(tests.uid('project_a'), 0, 60) $$,
  'P0001', 'INVALID_INPUT',
  'invalid limits are rejected'
);
select throws_ok(
  $$ select public.check_project_export_rate_limit(tests.uid('project_a'), 2, 86401) $$,
  'P0001', 'INVALID_INPUT',
  'invalid windows are rejected'
);

select * from finish();
rollback;
