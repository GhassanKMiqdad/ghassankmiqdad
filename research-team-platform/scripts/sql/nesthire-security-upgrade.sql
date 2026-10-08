-- =============================================================================
-- NestHire Workspace — security upgrade for the hosted database
--
-- Applies, in one transaction, exactly the two migrations that follow the
-- base NestHire schema and records them in supabase_migrations:
--   20261008000100_workflow_security_hardening
--   20261008000200_final_privacy_hardening
-- Equivalent to `npx supabase db push`. Additive: no table or column is
-- dropped and no existing row is rewritten. It refuses to run unless the base
-- NestHire migrations are present and these two are not.
--
-- Supabase Dashboard → SQL Editor → New query → paste everything → Run.
-- Apply it BEFORE deploying the matching application code.
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000500') then
    raise exception 'Base NestHire migrations (20261007000500) are missing: apply them first.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20261008000100', '20261008000200')) then
    raise exception 'The NestHire security upgrade is already (partly) applied: nothing to do.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20261008000100_workflow_security_hardening.sql
-- ---------------------------------------------------------------------------
-- =============================================================================
-- NestHire Workspace — workflow security hardening
--
-- Additive: no table or column is dropped, no data is rewritten.
--
--  1. Private task files: documents.task_id. A task file is readable only by
--     whoever can see the task (supervisors, the responsible member) until
--     the task is published; after MARK AS COMPLETED the team reads ONLY the
--     files of the final approved version, through task_publications.
--     Storage reads follow the same rule (the object policy defers to the
--     documents RLS), so a known path or UUID gives nothing.
--  2. Submissions reference task files by id (task_submissions.document_ids),
--     validated by submit_task (same task, uploaded by the submitter). A file
--     handed in with a version is locked: it cannot be edited or deleted.
--     External deliverable links stay plain https links, never storage URLs.
--  3. Strict review state machine:
--        SUBMITTED → UNDER_REVIEW (start_task_review)
--                  → APPROVED | REVISION_REQUIRED (review_task)
--        APPROVED  → COMPLETED + publication (complete_task)
--     Only the latest version can be reviewed, approved and published.
--  4. Nobody reviews, approves or publishes work they submitted themselves
--     (also after a reassignment), except a Director (organization-level,
--     audited override).
--  5. Versions, reviews and publications are immutable records.
--  6. Visibility is based on actual authorization: a task's creator keeps
--     reading another member's task only while they can still create tasks; publications are
--     read by active members of the task's project; private task comments
--     can be edited or deleted only by people who can still see the task.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.documents add column task_id uuid;
alter table public.documents
  add constraint documents_task_fkey foreign key (task_id, project_id)
  references public.tasks (id, project_id) on delete cascade;
create index documents_task_id_idx on public.documents (task_id) where task_id is not null;
comment on column public.documents.task_id is
  'Private task file (deliverable or reference). NULL = project document library.';

alter table public.task_submissions add column document_ids uuid[] not null default '{}';
alter table public.task_submissions
  add constraint task_submissions_document_ids_count check (cardinality(document_ids) <= 20);
create index task_submissions_document_ids_idx on public.task_submissions using gin (document_ids);
comment on column public.task_submissions.document_ids is
  'Task files handed in with this version (validated by submit_task).';

alter table public.task_publications add column document_ids uuid[] not null default '{}';
comment on column public.task_publications.document_ids is
  'Files of the final approved version that the team may read.';

grant insert (task_id) on table public.documents to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------

-- Same rule as the tasks RLS policy below (used by the workflow functions).
create or replace function private.can_see_task(p_project_id uuid, p_assigned_to uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_project_id, 'tasks.view')
      or (
        (select auth.uid()) = p_assigned_to
        and private.has_permission(p_project_id, 'project.view')
      )
      or (
        (select auth.uid()) = p_created_by
        and private.has_permission(p_project_id, 'project.view')
        and (
          p_assigned_to is null
          or p_assigned_to = (select auth.uid())
          or private.has_permission(p_project_id, 'tasks.create')
        )
      );
$$;

