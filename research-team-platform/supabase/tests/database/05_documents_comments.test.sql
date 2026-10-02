-- Documents (table + storage policies) and comments.
begin;
\ir _helpers.psql
select plan(33);

select tests.setup_world();

-- Fixture objects "uploaded" to storage.
select tests.fake_storage_object(
  tests.uid('project_a') || '/40000000-0000-4000-8000-000000000001/paper.pdf', 2048, 'application/pdf'
);
select tests.fake_storage_object(
  tests.uid('project_a') || '/40000000-0000-4000-8000-000000000002/data.csv', 512, 'text/csv'
);
-- A file that exists, but in another project's folder.
select tests.fake_storage_object(
  tests.uid('project_b') || '/40000000-0000-4000-8000-000000000004/x.pdf', 10, 'application/pdf'
);

-- ---------------------------------------------------------------------------
-- Document metadata
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select lives_ok(
  format(
    $$ insert into public.documents (id, project_id, title, file_name, storage_path, mime_type, size_bytes)
       values ('40000000-0000-4000-8000-000000000001', %L, 'Paper', 'paper.pdf', %L, 'text/html', 1) $$,
    tests.uid('project_a'), tests.uid('project_a') || '/40000000-0000-4000-8000-000000000001/paper.pdf'
  ),
  'a member with documents.upload can register an uploaded document'
);
select results_eq(
  $$ select size_bytes, mime_type, uploaded_by from public.documents where id = '40000000-0000-4000-8000-000000000001' $$,
  format($$ values (2048::bigint, 'application/pdf'::text, %L::uuid) $$, tests.uid('member')),
  'size, MIME type and uploader come from Storage / the session, not from the client'
);
select throws_ok(
  format(
    $$ insert into public.documents (id, project_id, title, file_name, storage_path)
       values ('40000000-0000-4000-8000-000000000003', %L, 'Ghost', 'ghost.pdf', %L) $$,
    tests.uid('project_a'), tests.uid('project_a') || '/40000000-0000-4000-8000-000000000003/ghost.pdf'
  ),
  '22023', 'DOCUMENT_FILE_MISSING',
  'metadata cannot reference a file that was never uploaded'
);
select throws_ok(
  format(
    $$ insert into public.documents (id, project_id, title, file_name, storage_path)
       values ('40000000-0000-4000-8000-000000000004', %L, 'Elsewhere', 'x.pdf', %L) $$,
    tests.uid('project_a'), tests.uid('project_b') || '/40000000-0000-4000-8000-000000000004/x.pdf'
  ),
  '23514', null,
  'a document must live in its own project folder'
);
update public.documents set title = 'Renamed by member' where id = '40000000-0000-4000-8000-000000000001';
delete from public.documents where id = '40000000-0000-4000-8000-000000000001';

select tests.authenticate_as('reviewer');
select throws_ok(
  format(
    $$ insert into public.documents (id, project_id, title, file_name, storage_path)
       values ('40000000-0000-4000-8000-000000000002', %L, 'Data', 'data.csv', %L) $$,
    tests.uid('project_a'), tests.uid('project_a') || '/40000000-0000-4000-8000-000000000002/data.csv'
  ),
  '42501', 'PERMISSION_DENIED',
  'a reviewer without documents.upload cannot upload documents'
);
select is(
  (select count(*)::int from public.documents),
  1,
  'a reviewer with documents.view can see the project documents'
);

select tests.authenticate_as('outsider');
select is_empty($$ select id from public.documents $$, 'an outsider cannot see the documents');

select tests.clear_authentication();
select is(
  (select title from public.documents where id = '40000000-0000-4000-8000-000000000001'),
  'Paper',
  'a member without documents.edit cannot edit a document'
);
select is(
  (select count(*)::int from public.documents where id = '40000000-0000-4000-8000-000000000001'),
  1,
  'a member without documents.delete cannot delete a document'
);

select tests.authenticate_as('manager');
select lives_ok(
  $$ update public.documents set title = 'Final paper', description = 'Camera-ready' where id = '40000000-0000-4000-8000-000000000001' $$,
  'a manager with documents.edit can edit document details'
);
select throws_ok(
  $$ update public.documents set size_bytes = 1 where id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'file metadata (size) cannot be edited'
);
select lives_ok(
  $$ delete from public.documents where id = '40000000-0000-4000-8000-000000000001' $$,
  'a manager with documents.delete can delete a document'
);
select tests.clear_authentication();
select results_eq(
  format(
    $$ select action from public.activity_logs where entity_type = 'document' and project_id = %L order by created_at $$,
    tests.uid('project_a')
  ),
  $$ values ('document.uploaded'), ('document.updated'), ('document.deleted') $$,
  'document upload, edit and deletion are audited in order'
);

