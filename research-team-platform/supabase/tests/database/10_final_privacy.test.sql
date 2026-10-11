-- NestHire Workspace final privacy hardening (migration 20261008000200):
-- self-review / self-approval / self-publication are limited to an active
-- project owner/manager or Director assigned to the task; reassignment privacy,
-- unauthorized file rename/delete,
-- external-link rules and former members.
--
--   owner ........ Director
--   manager ...... Team Lead / supervisor
--   member ....... Ahmed (first assignee)
--   member2 ...... Sara (new assignee after reassignment)
--   reviewer ..... independent reviewer (tasks.view + tasks.review)
begin;
\ir _helpers.psql
select plan(47);

select tests.setup_world();
update public.profiles set is_director = (id = tests.uid('owner'));

create temporary table ids (key text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create or replace function pg_temp.id(p_key text) returns uuid language sql as $$
  select id from ids where key = p_key;
$$;
create or replace function pg_temp.path(p_doc text, p_file text) returns text language sql as $$
  select '20000000-0000-4000-8000-00000000000a/' || p_doc || '/' || p_file;
$$;

-- ---------------------------------------------------------------------------
-- 1. The Director may self-review while assigned, and publication is explicit
-- ---------------------------------------------------------------------------
select tests.authenticate_as('owner');
insert into public.tasks (project_id, title, assigned_to) values (tests.uid('project_a'), 'Director own work', tests.uid('owner'));
insert into ids select 'dir', id from public.tasks where title = 'Director own work';
update public.tasks set status = 'in_progress' where id = pg_temp.id('dir');
select public.submit_task(pg_temp.id('dir'), 'Director result', '{}', '', '{}');

select tests.authenticate_as('owner');
select lives_ok(format($$ select public.start_task_review(%L) $$, pg_temp.id('dir')),
  'the Director may start review of their own assigned work');
select lives_ok(format($$ select public.review_task(%L, 'approved', 'Independent approval') $$, pg_temp.id('dir')),
  'the Director approves their own assigned work');
select lives_ok(format($$ select public.complete_task(%L, '') $$, pg_temp.id('dir')),
  'the Director must explicitly publish their approved work');

-- Reassigning does not open a back door for the Director either.
select tests.authenticate_as('owner');
insert into public.tasks (project_id, title, assigned_to) values (tests.uid('project_a'), 'Director reassigned work', tests.uid('owner'));
insert into ids select 'dir2', id from public.tasks where title = 'Director reassigned work';
update public.tasks set status = 'in_progress' where id = pg_temp.id('dir2');
select public.submit_task(pg_temp.id('dir2'), 'Director result 2', '{}', '', '{}');
update public.tasks set assigned_to = tests.uid('member2') where id = pg_temp.id('dir2');
select throws_ok(format($$ select public.start_task_review(%L) $$, pg_temp.id('dir2')),
  '42501', 'SELF_REVIEW_FORBIDDEN', 'the Director cannot review a version they submitted after reassigning the task');
select tests.authenticate_as('reviewer');
select public.start_task_review(pg_temp.id('dir2'));
select tests.authenticate_as('owner');
select throws_ok(format($$ select public.review_task(%L, 'approved') $$, pg_temp.id('dir2')),
  '42501', 'SELF_REVIEW_FORBIDDEN', 'nor approve it');

-- A manager responsible for a task cannot review it either.
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, assigned_to) values (tests.uid('project_a'), 'Lead task', tests.uid('manager'));
insert into ids select 'lead', id from public.tasks where title = 'Lead task';
update public.tasks set status = 'in_progress' where id = pg_temp.id('lead');
select public.submit_task(pg_temp.id('lead'), 'Lead result', '{}', '', '{}');
select lives_ok(format($$ select public.start_task_review(%L) $$, pg_temp.id('lead')),
  'the project manager may start review of their own assigned work');
select lives_ok(format($$ select public.review_task(%L, 'approved') $$, pg_temp.id('lead')),
  'the project manager may approve their own assigned work');