-- A file handed in with a submission version is evidence: it is locked.
create or replace function private.is_submitted_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_submissions s where p_document_id = any (s.document_ids));
$$;

-- True when the storage object belongs to a registered private task file.
create or replace function private.is_task_file_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name and d.task_id is not null);
$$;

-- Who may attach a file to a task: the responsible member while working on it,
-- or a supervisor of the task (tasks.edit) while it is open.
create or replace function private.can_attach_task_file(p_task_id uuid, p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.project_id = p_project_id
      and t.status not in ('completed', 'cancelled')
      and (
        (
          t.assigned_to = (select auth.uid())
          and t.status in ('in_progress', 'revision_required')
          and private.has_permission(t.project_id, 'tasks.edit_assigned')
        )
        or private.has_permission(t.project_id, 'tasks.edit')
      )
  );
$$;

-- Reviewing, approving or publishing work the caller handed in is self-approval.
create or replace function private.assert_not_own_submission(p_submission public.task_submissions)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_submission.submitted_by = auth.uid() and not private.is_director() then
    raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
  end if;
end;
$$;

-- External deliverable links are references, never a way to share a stored
-- file: links into the Storage API (signed or public object URLs) are refused.
create or replace function private.is_storage_link(p_link text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_link ~* '^https?://[^/]+/storage/v1/';
$$;

-- -----------------------------------------------------------------------------
-- 3. tasks: a creator keeps reading a task assigned to someone else only while
--    still allowed to create tasks (supervisor capacity), so a former creator
--    has no window into another member's private work. Unassigned tasks stay
--    visible to their creator.
-- -----------------------------------------------------------------------------
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('tasks.view'))
    or (
      assigned_to = (select auth.uid())
      and project_id in (select private.project_ids_with_permission('project.view'))
    )
    or (
      created_by = (select auth.uid())
      and project_id in (select private.project_ids_with_permission('project.view'))
      and (
        assigned_to is null
        or project_id in (select private.project_ids_with_permission('tasks.create'))
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. documents: private task files
-- -----------------------------------------------------------------------------
drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (task_id is null and project_id in (select private.project_ids_with_permission('documents.view')))
    or (
      task_id is not null
      and (
        -- Private phase: whoever can see the task (sub-query filtered by tasks RLS).
        exists (select 1 from public.tasks t where t.id = documents.task_id)
        -- Published: only the files of the final version (filtered by publications RLS).
        or exists (
          select 1 from public.task_publications p
          where p.task_id = documents.task_id and documents.id = any (p.document_ids)
        )
      )
    )
  );

drop policy documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.has_permission(project_id, 'documents.upload')
    and (task_id is null or private.can_attach_task_file(task_id, project_id))
  );

drop policy documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    (task_id is null and private.has_permission(project_id, 'documents.edit'))
    or (
      task_id is not null
      and exists (select 1 from public.tasks t where t.id = documents.task_id)
      and (uploaded_by = (select auth.uid()) or private.has_permission(project_id, 'tasks.edit'))
    )
  )
  with check (private.has_permission(project_id, 'project.view'));

drop policy documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (
    (task_id is null and private.has_permission(project_id, 'documents.delete'))
    or (
      task_id is not null
      and exists (select 1 from public.tasks t where t.id = documents.task_id)
      and (uploaded_by = (select auth.uid()) or private.has_permission(project_id, 'tasks.edit'))
    )
  );

-- Clear errors (and defense in depth) for direct API writes on task files.
-- (SECURITY INVOKER on purpose: is_direct_api_write() reads current_user.)
create or replace function private.documents_task_file_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_direct_api_write() then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.task_id is not null and not private.can_attach_task_file(new.task_id, new.project_id) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id or new.project_id is distinct from old.project_id
       or new.storage_path is distinct from old.storage_path then
      raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
    end if;
    if old.task_id is not null and private.is_submitted_document(old.id) then
      raise exception using errcode = '42501', message = 'DOCUMENT_LOCKED';
    end if;
    return new;
  end if;

  -- DELETE
  if old.task_id is not null and private.is_submitted_document(old.id) then
    raise exception using errcode = '42501', message = 'DOCUMENT_LOCKED';
  end if;
  return old;