-- ---------------------------------------------------------------------------
-- Storage object policies
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('project-documents', %L) $$, tests.uid('project_a') || '/50000000-0000-4000-8000-000000000001/notes.txt'),
  'storage: a member with documents.upload can upload into the project folder'
);
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('project-documents', %L) $$, tests.uid('project_b') || '/50000000-0000-4000-8000-000000000002/evil.txt'),
  '42501', null,
  'storage: nobody can upload into the folder of another project'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('project-documents', 'not-a-project/evil.txt') $$,
  '42501', null,
  'storage: objects outside a project folder are rejected'
);
-- Hosted Supabase blocks direct DELETEs on storage tables with a statement
-- trigger unless the Storage API sets this flag; set it so the RLS delete
-- policy (not that safety net) is what this assertion exercises.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where name like '%/notes.txt';
select tests.clear_authentication();
select is(
  (select count(*)::int from storage.objects where name like '%/notes.txt'),
  1,
  'storage: a member without documents.delete cannot delete files'
);

-- Two-step uploads: until a document row references the object, its
-- uploader (and only its uploader) may discard it.
select tests.authenticate_as('member');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', tests.uid('project_a') || '/50000000-0000-4000-8000-000000000011/draft.txt',
   tests.uid('member')::text, '{"size": 5, "mimetype": "text/plain"}'),
  ('project-documents', tests.uid('project_a') || '/50000000-0000-4000-8000-000000000012/final.txt',
   tests.uid('member')::text, '{"size": 7, "mimetype": "text/plain"}');
insert into public.documents (id, project_id, title, file_name, storage_path)
values ('50000000-0000-4000-8000-000000000012', tests.uid('project_a'), 'Final', 'final.txt',
        tests.uid('project_a') || '/50000000-0000-4000-8000-000000000012/final.txt');
select tests.authenticate_as('member2');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('project-documents', tests.uid('project_a') || '/50000000-0000-4000-8000-000000000013/theirs.txt',
   tests.uid('member2')::text, '{"size": 3, "mimetype": "text/plain"}');
select tests.authenticate_as('member');
delete from storage.objects where name like '%/draft.txt' or name like '%/final.txt' or name like '%/theirs.txt';
select tests.clear_authentication();
select is(
  (select count(*)::int from storage.objects where name like '%/draft.txt'),
  0,
  'storage: an uploader can discard their own upload before it is registered'
);
select is(
  (select count(*)::int from storage.objects where name like '%/final.txt'),
  1,
  'storage: once registered, a file can only be deleted with documents.delete'
);
select is(
  (select count(*)::int from storage.objects where name like '%/theirs.txt'),
  1,
  'storage: nobody can discard another member''s pending upload'
);

select tests.authenticate_as('outsider');
select is_empty(
  $$ select id from storage.objects where bucket_id = 'project-documents' $$,
  'storage: an outsider cannot list or download project files'
);
select tests.authenticate_as('reviewer');
select ok(
  (select count(*) from storage.objects where bucket_id = 'project-documents') >= 2,
  'storage: a member with documents.view can download project files'
);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
select tests.authenticate_as('member');
select lives_ok(
  format($$ insert into public.comments (project_id, content) values (%L, 'Kick-off notes') $$, tests.uid('project_a')),
  'a member with comments.create can comment on the project'
);
select lives_ok(
  format($$ insert into public.comments (project_id, task_id, content) values (%L, %L, 'Sources added') $$, tests.uid('project_a'), tests.uid('task_assigned_member')),
  'a member can comment on a visible task'
);
select lives_ok(
  $$ update public.comments set content = 'Sources added (12 papers)' where content = 'Sources added' $$,
  'the author can edit their own comment'
);

select tests.authenticate_as('outsider');
select throws_ok(
  format($$ insert into public.comments (project_id, content) values (%L, 'Spam') $$, tests.uid('project_a')),
  '42501', null,
  'an outsider cannot comment on a project'
);

select tests.authenticate_as('member2');
update public.comments set content = 'Edited by somebody else' where content = 'Kick-off notes';
delete from public.comments where content = 'Kick-off notes';

select tests.clear_authentication();
select is(
  (select count(*)::int from public.comments where content = 'Kick-off notes'),
  1,
  'other members can neither edit nor delete somebody else''s comment'
);
select is(
  (select author_id from public.comments where content = 'Kick-off notes'),
  tests.uid('member'),
  'the comment author is the authenticated caller'
);

select tests.authenticate_as('manager');
select lives_ok(
  $$ delete from public.comments where content = 'Kick-off notes' $$,
  'a manager with comments.delete can delete other people''s comments'
);
select tests.authenticate_as('member');
select lives_ok(
  $$ delete from public.comments where content like 'Sources added%' $$,
  'the author can delete their own comment'
);
select tests.clear_authentication();
select is(
  (select count(*)::int from public.comments where project_id = tests.uid('project_a')),
  0,
  'both comments were deleted'
);
select results_eq(
  format(
    $$ select action, old_values ->> 'content', new_values ->> 'content' from public.activity_logs
        where entity_type = 'comment' and action = 'comment.updated' and project_id = %L $$,
    tests.uid('project_a')
  ),
  $$ values ('comment.updated'::text, 'Sources added'::text, 'Sources added (12 papers)'::text) $$,
  'comment edits are audited with the previous and the new content'
);
select is(
  (select count(*)::int from public.activity_logs where action = 'comment.deleted' and project_id = tests.uid('project_a')),
  2,
  'comment deletions are audited'
);

select * from finish();
rollback;