select lives_ok(format($$ select public.complete_task(%L, '') $$, pg_temp.id('lead')),
  'the project manager must explicitly publish their own approved work');

-- ---------------------------------------------------------------------------
-- 2. Reassignment privacy
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, description, assigned_to)
values (tests.uid('project_a'), 'Handover task', 'Instructions for whoever does it', tests.uid('member'));
insert into ids select 'ho', id from public.tasks where title = 'Handover task';
-- A supervisor reference file and an instruction comment for Ahmed.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', pg_temp.path('70000000-0000-4000-8000-000000000001', 'brief.pdf'), tests.uid('manager')::text,
   '{"size": 5, "mimetype": "application/pdf"}');
insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
values ('70000000-0000-4000-8000-000000000001', tests.uid('project_a'), pg_temp.id('ho'), 'Brief', 'brief.pdf',
        pg_temp.path('70000000-0000-4000-8000-000000000001', 'brief.pdf'));
insert into public.comments (project_id, task_id, content) values (tests.uid('project_a'), pg_temp.id('ho'), 'Ahmed: start with section 1');

select tests.authenticate_as('member');
update public.tasks set status = 'in_progress', progress = 60, work_notes = 'Ahmed private notes' where id = pg_temp.id('ho');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', pg_temp.path('70000000-0000-4000-8000-000000000002', 'ahmed.pdf'), tests.uid('member')::text,
   '{"size": 5, "mimetype": "application/pdf"}');
insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
values ('70000000-0000-4000-8000-000000000002', tests.uid('project_a'), pg_temp.id('ho'), 'Ahmed draft', 'ahmed.pdf',
        pg_temp.path('70000000-0000-4000-8000-000000000002', 'ahmed.pdf'));
insert into public.comments (project_id, task_id, content) values (tests.uid('project_a'), pg_temp.id('ho'), 'Ahmed question');
select public.submit_task(pg_temp.id('ho'), 'Ahmed v1', '{}', 'Ahmed internal note',
                          array['70000000-0000-4000-8000-000000000002']::uuid[]);

-- Unauthorized rename / delete of Ahmed's file by another member: nothing changes.
select tests.authenticate_as('member2');
update public.documents set title = 'hijacked' where id = '70000000-0000-4000-8000-000000000002';
delete from public.documents where id = '70000000-0000-4000-8000-000000000002';
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where name = pg_temp.path('70000000-0000-4000-8000-000000000002', 'ahmed.pdf');
select tests.clear_authentication();
select results_eq(
  $$ select d.title, (select count(*)::int from storage.objects o where o.name = d.storage_path)
     from public.documents d where d.id = '70000000-0000-4000-8000-000000000002' $$,
  $$ values ('Ahmed draft'::text, 1) $$,
  'another member cannot rename or delete a private file (row or Storage object)'
);

select tests.authenticate_as('manager');
select public.start_task_review(pg_temp.id('ho'));
select public.review_task(pg_temp.id('ho'), 'revision_required', 'Private feedback for Ahmed', 'Redo section 2');
-- Everything in a test shares one transaction timestamp; in production each
-- request is its own transaction. Date Ahmed's conversation one hour earlier.
select tests.clear_authentication();
update public.comments set created_at = now() - interval '1 hour' where task_id = pg_temp.id('ho');
select tests.authenticate_as('manager');
-- Reassignment to Sara.
update public.tasks set assigned_to = tests.uid('member2') where id = pg_temp.id('ho');
insert into public.comments (project_id, task_id, content) values (tests.uid('project_a'), pg_temp.id('ho'), 'Sara: please continue');

select tests.clear_authentication();
select results_eq(
  format($$ select progress::int, work_notes, assigned_at is not null from public.tasks where id = %L $$, pg_temp.id('ho')),
  $$ values (0, ''::text, true) $$,
  'reassignment clears the previous assignee''s private notes and progress and starts a new window'
);
select ok(
  exists (
    select 1 from public.activity_logs
    where entity_id = (select id from ids where key = 'ho') and action = 'task.progress_updated'
      and old_values ->> 'work_notes' = 'Ahmed private notes'
  ),
  'the cleared notes remain in the audit log for supervisors'
);