end;
$$;

create trigger documents_task_file_guard
  before insert or update or delete on public.documents
  for each row execute function private.documents_task_file_guard();

-- -----------------------------------------------------------------------------
-- 5. Storage: object reads follow the documents RLS exactly (the sub-query is
--    evaluated with the caller's rights); registered objects are removed only
--    by deleting their document first.
-- -----------------------------------------------------------------------------
drop policy project_documents_select on storage.objects;
create policy project_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      exists (select 1 from public.documents d where d.storage_path = objects.name)
      or private.is_own_pending_upload(name, owner_id)
    )
  );

drop policy project_documents_delete on storage.objects;
create policy project_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      (
        private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.delete')
        and not private.is_registered_document_path(name)
      )
      or private.is_own_pending_upload(name, owner_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 6. Publications: read by active members of the task's project (the team is
--    synchronized into its projects) and by Directors — actual membership,
--    not a stale team link.
-- -----------------------------------------------------------------------------
drop policy task_publications_select on public.task_publications;
create policy task_publications_select on public.task_publications
  for select to authenticated
  using (project_id in (select private.project_ids_with_permission('project.view')));

-- -----------------------------------------------------------------------------
-- 7. Comments: private task comments can be changed only while the task is
--    visible to the caller.
-- -----------------------------------------------------------------------------
drop policy comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and private.has_permission(project_id, 'comments.create')
    and (task_id is null or exists (select 1 from public.tasks t where t.id = comments.task_id))
  )
  with check (author_id = (select auth.uid()));

drop policy comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    (
      private.has_permission(project_id, 'comments.delete')
      or (author_id = (select auth.uid()) and private.has_permission(project_id, 'project.view'))
    )
    and (task_id is null or exists (select 1 from public.tasks t where t.id = comments.task_id))
  );

-- -----------------------------------------------------------------------------
-- 8. Immutable workflow records (also against bugs in trusted functions).
--    Only the status / is_final of a submission move, and user references may
--    be cleared when an account is deleted.
-- -----------------------------------------------------------------------------
create or replace function private.task_submissions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.task_id, new.project_id, new.version, new.summary, new.deliverable_links, new.notes,
      new.document_ids, new.submitted_at)
       is distinct from
     (old.id, old.task_id, old.project_id, old.version, old.summary, old.deliverable_links, old.notes,
      old.document_ids, old.submitted_at)
     or (new.submitted_by is distinct from old.submitted_by and new.submitted_by is not null) then
    raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
  end if;
  return new;
end;
$$;

create trigger task_submissions_immutable
  before update on public.task_submissions
  for each row execute function private.task_submissions_immutable();

create or replace function private.task_reviews_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.task_id, new.project_id, new.submission_id, new.decision, new.comment, new.required_changes,
      new.additional_instructions, new.previous_due_at, new.new_due_at, new.created_at)
       is distinct from
     (old.id, old.task_id, old.project_id, old.submission_id, old.decision, old.comment, old.required_changes,
      old.additional_instructions, old.previous_due_at, old.new_due_at, old.created_at)
     or (new.reviewer_id is distinct from old.reviewer_id and new.reviewer_id is not null) then
    raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
  end if;
  return new;
end;
$$;

create trigger task_reviews_immutable
  before update on public.task_reviews
  for each row execute function private.task_reviews_immutable();

create or replace function private.task_publications_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.task_id, new.project_id, new.task_code, new.title, new.responsible_name, new.responsible_title,
      new.final_result, new.deliverable_links, new.document_ids, new.team_comment, new.final_submission_version,
      new.completed_at, new.published_at)
       is distinct from
     (old.task_id, old.project_id, old.task_code, old.title, old.responsible_name, old.responsible_title,
      old.final_result, old.deliverable_links, old.document_ids, old.team_comment, old.final_submission_version,
      old.completed_at, old.published_at)
     or (new.team_id is distinct from old.team_id and new.team_id is not null)
     or (new.responsible_id is distinct from old.responsible_id and new.responsible_id is not null)
     or (new.published_by is distinct from old.published_by and new.published_by is not null) then
    raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
  end if;
  return new;
