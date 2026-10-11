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
--  3. External deliverable links: well-formed https only, no embedded
--     credentials, never a Storage API URL. Migration 20261008000300 adds
--     strict host and port parsing. Links are references, not proof of anything.
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