-- The previous assignee loses the private workflow entirely.
select tests.authenticate_as('member');
select is_empty(format($$ select id from public.tasks where id = %L $$, pg_temp.id('ho')), 'old assignee: task gone');
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, pg_temp.id('ho')), 'old assignee: own versions gone');
select is_empty(format($$ select id from public.task_reviews where task_id = %L $$, pg_temp.id('ho')), 'old assignee: reviews gone');
select is_empty(format($$ select id from public.comments where task_id = %L $$, pg_temp.id('ho')), 'old assignee: comments gone');
select is_empty(format($$ select id from public.documents where task_id = %L $$, pg_temp.id('ho')), 'old assignee: files gone');
select is_empty($$ select name from storage.objects where name like '%/ahmed.pdf' $$, 'old assignee: Storage object gone');
select throws_ok(format($$ select public.submit_task(%L, 'late', '{}', '', '{}') $$, pg_temp.id('ho')),
  'P0002', 'NOT_FOUND', 'old assignee: cannot submit any more');

-- The new assignee sees what is needed to continue — not the earlier private work.
select tests.authenticate_as('member2');
select results_eq(
  format($$ select description, work_notes from public.tasks where id = %L $$, pg_temp.id('ho')),
  $$ values ('Instructions for whoever does it'::text, ''::text) $$,
  'new assignee: sees the instructions, not the previous notes'
);
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, pg_temp.id('ho')),
  'new assignee: previous private versions are NOT exposed');
select is_empty(format($$ select id from public.task_reviews where task_id = %L $$, pg_temp.id('ho')),
  'new assignee: previous private review feedback is NOT exposed');
select results_eq(
  format($$ select content from public.comments where task_id = %L order by created_at $$, pg_temp.id('ho')),
  $$ values ('Sara: please continue'::text) $$,
  'new assignee: only comments of the current assignment'
);
select results_eq(
  format($$ select title from public.documents where task_id = %L order by title $$, pg_temp.id('ho')),
  $$ values ('Brief'::text) $$,
  'new assignee: supervisor reference file yes, previous assignee''s file no'
);
select is_empty($$ select name from storage.objects where name like '%/ahmed.pdf' $$,
  'new assignee: previous assignee''s Storage object stays private');
select is(
  (select count(*)::int from storage.objects where name like '%/brief.pdf'),
  1,
  'new assignee: the reference file object is readable'
);

-- Supervisors keep the full history.
select tests.authenticate_as('manager');
select is((select count(*)::int from public.task_submissions where task_id = pg_temp.id('ho')), 1, 'supervisor: earlier versions retained');
select is((select count(*)::int from public.task_reviews where task_id = pg_temp.id('ho')), 1, 'supervisor: review history retained');
select is((select count(*)::int from public.comments where task_id = pg_temp.id('ho')), 3, 'supervisor: whole conversation retained');
select is((select count(*)::int from public.documents where task_id = pg_temp.id('ho')), 2, 'supervisor: all files retained');

-- Sara continues and produces V2; the team gets V2 only.
select tests.authenticate_as('member2');
update public.tasks set status = 'in_progress' where id = pg_temp.id('ho');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', pg_temp.path('70000000-0000-4000-8000-000000000003', 'sara.pdf'), tests.uid('member2')::text,
   '{"size": 5, "mimetype": "application/pdf"}');
insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
values ('70000000-0000-4000-8000-000000000003', tests.uid('project_a'), pg_temp.id('ho'), 'Sara final', 'sara.pdf',
        pg_temp.path('70000000-0000-4000-8000-000000000003', 'sara.pdf'));
select throws_ok(
  format($$ select public.submit_task(%L, 'v2', '{}', '', array['70000000-0000-4000-8000-000000000002']::uuid[]) $$, pg_temp.id('ho')),
  '22023', 'TASK_FILE_INVALID', 'the new assignee cannot hand in the previous assignee''s file');