end;
$$;

create trigger task_publications_immutable
  before update on public.task_publications
  for each row execute function private.task_publications_immutable();

-- -----------------------------------------------------------------------------
-- 9. Workflow functions
-- -----------------------------------------------------------------------------

-- submit_task gains the task files of the version. The previous signature is
-- replaced (a function, not data) so PostgREST has a single candidate.
drop function public.submit_task(uuid, text, text[], text);

create or replace function public.submit_task(
  p_task_id uuid,
  p_summary text,
  p_deliverable_links text[] default '{}',
  p_notes text default '',
  p_document_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_version integer;
  v_id uuid;
  v_links text[];
  v_documents uuid[];
  v_supervisor uuid;
begin
  if v_task.assigned_to is distinct from v_uid
     or not private.has_permission(v_task.project_id, 'tasks.edit_assigned') then
    raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
  end if;

  if v_task.status not in ('in_progress', 'revision_required') then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select coalesce(array_agg(btrim(l)), '{}'::text[]) into v_links
  from unnest(coalesce(p_deliverable_links, '{}'::text[])) as l
  where btrim(l) <> '';

  if exists (select 1 from unnest(v_links) as l where private.is_storage_link(l)) then
    raise exception using errcode = '22023', message = 'DELIVERABLE_LINK_FORBIDDEN';
  end if;

  select coalesce(array_agg(distinct d), '{}'::uuid[]) into v_documents
  from unnest(coalesce(p_document_ids, '{}'::uuid[])) as d
  where d is not null;

  if cardinality(v_documents) > 20 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- Only the submitter's own files of THIS task can be handed in.
  if exists (
    select 1 from unnest(v_documents) as d
    where not exists (
      select 1 from public.documents doc
      where doc.id = d
        and doc.task_id = p_task_id
        and doc.project_id = v_task.project_id
        and doc.uploaded_by = v_uid
    )
  ) then
    raise exception using errcode = '22023', message = 'TASK_FILE_INVALID';
  end if;

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.task_submissions s where s.task_id = p_task_id;

  insert into public.task_submissions (
    task_id, project_id, version, summary, deliverable_links, notes, document_ids, submitted_by
  )
  values (
    p_task_id, v_task.project_id, v_version, btrim(p_summary), v_links, coalesce(btrim(p_notes), ''),
    v_documents, v_uid
  )
  returning id into v_id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_version, 'submission_id', v_id));
  update public.tasks
     set status = 'submitted',
         submitted_at = now(),
         actual_start_at = coalesce(actual_start_at, now())
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  for v_supervisor in select * from private.task_supervisor_ids(v_task) loop
    perform private.notify(
      v_supervisor, 'task_submitted', v_task.project_id, v_task.id,
      jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title, 'version', v_version)
    );
  end loop;

  return v_id;
end;
$$;

-- SUBMITTED → UNDER_REVIEW, for the latest version only.
create or replace function public.start_task_review(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_submission public.task_submissions;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'submitted' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  select * into v_submission from public.task_submissions s
  where s.task_id = p_task_id order by s.version desc limit 1;
  if not found or v_submission.status <> 'submitted' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;
  perform private.assert_not_own_submission(v_submission);

  update public.task_submissions set status = 'under_review' where id = v_submission.id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_submission.version, 'submission_id', v_submission.id));
  update public.tasks set status = 'under_review' where id = p_task_id;
  perform private.set_task_event_meta(null);
end;
$$;

