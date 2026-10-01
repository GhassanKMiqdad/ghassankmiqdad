-- =============================================================================
-- Audit log (activity_logs)
--
-- * Every important change is written by a SECURITY DEFINER function or an
--   AFTER trigger, inside the same transaction as the change itself, so an
--   operation can never succeed without being logged — even when it is sent
--   directly to the API instead of going through the application.
-- * Clients have no INSERT/UPDATE/DELETE privilege on the table and an
--   additional trigger rejects UPDATE, DELETE and TRUNCATE for everybody.
-- * IP address and user agent are taken from the request headers forwarded by
--   PostgREST (the Next.js server forwards the end-user values as
--   x-client-ip / x-client-user-agent). They are informational only.
-- * Rows removed by a cascade (deleting a project removes its tasks, deleting
--   a task removes its comments) are not logged individually: the parent
--   event (project.deleted / task.deleted) covers them. Note that AFTER
--   triggers of cascaded operations run at trigger depth 1, so the triggers
--   detect cascades by checking whether the parent row still exists.
-- =============================================================================

create or replace function private.log_activity(
  p_project_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_actor_email text;
  v_headers jsonb;
  v_ip text;
  v_user_agent text;
  v_id uuid;
begin
  if v_actor is not null then
    select coalesce(nullif(btrim(p.full_name), ''), p.email), p.email
      into v_actor_name, v_actor_email
    from public.profiles p
    where p.id = v_actor;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when others then
      v_headers := null;
  end;

  if v_headers is not null then
    v_ip := coalesce(
      nullif(btrim(v_headers ->> 'x-client-ip'), ''),
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
    );
    v_user_agent := coalesce(nullif(v_headers ->> 'x-client-user-agent', ''), v_headers ->> 'user-agent');
  end if;

  insert into public.activity_logs (
    project_id, actor_id, actor_name, actor_email, action, entity_type, entity_id, entity_label,
    old_values, new_values, metadata, ip_address, user_agent
  )
  values (
    p_project_id, v_actor, v_actor_name, v_actor_email, p_action, p_entity_type, p_entity_id,
    left(p_entity_label, 300),
    nullif(p_old_values, '{}'::jsonb),
    nullif(p_new_values, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    private.safe_inet(v_ip),
    left(v_user_agent, 512)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Returns only the keys whose values differ between two row snapshots.
create or replace function private.jsonb_changes(p_old jsonb, p_new jsonb, p_keys text[])
returns table (old_values jsonb, new_values jsonb)
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(jsonb_object_agg(k, p_old -> k) filter (where (p_old -> k) is distinct from (p_new -> k)), '{}'::jsonb),
    coalesce(jsonb_object_agg(k, p_new -> k) filter (where (p_old -> k) is distinct from (p_new -> k)), '{}'::jsonb)
  from unnest(p_keys) as k;
$$;

-- Records one "permissions.changed" entry for a whole permission update:
--   old: { "tasks.edit": false }   new: { "tasks.edit": true }
create or replace function private.log_permission_diff(
  p_project_id uuid,
  p_user_id uuid,
  p_old text[],
  p_new text[],
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text[] := coalesce(p_old, '{}'::text[]);
  v_new text[] := coalesce(p_new, '{}'::text[]);
  v_added text[];
  v_removed text[];
  v_old_values jsonb := '{}'::jsonb;
  v_new_values jsonb := '{}'::jsonb;
  v_key text;
begin
  select coalesce(array_agg(k order by p.sort_order), '{}'::text[])
    into v_added
  from unnest(v_new) as k
  left join public.permissions p on p.key = k
  where not (k = any (v_old));

  select coalesce(array_agg(k order by p.sort_order), '{}'::text[])
    into v_removed
  from unnest(v_old) as k
  left join public.permissions p on p.key = k
  where not (k = any (v_new));

  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then
    return;
  end if;

  foreach v_key in array v_added loop
    v_old_values := v_old_values || jsonb_build_object(v_key, false);
    v_new_values := v_new_values || jsonb_build_object(v_key, true);
  end loop;

  foreach v_key in array v_removed loop
    v_old_values := v_old_values || jsonb_build_object(v_key, true);
    v_new_values := v_new_values || jsonb_build_object(v_key, false);
  end loop;

  perform private.log_activity(
    p_project_id,
    'permissions.changed',
    'permissions',
    p_user_id,
    private.profile_name(p_user_id),
    v_old_values,
    v_new_values,
    jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed), 'reason', p_reason)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
create or replace function private.audit_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes record;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(
      new.id, 'project.created', 'project', new.id, new.name, null,
      jsonb_build_object(
        'name', new.name, 'status', new.status,
        'start_date', new.start_date, 'deadline', new.deadline
      )
    );
  elsif tg_op = 'UPDATE' then
    select * into v_changes
    from private.jsonb_changes(
      to_jsonb(old), to_jsonb(new),
      array['name', 'description', 'research_goal', 'status', 'start_date', 'deadline']
    );
    if v_changes.new_values <> '{}'::jsonb then
      perform private.log_activity(
        new.id, 'project.updated', 'project', new.id, new.name,
        v_changes.old_values, v_changes.new_values
      );
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_activity(
      old.id, 'project.deleted', 'project', old.id, old.name,
      jsonb_build_object(
        'name', old.name, 'status', old.status, 'description', old.description,
        'research_goal', old.research_goal, 'start_date', old.start_date, 'deadline', old.deadline
      ),
      null
    );
  end if;

  return null;
end;
$$;

create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function private.audit_projects();

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
create or replace function private.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes record;
  v_metadata jsonb := '{}'::jsonb;
begin
  -- Tasks removed together with their project are covered by project.deleted.
  if tg_op = 'DELETE' and not private.project_exists(old.project_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_activity(
      new.project_id, 'task.created', 'task', new.id, new.title, null,
      jsonb_build_object(
        'title', new.title, 'status', new.status, 'priority', new.priority,
        'assigned_to', new.assigned_to, 'due_date', new.due_date
      ),
      jsonb_build_object('assignee_name', private.profile_name(new.assigned_to))
    );
  elsif tg_op = 'UPDATE' then
    select * into v_changes
    from private.jsonb_changes(
      to_jsonb(old), to_jsonb(new),
      array['title', 'description', 'status', 'priority', 'due_date']
    );
    if v_changes.new_values <> '{}'::jsonb then
      perform private.log_activity(
        new.project_id, 'task.updated', 'task', new.id, new.title,
        v_changes.old_values, v_changes.new_values
      );
    end if;

    if new.assigned_to is distinct from old.assigned_to then
      -- Un-assignment caused by removing the assignee from the project.
      if new.assigned_to is null and old.assigned_to is not null and not exists (
        select 1 from public.project_members pm
        where pm.project_id = new.project_id and pm.user_id = old.assigned_to
      ) then
        v_metadata := jsonb_build_object('reason', 'member_removed');
      end if;

      perform private.log_activity(
        new.project_id, 'task.assigned', 'task', new.id, new.title,
        jsonb_build_object('assigned_to', old.assigned_to, 'assignee_name', private.profile_name(old.assigned_to)),
        jsonb_build_object('assigned_to', new.assigned_to, 'assignee_name', private.profile_name(new.assigned_to)),
        v_metadata
      );
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_activity(
      old.project_id, 'task.deleted', 'task', old.id, old.title,
      jsonb_build_object(
        'title', old.title, 'status', old.status, 'priority', old.priority,
        'assigned_to', old.assigned_to, 'due_date', old.due_date
      ),
      null,
      jsonb_build_object('assignee_name', private.profile_name(old.assigned_to))
    );
  end if;

  return null;
end;
$$;

create trigger tasks_audit
  after insert or update or delete on public.tasks
  for each row execute function private.audit_tasks();

-- -----------------------------------------------------------------------------
-- Documents
-- -----------------------------------------------------------------------------
create or replace function private.audit_documents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes record;
begin
  -- Documents removed together with their project are covered by project.deleted.
  if tg_op = 'DELETE' and not private.project_exists(old.project_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_activity(
      new.project_id, 'document.uploaded', 'document', new.id, new.title, null,
      jsonb_build_object(
        'title', new.title, 'file_name', new.file_name,
        'mime_type', new.mime_type, 'size_bytes', new.size_bytes
      )
    );
  elsif tg_op = 'UPDATE' then
    select * into v_changes
    from private.jsonb_changes(to_jsonb(old), to_jsonb(new), array['title', 'description']);
    if v_changes.new_values <> '{}'::jsonb then
      perform private.log_activity(
        new.project_id, 'document.updated', 'document', new.id, new.title,
        v_changes.old_values, v_changes.new_values
      );
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_activity(
      old.project_id, 'document.deleted', 'document', old.id, old.title,
      jsonb_build_object(
        'title', old.title, 'file_name', old.file_name,
        'mime_type', old.mime_type, 'size_bytes', old.size_bytes
      ),
      null,
      jsonb_build_object('uploaded_by', old.uploaded_by, 'uploader_name', private.profile_name(old.uploaded_by))
    );
  end if;

  return null;
end;
$$;

create trigger documents_audit
  after insert or update or delete on public.documents
  for each row execute function private.audit_documents();

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------
create or replace function private.audit_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.comments;
  v_task_title text;
  v_metadata jsonb;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  -- Comments removed together with their task or project are covered by the
  -- task.deleted / project.deleted entry.
  if tg_op = 'DELETE' and (
       not private.project_exists(old.project_id)
       or (old.task_id is not null and not exists (select 1 from public.tasks t where t.id = old.task_id))
     ) then
    return null;
  end if;

  if v_row.task_id is not null then
    select t.title into v_task_title from public.tasks t where t.id = v_row.task_id;
  end if;

  v_metadata := jsonb_build_object(
    'task_id', v_row.task_id,
    'task_title', v_task_title,
    'author_id', v_row.author_id,
    'author_name', private.profile_name(v_row.author_id)
  );

  if tg_op = 'INSERT' then
    perform private.log_activity(
      new.project_id, 'comment.created', 'comment', new.id, v_task_title, null,
      jsonb_build_object('content', new.content), v_metadata
    );
  elsif tg_op = 'UPDATE' then
    if new.content is distinct from old.content then
      perform private.log_activity(
        new.project_id, 'comment.updated', 'comment', new.id, v_task_title,
        jsonb_build_object('content', old.content), jsonb_build_object('content', new.content), v_metadata
      );
    end if;
  elsif tg_op = 'DELETE' then
    perform private.log_activity(
      old.project_id, 'comment.deleted', 'comment', old.id, v_task_title,
      jsonb_build_object('content', old.content), null, v_metadata
    );
  end if;

  return null;
end;
$$;

create trigger comments_audit
  after insert or update or delete on public.comments
  for each row execute function private.audit_comments();

-- -----------------------------------------------------------------------------
-- Immutability of the audit trail
-- -----------------------------------------------------------------------------
create or replace function private.prevent_activity_log_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'ACTIVITY_LOG_IMMUTABLE';
end;
$$;

create trigger activity_logs_immutable
  before update or delete on public.activity_logs
  for each row execute function private.prevent_activity_log_changes();

create trigger activity_logs_no_truncate
  before truncate on public.activity_logs
  for each statement execute function private.prevent_activity_log_changes();
