-- NestHire Workspace security hardening (migration 20261008000100):
-- IDOR on every private workflow object, strict review state machine,
-- self-approval / self-publication, version privacy, private task files and
-- their Storage objects, sanitized publication.
--
--   manager ...... supervisor (tasks.view / review / assign / edit)
--   member ....... "Ahmed": responsible for the private task
--   member2 ...... another member of the same project
--   other_owner .. owner of Project B (no access to Project A)
begin;
\ir _helpers.psql
select plan(60);

select tests.setup_world();
update public.profiles set is_director = (id = tests.uid('owner'));

create temporary table ids (key text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

-- Fixture files: F1 (draft, version 1), F2 (final, version 2), LIB (project library).
insert into ids values
  ('f1', '60000000-0000-4000-8000-000000000001'),
  ('f2', '60000000-0000-4000-8000-000000000002'),
  ('lib', '60000000-0000-4000-8000-000000000003');
create or replace function pg_temp.path(p_key text, p_file text) returns text language sql as $$
  select '20000000-0000-4000-8000-00000000000a/' || (select id from ids where key = p_key) || '/' || p_file;
$$;

-- ---------------------------------------------------------------------------
-- The manager assigns a private task to Ahmed, who starts working on it.
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, description, assigned_to)
values (tests.uid('project_a'), 'Private analysis', 'Confidential instructions', tests.uid('member'));
insert into ids select 'task', id from public.tasks where title = 'Private analysis';
insert into public.comments (project_id, task_id, content)
values (tests.uid('project_a'), (select id from ids where key = 'task'), 'Manager private instruction');
insert into ids select 'c_manager', id from public.comments where content = 'Manager private instruction';

select tests.authenticate_as('member');
update public.tasks set status = 'in_progress' where id = (select id from ids where key = 'task');
insert into public.comments (project_id, task_id, content)
values (tests.uid('project_a'), (select id from ids where key = 'task'), 'Ahmed private question');
insert into ids select 'c_member', id from public.comments where content = 'Ahmed private question';

-- Ahmed uploads a private task file and a project-library file.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', pg_temp.path('f1', 'draft.pdf'), tests.uid('member')::text, '{"size": 10, "mimetype": "application/pdf"}'),
  ('project-documents', pg_temp.path('lib', 'shared.pdf'), tests.uid('member')::text, '{"size": 10, "mimetype": "application/pdf"}');
select lives_ok(
  format(
    $$ insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
       values (%L, %L, %L, 'Draft', 'draft.pdf', %L) $$,
    (select id from ids where key = 'f1'), tests.uid('project_a'), (select id from ids where key = 'task'), pg_temp.path('f1', 'draft.pdf')
  ),
  'the responsible member attaches a private file to the task'
);
insert into public.documents (id, project_id, title, file_name, storage_path)
values ((select id from ids where key = 'lib'), tests.uid('project_a'), 'Shared', 'shared.pdf', pg_temp.path('lib', 'shared.pdf'));

select tests.authenticate_as('member2');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', '20000000-0000-4000-8000-00000000000a/60000000-0000-4000-8000-000000000009/x.pdf',
   tests.uid('member2')::text, '{"size": 1, "mimetype": "application/pdf"}');
select throws_ok(
  format(
    $$ insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
       values ('60000000-0000-4000-8000-000000000009', %L, %L, 'Intruder', 'x.pdf', %L) $$,
    tests.uid('project_a'), (select id from ids where key = 'task'),
    '20000000-0000-4000-8000-00000000000a/60000000-0000-4000-8000-000000000009/x.pdf'
  ),
  '42501', null,
  'another member cannot attach files to someone else''s task'
);

-- ---------------------------------------------------------------------------
-- Submission V1 (with its file); input validation
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select throws_ok(
  format($$ select public.submit_task(%L, 'v1', '{}', '', array[%L]::uuid[]) $$,
         (select id from ids where key = 'task'), (select id from ids where key = 'lib')),
  '22023', 'TASK_FILE_INVALID',
  'a submission can only reference files of its own task'
);
select throws_ok(
  format($$ select public.submit_task(%L, 'v1', array['https://x.supabase.co/storage/v1/object/sign/project-documents/a?token=1'], '', '{}') $$,
         (select id from ids where key = 'task')),
  '22023', 'DELIVERABLE_LINK_FORBIDDEN',
  'a storage URL cannot be passed off as an external deliverable link'
);
select lives_ok(
  format($$ select public.submit_task(%L, 'Draft v1', array['https://example.com/v1'], 'internal note v1', array[%L]::uuid[]) $$,
         (select id from ids where key = 'task'), (select id from ids where key = 'f1')),
  'Ahmed submits version 1 with his private file'
);
insert into ids select 's1', id from public.task_submissions where task_id = (select id from ids where key = 'task') and version = 1;