-- UNDER_REVIEW → APPROVED | REVISION_REQUIRED, for the version under review.
create or replace function public.review_task(
  p_task_id uuid,
  p_decision public.review_decision,
  p_comment text default '',
  p_required_changes text default '',
  p_additional_instructions text default '',
  p_new_due_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_submission public.task_submissions;
  v_review_id uuid;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'under_review' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  if p_decision is null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- A revision request must say what to change.
  if p_decision = 'revision_required'
     and char_length(btrim(coalesce(p_required_changes, ''))) = 0
     and char_length(btrim(coalesce(p_comment, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  if p_new_due_at is not null and v_task.planned_start_at is not null and p_new_due_at < v_task.planned_start_at then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select * into v_submission from public.task_submissions s
  where s.task_id = p_task_id order by s.version desc limit 1;
  if not found or v_submission.status <> 'under_review' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;
  perform private.assert_not_own_submission(v_submission);

  insert into public.task_reviews (
    task_id, project_id, submission_id, decision, comment, required_changes, additional_instructions,
    previous_due_at, new_due_at, reviewer_id
  )
  values (
    p_task_id, v_task.project_id, v_submission.id, p_decision,
    coalesce(btrim(p_comment), ''), coalesce(btrim(p_required_changes), ''), coalesce(btrim(p_additional_instructions), ''),
    case when p_new_due_at is not null then v_task.due_at end, p_new_due_at, v_uid
  )
  returning id into v_review_id;

  update public.task_submissions
     set status = case when p_decision = 'approved' then 'approved'::public.submission_status
                       else 'revision_required'::public.submission_status end
   where id = v_submission.id;

  perform private.set_task_event_meta(jsonb_build_object(
    'version', v_submission.version, 'submission_id', v_submission.id, 'review_id', v_review_id,
    'new_due_at', p_new_due_at
  ));
  update public.tasks
     set status = case when p_decision = 'approved' then 'approved'::public.task_status
                       else 'revision_required'::public.task_status end,
         approved_at = case when p_decision = 'approved' then now() else approved_at end,
         due_at = coalesce(p_new_due_at, due_at),
         due_at_overridden = case when p_new_due_at is not null then true else due_at_overridden end
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  perform private.notify(
    v_task.assigned_to,
    case when p_decision = 'approved' then 'task_approved' else 'task_revision_requested' end,
    v_task.project_id, v_task.id,
    jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title, 'version', v_submission.version,
                       'new_due_at', p_new_due_at)
  );

  return v_review_id;
end;
$$;

-- APPROVED → COMPLETED: publishes the latest version, which must carry an
-- approving review. The publication is a sanitized copy: summary, external
-- links and the files of that version — never notes, reviews or older versions.
create or replace function public.complete_task(p_task_id uuid, p_team_comment text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_final public.task_submissions;
  v_documents uuid[];
  v_recipient uuid;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'approved' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  select * into v_final from public.task_submissions s
  where s.task_id = p_task_id order by s.version desc limit 1;
  if not found
     or v_final.status <> 'approved'
     or not exists (
       select 1 from public.task_reviews r
       where r.submission_id = v_final.id and r.decision = 'approved'
     ) then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;
  perform private.assert_not_own_submission(v_final);

  select coalesce(array_agg(d.id order by d.created_at), '{}'::uuid[]) into v_documents
  from public.documents d
  where d.id = any (v_final.document_ids) and d.task_id = v_task.id;

  update public.task_submissions set is_final = true where id = v_final.id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_final.version, 'submission_id', v_final.id));
  update public.tasks
     set status = 'completed',
         completed_at = now(),
         visibility = 'team',
         published_at = now()
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  insert into public.task_publications (
    task_id, project_id, team_id, task_code, title, responsible_id, responsible_name, responsible_title,
    final_result, deliverable_links, document_ids, team_comment, final_submission_version, completed_at, published_by
  )
  values (
    v_task.id, v_task.project_id, v_task.team_id, v_task.task_code, v_task.title, v_task.assigned_to,
    private.profile_name(v_task.assigned_to),
    (select tm.job_title from public.team_members tm where tm.team_id = v_task.team_id and tm.user_id = v_task.assigned_to),
    v_final.summary, v_final.deliverable_links, v_documents, coalesce(btrim(p_team_comment), ''),
    v_final.version, now(), v_uid
  );

  -- Notify the team (or, for a project without a team, its active members).
  for v_recipient in
    select tm.user_id from public.team_members tm
    where v_task.team_id is not null and tm.team_id = v_task.team_id and tm.status = 'active' and tm.user_id is not null
    union
    select pm.user_id from public.project_members pm
    where v_task.team_id is null and pm.project_id = v_task.project_id and pm.status = 'active'
  loop
    perform private.notify(
      v_recipient, 'task_published', v_task.project_id, v_task.id,
      jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title,
                         'responsible_name', private.profile_name(v_task.assigned_to))
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke execute on function public.submit_task(uuid, text, text[], text, uuid[]) from public, anon;
grant execute on function public.submit_task(uuid, text, text[], text, uuid[]) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261008000100', 'workflow_security_hardening');

-- ---------------------------------------------------------------------------
-- 20261008000200_final_privacy_hardening.sql
-- ---------------------------------------------------------------------------
-- =============================================================================
-- NestHire Workspace — final privacy hardening
--
-- Additive: no table or column is dropped and existing rows are not rewritten.
--
--  1. No self-approval for anyone. Whoever is responsible for a task, or handed
--     in the version under review, cannot start its review, decide on it or
--     publish it — Directors included (the previous Director override is
--     removed).
--  2. Reassignment privacy. A task carries the start of its current assignment
--     (tasks.assigned_at). The responsible member reads:
--       * the task instructions;
--       * the versions they submitted themselves, and the reviews of those
--         versions;
--       * comments written since their assignment started, and their own;
--       * their own task files and the reference files of supervisors.
--     Earlier private work of a previous assignee (versions, reviews, notes,
--     files, conversation) stays with the supervisors (tasks.view). The
--     previous assignee loses the task entirely. Execution notes and progress
--     of the previous assignee are cleared from the task row on reassignment
--     (their values remain in the audit log for supervisors).
--  3. External deliverable links: https only, no embedded credentials, never
--     a Storage API URL. They are references, not proof of anything.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. No self-review, self-approval or self-publication — for every role
-- -----------------------------------------------------------------------------
create or replace function private.assert_task_reviewer(p_task public.tasks)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_task.project_id, 'tasks.review') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  if p_task.assigned_to = auth.uid() then
    raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
  end if;
end;
$$;

create or replace function private.assert_not_own_submission(p_submission public.task_submissions)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_submission.submitted_by = auth.uid() then
    raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Assignment window
-- -----------------------------------------------------------------------------
alter table public.tasks add column assigned_at timestamptz;
comment on column public.tasks.assigned_at is
  'Start of the current assignment (server-controlled). NULL for tasks assigned before this column existed: no window applies.';

-- Runs after tasks_before_insert / tasks_before_update (trigger names sort
-- alphabetically), so assignee changes made there are stamped too.
create or replace function private.tasks_assignment_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    if old.assigned_to is not null then
      -- The previous assignee's private execution notes do not travel with the task.
      new.work_notes := '';
      new.progress := 0;
    end if;
  else
    new.assigned_at := old.assigned_at;
  end if;
  return new;
end;
$$;

create trigger tasks_set_assignment_window
  before insert or update on public.tasks
  for each row execute function private.tasks_assignment_window();

-- Versions: supervisors, and the submitter while still responsible for the task.
drop policy task_submissions_select on public.task_submissions;
create policy task_submissions_select on public.task_submissions
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('tasks.view'))
    or (
      submitted_by = (select auth.uid())
      and exists (
        select 1 from public.tasks t
        where t.id = task_submissions.task_id and t.assigned_to = (select auth.uid())
      )
    )
  );