select lives_ok(
  format($$ select public.submit_task(%L, 'Sara v2', array['https://example.com/report'], '', array['70000000-0000-4000-8000-000000000003']::uuid[]) $$, pg_temp.id('ho')),
  'the new assignee submits version 2');
select results_eq(
  format($$ select version from public.task_submissions where task_id = %L $$, pg_temp.id('ho')),
  $$ values (2) $$,
  'new assignee: sees only their own version'
);

select tests.authenticate_as('manager');
select public.start_task_review(pg_temp.id('ho'));
select public.review_task(pg_temp.id('ho'), 'approved', 'Good');
select lives_ok(format($$ select public.complete_task(%L, '') $$, pg_temp.id('ho')), 'V2 is published');

select tests.authenticate_as('member');
select results_eq(
  format($$ select final_result, final_submission_version from public.task_publications where task_id = %L $$, pg_temp.id('ho')),
  $$ values ('Sara v2'::text, 2) $$,
  'the team (incl. the old assignee) sees only the final publication'
);
select results_eq(
  format($$ select title from public.documents where task_id = %L $$, pg_temp.id('ho')),
  $$ values ('Sara final'::text) $$,
  'the team reads only the published file'
);
select is_empty($$ select name from storage.objects where name like '%/ahmed.pdf' or name like '%/brief.pdf' $$,
  'draft and reference objects stay private after publication');

-- ---------------------------------------------------------------------------
-- 3. External links are references, never Storage or credentialed URLs
-- ---------------------------------------------------------------------------
select tests.clear_authentication();
insert into public.tasks (project_id, title, assigned_to, created_by)
values (tests.uid('project_a'), 'Links task', tests.uid('member'), tests.uid('manager'));
insert into ids select 'links', id from public.tasks where title = 'Links task';
select tests.authenticate_as('member');
update public.tasks set status = 'in_progress' where id = pg_temp.id('links');
select throws_ok(format($$ select public.submit_task(%L, 's', array['http://example.com/x'], '', '{}') $$, pg_temp.id('links')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN', 'plain http links are refused');
select throws_ok(format($$ select public.submit_task(%L, 's', array['https://user:secret@example.com/x'], '', '{}') $$, pg_temp.id('links')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN', 'links with embedded credentials are refused');
select throws_ok(format($$ select public.submit_task(%L, 's', array['https://example.com:bad/x'], '', '{}') $$, pg_temp.id('links')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN', 'a non-numeric URL port is refused');
select throws_ok(format($$ select public.submit_task(%L, 's', array['https://example.com:99999/x'], '', '{}') $$, pg_temp.id('links')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN', 'a port outside the valid range is refused');
select throws_ok(format($$ select public.submit_task(%L, 's', array['https://abc.supabase.co/storage/v1/object/sign/x?token=y'], '', '{}') $$, pg_temp.id('links')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN', 'Storage URLs are refused');
select lives_ok(format($$ select public.submit_task(%L, 's', array['https://github.com/org/repo/pull/1'], '', '{}') $$, pg_temp.id('links')),
  'an https external reference is accepted (as a reference only)');

-- ---------------------------------------------------------------------------
-- 4. Former members and comment IDOR
-- ---------------------------------------------------------------------------
select tests.clear_authentication();
update public.project_members set status = 'suspended' where project_id = tests.uid('project_a') and user_id = tests.uid('member');
select tests.authenticate_as('member');
select is_empty(format($$ select id from public.tasks where id = %L $$, pg_temp.id('links')), 'a suspended member loses their own task');
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, pg_temp.id('links')), 'and its versions');
select throws_ok(format($$ select public.submit_task(%L, 's2', '{}', '', '{}') $$, pg_temp.id('links')),
  'P0002', 'NOT_FOUND', 'and cannot act on it');

select tests.authenticate_as('other_owner');
select is_empty(format($$ select id from public.comments where task_id = %L $$, pg_temp.id('ho')), 'Project B: no access to Project A task comments by UUID');
select is_empty(format($$ select id from public.documents where task_id = %L $$, pg_temp.id('ho')), 'Project B: no access to Project A files by UUID');

select * from finish();
rollback;