-- A submitted file is evidence.
select throws_ok(
  format($$ delete from public.documents where id = %L $$, (select id from ids where key = 'f1')),
  '42501', 'DOCUMENT_LOCKED',
  'a file handed in with a version cannot be deleted'
);
select throws_ok(
  format($$ update public.documents set title = 'Rewritten' where id = %L $$, (select id from ids where key = 'f1')),
  '42501', 'DOCUMENT_LOCKED',
  'a file handed in with a version cannot be edited'
);

-- ---------------------------------------------------------------------------
-- IDOR — Scenarios A to E (the attacker knows every UUID)
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member2');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')),
  'A: another member cannot read the private task by UUID');
select is_empty(format($$ select id from public.task_submissions where id = %L $$, (select id from ids where key = 's1')),
  'B: another member cannot read the submission by UUID');
select is_empty(format($$ select id from public.comments where id in (%L, %L) $$,
                       (select id from ids where key = 'c_manager'), (select id from ids where key = 'c_member')),
  'D: another member cannot read private task comments by UUID');
select is_empty(format($$ select id from public.documents where id = %L $$, (select id from ids where key = 'f1')),
  'another member cannot read the private file record');
select is_empty(format($$ select name from storage.objects where name = %L $$, pg_temp.path('f1', 'draft.pdf')),
  'another member cannot read (or sign a URL for) the private file object');
select is(
  (select count(*)::int from public.documents where id = (select id from ids where key = 'lib')),
  1,
  'the project library stays readable by project members'
);
update public.comments set content = 'tampered' where id = (select id from ids where key = 'c_manager');
delete from public.comments where id = (select id from ids where key = 'c_member');
select throws_ok(
  format($$ select public.start_task_review(%L) $$, (select id from ids where key = 'task')),
  'P0002', 'NOT_FOUND',
  'another member cannot even locate the task through a workflow function'
);

select tests.authenticate_as('other_owner');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')),
  'E: a Project B member cannot read a Project A task by UUID');
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, (select id from ids where key = 'task')),
  'E: nor its submissions');
select is_empty(format($$ select id from public.documents where project_id = %L $$, tests.uid('project_a')),
  'E: nor any Project A file');
select tests.clear_authentication();
select results_eq(
  format($$ select content from public.comments where id in (%L, %L) order by content $$,
         (select id from ids where key = 'c_manager'), (select id from ids where key = 'c_member')),
  $$ values ('Ahmed private question'::text), ('Manager private instruction'::text) $$,
  'blind UPDATE / DELETE by UUID on private comments changes nothing'
);

-- ---------------------------------------------------------------------------
-- Scenario F — Ahmed reads his own work but cannot approve or publish it
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select is(
  (select count(*)::int from public.task_submissions where id = (select id from ids where key = 's1')),
  1,
  'F: Ahmed reads his own submission'
);
select throws_ok(format($$ select public.start_task_review(%L) $$, (select id from ids where key = 'task')),
  '42501', 'PERMISSION_DENIED', 'F: Ahmed cannot start the review of his own work');
select throws_ok(format($$ select public.review_task(%L, 'approved') $$, (select id from ids where key = 'task')),
  '42501', 'PERMISSION_DENIED', 'F: Ahmed cannot approve his own work');
select throws_ok(format($$ select public.complete_task(%L, '') $$, (select id from ids where key = 'task')),
  '42501', 'PERMISSION_DENIED', 'F: Ahmed cannot publish his own work');