-- Reviews: supervisors, and the author of the reviewed version (sub-query
-- filtered by the submissions policy above).
drop policy task_reviews_select on public.task_reviews;
create policy task_reviews_select on public.task_reviews
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('tasks.view'))
    or exists (
      select 1 from public.task_submissions s
      where s.id = task_reviews.submission_id and s.submitted_by = (select auth.uid())
    )
  );

-- Task comments: supervisors; the responsible member sees their own comments
-- and those written since their assignment started.
drop policy comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (
    (task_id is null and project_id in (select private.project_ids_with_permission('project.view')))
    or (
      task_id is not null
      and (
        project_id in (select private.project_ids_with_permission('tasks.view'))
        or exists (
          select 1 from public.tasks t
          where t.id = comments.task_id
            and (
              comments.author_id = (select auth.uid())
              or t.assigned_to is distinct from (select auth.uid())
              or t.assigned_at is null
              or comments.created_at >= t.assigned_at
            )
        )
      )
    )
  );

-- Task files: supervisors; the responsible member sees their own files and the
-- supervisors' reference files; the team only the published final files.
drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (task_id is null and project_id in (select private.project_ids_with_permission('documents.view')))
    or (
      task_id is not null
      and (
        project_id in (select private.project_ids_with_permission('tasks.view'))
        or exists (
          select 1 from public.tasks t
          where t.id = documents.task_id
            and (
              documents.uploaded_by = (select auth.uid())
              or t.assigned_to is distinct from (select auth.uid())
              or private.member_has_permission(documents.project_id, documents.uploaded_by, 'tasks.edit')
            )
        )
        or exists (
          select 1 from public.task_publications p
          where p.task_id = documents.task_id and documents.id = any (p.document_ids)
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. External deliverable links
-- -----------------------------------------------------------------------------
create or replace function private.is_safe_external_link(p_link text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_link ~ '^https://[^/?#@\s]+([/?#][^\s]*)?$'
     and char_length(p_link) <= 2048
     and not private.is_storage_link(p_link);
$$;

create or replace function public.submit_task(
  p_task_id uuid,
  p_summary text,
  p_deliverable_links text[] default '{}',
  p_notes text default '',
  p_document_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.tasks := private.lock_task_for_workflow(p_task_id);
  v_version integer;
  v_id uuid;
  v_links text[];
  v_documents uuid[];
  v_supervisor uuid;
begin
  if v_task.assigned_to is distinct from v_uid
     or not private.has_permission(v_task.project_id, 'tasks.edit_assigned') then
    raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
  end if;

  if v_task.status not in ('in_progress', 'revision_required') then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  if char_length(btrim(coalesce(p_summary, ''))) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select coalesce(array_agg(btrim(l)), '{}'::text[]) into v_links
  from unnest(coalesce(p_deliverable_links, '{}'::text[])) as l
  where btrim(l) <> '';

  if exists (select 1 from unnest(v_links) as l where not private.is_safe_external_link(l)) then
    raise exception using errcode = '22023', message = 'DELIVERABLE_LINK_FORBIDDEN';
  end if;

  select coalesce(array_agg(distinct d), '{}'::uuid[]) into v_documents
  from unnest(coalesce(p_document_ids, '{}'::uuid[])) as d
  where d is not null;

  if cardinality(v_documents) > 20 then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  -- Only the submitter's own files of THIS task can be handed in.
  if exists (
    select 1 from unnest(v_documents) as d
    where not exists (
      select 1 from public.documents doc
      where doc.id = d
        and doc.task_id = p_task_id
        and doc.project_id = v_task.project_id
        and doc.uploaded_by = v_uid
    )
  ) then
    raise exception using errcode = '22023', message = 'TASK_FILE_INVALID';
  end if;

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.task_submissions s where s.task_id = p_task_id;

  insert into public.task_submissions (
    task_id, project_id, version, summary, deliverable_links, notes, document_ids, submitted_by
  )
  values (
    p_task_id, v_task.project_id, v_version, btrim(p_summary), v_links, coalesce(btrim(p_notes), ''),
    v_documents, v_uid
  )
  returning id into v_id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_version, 'submission_id', v_id));
  update public.tasks
     set status = 'submitted',
         submitted_at = now(),
         actual_start_at = coalesce(actual_start_at, now())
   where id = p_task_id;
  perform private.set_task_event_meta(null);

  for v_supervisor in select * from private.task_supervisor_ids(v_task) loop
    perform private.notify(
      v_supervisor, 'task_submitted', v_task.project_id, v_task.id,
      jsonb_build_object('task_code', v_task.task_code, 'task_title', v_task.title, 'version', v_version)
    );
  end loop;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke execute on function public.submit_task(uuid, text, text[], text, uuid[]) from public, anon;
grant execute on function public.submit_task(uuid, text, text[], text, uuid[]) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261008000200', 'final_privacy_hardening');
select version, name from supabase_migrations.schema_migrations where version like '20261008%' order by version;

commit;
