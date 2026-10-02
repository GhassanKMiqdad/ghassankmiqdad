-- =============================================================================
-- Business-rule triggers (field-level authorization)
--
-- RLS decides WHICH rows a user may touch. These BEFORE triggers decide WHAT a
-- user may change inside a row they are allowed to touch, e.g. a member that
-- may edit an assigned task cannot re-assign it or approve it.
--
-- Errors are raised with machine-readable messages (e.g. TASK_EDIT_FORBIDDEN)
-- that the application maps to localised, user-friendly messages.
--
-- Rules are skipped for system contexts (migrations, service-role scripts) and
-- for nested trigger executions (pg_trigger_depth() > 1), i.e. referential
-- actions such as "un-assign tasks of a removed member".
-- =============================================================================

-- updated_at maintenance --------------------------------------------------------
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function private.set_updated_at();

create trigger project_members_set_updated_at
  before update on public.project_members
  for each row execute function private.set_updated_at();

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function private.set_updated_at();

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
create or replace function private.tasks_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.created_at := now();
  new.updated_at := now();
  new.completed_at := case when new.status = 'completed' then now() else null end;

  if private.is_system_context() then
    return new;
  end if;

  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(new.project_id, 'tasks.create') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  -- The creator is always the caller; it cannot be spoofed.
  new.created_by := v_uid;

  if new.assigned_to is not null then
    -- Without tasks.assign a member may only assign a new task to themselves.
    if new.assigned_to <> v_uid and not private.has_permission(new.project_id, 'tasks.assign') then
      raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
    end if;
    if not private.is_active_member(new.project_id, new.assigned_to) then
      raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
    end if;
  end if;

  -- Creating a task directly in a final state requires full edit rights.
  if new.status in ('completed', 'rejected') and not private.has_permission(new.project_id, 'tasks.edit') then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  return new;
end;
$$;

create trigger tasks_before_insert
  before insert on public.tasks
  for each row execute function private.tasks_before_insert();

create or replace function private.tasks_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_full boolean;
  v_content boolean;
  v_review boolean;
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then now() else null end;
  else
    new.completed_at := old.completed_at;
  end if;

  if private.is_system_context() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
  end if;

  v_full := private.has_permission(old.project_id, 'tasks.edit');
  v_content := v_full
    or (old.created_by = v_uid and private.has_permission(old.project_id, 'tasks.edit_own'))
    or (old.assigned_to = v_uid and private.has_permission(old.project_id, 'tasks.edit_assigned'));
  v_review := private.has_permission(old.project_id, 'tasks.review');

  -- Content fields: title, description, priority, due date.
  if (new.title, new.description, new.priority, new.due_date)
       is distinct from (old.title, old.description, old.priority, old.due_date)
     and not v_content then
    raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
  end if;

  -- Status workflow:
  --   * tasks.edit                -> any transition;
  --   * tasks.review              -> any transition of a task in review / completed / rejected;
  --   * edit_own / edit_assigned  -> transitions among todo / in_progress / review only.
  if new.status is distinct from old.status and not (
       v_full
       or (v_review and old.status in ('review', 'completed', 'rejected'))
       or (v_content
           and old.status not in ('completed', 'rejected')
           and new.status not in ('completed', 'rejected'))
     ) then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  -- Assignment is its own permission.
  if new.assigned_to is distinct from old.assigned_to then
    if not private.has_permission(old.project_id, 'tasks.assign') then
      raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
    end if;
    if new.assigned_to is not null and not private.is_active_member(old.project_id, new.assigned_to) then
      raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_before_update
  before update on public.tasks
  for each row execute function private.tasks_before_update();

-- -----------------------------------------------------------------------------
-- Documents: metadata must point to a real uploaded object; size and MIME type
-- are copied from Storage so a client cannot misreport them.
-- (SECURITY DEFINER: reads storage.objects independently of the caller's
-- storage policies.)
-- -----------------------------------------------------------------------------
create or replace function private.documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_size text;
  v_mime text;
begin
  new.created_at := now();
  new.updated_at := now();

  if private.is_system_context() then
    return new;
  end if;

  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(new.project_id, 'documents.upload') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  new.uploaded_by := v_uid;

  select o.metadata ->> 'size', o.metadata ->> 'mimetype'
    into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'project-documents'
    and o.name = new.storage_path;

  if not found then
    raise exception using errcode = '22023', message = 'DOCUMENT_FILE_MISSING';
  end if;

  if v_size ~ '^[0-9]+$' then
    new.size_bytes := v_size::bigint;
  end if;
  if coalesce(v_mime, '') <> '' then
    new.mime_type := v_mime;
  end if;

  return new;
end;
$$;

create trigger documents_before_insert
  before insert on public.documents
  for each row execute function private.documents_before_insert();

-- -----------------------------------------------------------------------------
-- Comments: the author is always the caller.
-- -----------------------------------------------------------------------------
create or replace function private.comments_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.updated_at := now();

  if private.is_system_context() then
    return new;
  end if;

  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  new.author_id := auth.uid();
  return new;
end;
$$;

create trigger comments_before_insert
  before insert on public.comments
  for each row execute function private.comments_before_insert();