select throws_ok(
  format($$ update public.tasks set status = 'approved' where id = %L $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'F: Ahmed cannot approve through a direct update');

-- ---------------------------------------------------------------------------
-- Strict state machine: SUBMITTED → UNDER_REVIEW → decision
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
select throws_ok(format($$ select public.review_task(%L, 'approved') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'a submitted version cannot be approved before its review starts');
select throws_ok(format($$ select public.complete_task(%L, '') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'an unapproved submission cannot be published');
select lives_ok(format($$ select public.start_task_review(%L) $$, (select id from ids where key = 'task')),
  'the manager starts the review');
select lives_ok(
  format($$ select public.review_task(%L, 'revision_required', 'Private feedback: redo section 2', 'Fix section 2') $$,
         (select id from ids where key = 'task')),
  'the manager requests a revision with private feedback'
);
insert into ids select 'r1', id from public.task_reviews where task_id = (select id from ids where key = 'task');
select throws_ok(format($$ select public.complete_task(%L, '') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'a revision-required submission cannot be published');
select throws_ok(format($$ select public.review_task(%L, 'approved') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'a version sent back for revision cannot be approved afterwards');

select tests.authenticate_as('member2');
select is_empty(format($$ select id from public.task_reviews where id = %L $$, (select id from ids where key = 'r1')),
  'C: another member cannot read the review (revision feedback) by UUID');

select tests.authenticate_as('member');
select is(
  (select comment from public.task_reviews where id = (select id from ids where key = 'r1')),
  'Private feedback: redo section 2',
  'Ahmed reads the feedback he needs for the revision'
);
select throws_ok(
  format($$ update public.task_reviews set comment = 'Approved!' where id = %L $$, (select id from ids where key = 'r1')),
  '42501', null,
  'Ahmed cannot modify the manager''s review'
);

-- Immutable records, even for trusted code paths.
select tests.clear_authentication();
select throws_ok(
  format($$ update public.task_reviews set comment = 'rewritten' where id = %L $$, (select id from ids where key = 'r1')),
  '42501', 'IMMUTABLE_FIELD', 'reviews are immutable records'
);
select throws_ok(
  format($$ update public.task_submissions set summary = 'rewritten' where id = %L $$, (select id from ids where key = 's1')),
  '42501', 'IMMUTABLE_FIELD', 'submitted versions are immutable records'
);

-- ---------------------------------------------------------------------------
-- Revision → V2 → approval → publication of V2 only
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
update public.tasks set status = 'in_progress' where id = (select id from ids where key = 'task');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', pg_temp.path('f2', 'final.pdf'), tests.uid('member')::text, '{"size": 20, "mimetype": "application/pdf"}');
insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
values ((select id from ids where key = 'f2'), tests.uid('project_a'), (select id from ids where key = 'task'), 'Final', 'final.pdf',
        pg_temp.path('f2', 'final.pdf'));
select lives_ok(
  format($$ select public.submit_task(%L, 'Final v2', array['https://example.com/v2'], 'internal note v2', array[%L]::uuid[]) $$,
         (select id from ids where key = 'task'), (select id from ids where key = 'f2')),
  'Ahmed resubmits as version 2'
);
select tests.clear_authentication();
select results_eq(
  format($$ select version, status::text, summary from public.task_submissions where task_id = %L order by version $$,
         (select id from ids where key = 'task')),
  $$ values (1, 'revision_required'::text, 'Draft v1'::text), (2, 'submitted'::text, 'Final v2'::text) $$,
  'version 1 is preserved unchanged; version 2 is a new record and is not published'
);
select is_empty(format($$ select task_id from public.task_publications where task_id = %L $$, (select id from ids where key = 'task')),
  'a new submission is never published automatically');

select tests.authenticate_as('manager');
select public.start_task_review((select id from ids where key = 'task'));
select lives_ok(format($$ select public.review_task(%L, 'approved', 'Good') $$, (select id from ids where key = 'task')),
  'the manager approves version 2');
select throws_ok(format($$ select public.review_task(%L, 'approved') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN', 'an approved version cannot be reviewed again');

select tests.authenticate_as('member2');
select is_empty($$ select task_id from public.task_publications $$,
  'approved is still private: nothing is published before MARK AS COMPLETED');

select tests.authenticate_as('manager');
select lives_ok(format($$ select public.complete_task(%L, 'For the team') $$, (select id from ids where key = 'task')),
  'the manager marks the task as completed (publication)');
select tests.clear_authentication();
select results_eq(
  format($$ select final_submission_version, final_result, document_ids from public.task_publications where task_id = %L $$,
         (select id from ids where key = 'task')),
  format($$ values (2, 'Final v2'::text, array[%L]::uuid[]) $$, (select id from ids where key = 'f2')),
  'the publication is built from the latest approved version and its files only'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_publications'
      and column_name in ('notes', 'comment', 'required_changes', 'additional_instructions', 'description', 'work_notes')
  ),
  'the publication has no column for private notes, reviews or instructions'
);

-- ---------------------------------------------------------------------------
-- After publication: the team sees the sanitized publication and V2's files
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member2');
select results_eq(
  $$ select title, final_result, deliverable_links from public.task_publications $$,
  $$ values ('Private analysis'::text, 'Final v2'::text, array['https://example.com/v2']::text[]) $$,
  'the team sees the final publication'
);
select results_eq(
  $$ select id from public.documents where task_id is not null $$,
  format($$ values (%L::uuid) $$, (select id from ids where key = 'f2')),
  'the team reads the published file of the final version'
);
select results_eq(
  format($$ select name from storage.objects where name in (%L, %L) $$, pg_temp.path('f1', 'draft.pdf'), pg_temp.path('f2', 'final.pdf')),
  format($$ values (%L::text) $$, pg_temp.path('f2', 'final.pdf')),
  'Storage follows: the published object is readable, the draft object is not'
);
select is_empty(format($$ select id from public.task_submissions where task_id = %L $$, (select id from ids where key = 'task')),
  'V1 and V2 stay private after publication');
select is_empty(format($$ select id from public.task_reviews where task_id = %L $$, (select id from ids where key = 'task')),
  'review history stays private after publication');
select is_empty(format($$ select id from public.comments where task_id = %L $$, (select id from ids where key = 'task')),
  'private task comments stay private after publication');
select is_empty(format($$ select id from public.tasks where id = %L $$, (select id from ids where key = 'task')),
  'the private task record stays private after publication');

select tests.authenticate_as('other_owner');
select is_empty($$ select task_id from public.task_publications $$, 'a Project B member does not see Project A publications');
select is_empty($$ select id from public.documents where task_id is not null $$, 'nor its published files');

-- ---------------------------------------------------------------------------
-- Self-approval through reassignment
-- ---------------------------------------------------------------------------
select tests.authenticate_as('manager');
insert into public.tasks (project_id, title, assigned_to) values (tests.uid('project_a'), 'Manager own work', tests.uid('manager'));
insert into ids select 'own', id from public.tasks where title = 'Manager own work';
update public.tasks set status = 'in_progress' where id = (select id from ids where key = 'own');
select public.submit_task((select id from ids where key = 'own'), 'My work', '{}', '', '{}');
update public.tasks set assigned_to = tests.uid('member2') where id = (select id from ids where key = 'own');
select throws_ok(format($$ select public.start_task_review(%L) $$, (select id from ids where key = 'own')),
  '42501', 'SELF_REVIEW_FORBIDDEN', 'reassigning a task does not let its submitter review their own work');

select tests.authenticate_as('reviewer');
select public.start_task_review((select id from ids where key = 'own'));
select public.review_task((select id from ids where key = 'own'), 'approved', 'Independent approval');
select tests.authenticate_as('manager');
select throws_ok(format($$ select public.complete_task(%L, '') $$, (select id from ids where key = 'own')),
  '42501', 'SELF_REVIEW_FORBIDDEN', 'the submitter cannot publish their own work either');

-- ---------------------------------------------------------------------------
-- Visibility follows current authorization
-- ---------------------------------------------------------------------------
select tests.clear_authentication();
insert into public.tasks (project_id, title, assigned_to, created_by)
values (tests.uid('project_a'), 'Legacy task created by Sara', tests.uid('member'), tests.uid('member2'));
select tests.authenticate_as('member2');
select is_empty($$ select id from public.tasks where title = 'Legacy task created by Sara' $$,
  'a former creator without supervisor rights cannot read another member''s private task');

-- A suspended member loses the publications of the project.
select tests.clear_authentication();
update public.project_members set status = 'suspended' where project_id = tests.uid('project_a') and user_id = tests.uid('member2');
select tests.authenticate_as('member2');
select is_empty($$ select task_id from public.task_publications $$, 'a suspended member no longer reads publications');
select is_empty($$ select id from public.documents $$, 'nor any file of the project');

-- The responsible member cannot attach files once the task is closed.
select tests.authenticate_as('member');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', '20000000-0000-4000-8000-00000000000a/60000000-0000-4000-8000-000000000004/late.pdf',
   tests.uid('member')::text, '{"size": 5, "mimetype": "application/pdf"}');
select throws_ok(
  format(
    $$ insert into public.documents (id, project_id, task_id, title, file_name, storage_path)
       values ('60000000-0000-4000-8000-000000000004', %L, %L, 'Late', 'late.pdf',
               '20000000-0000-4000-8000-00000000000a/60000000-0000-4000-8000-000000000004/late.pdf') $$,
    tests.uid('project_a'), (select id from ids where key = 'task')
  ),
  '42501', 'TASK_EDIT_FORBIDDEN',
  'files cannot be added to a completed (published) task'
);
select is(
  (select count(*)::int from public.task_submissions where task_id = (select id from ids where key = 'task')),
  2,
  'Ahmed still reads his own versions after publication'
);
select throws_ok(
  format($$ select public.submit_task(%L, 'Sneaky v3', '{}', '', '{}') $$, (select id from ids where key = 'task')),
  '42501', 'TASK_STATUS_FORBIDDEN',
  'a published task accepts no further versions'
);

select * from finish();
rollback;
