-- =============================================================================
-- Row Level Security, table privileges and function privileges
--
-- Layered model:
--   1. Table privileges (GRANT/REVOKE) define WHICH COMMANDS and WHICH COLUMNS
--      a role can use at all (e.g. a user can never UPDATE tasks.project_id
--      or profiles.is_platform_admin, whatever the policies say).
--   2. RLS policies define WHICH ROWS the command applies to.
--   3. BEFORE triggers (business_rules migration) define field-level rules.
--
-- The anon role gets nothing: every table requires an authenticated session.
-- Supabase grants broad default privileges on the public schema, so they are
-- revoked explicitly here and only the minimum is granted back.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke execute on function public.create_project(text, text, text, public.project_status, date, date) from public, anon;
revoke execute on function public.transfer_project_ownership(uuid, uuid) from public, anon;
revoke execute on function public.record_project_export(uuid, text, text) from public, anon;
revoke execute on function public.add_project_member(uuid, text, public.project_role) from public, anon;
revoke execute on function public.update_project_member(uuid, uuid, public.project_role, public.member_status, boolean) from public, anon;
revoke execute on function public.remove_project_member(uuid, uuid) from public, anon;
revoke execute on function public.set_member_permissions(uuid, uuid, text[]) from public, anon;
revoke execute on function public.get_my_project_access(uuid) from public, anon;
revoke execute on function public.get_project_team(uuid) from public, anon;
revoke execute on function public.get_dashboard_stats(date) from public, anon;
revoke execute on function public.admin_update_user_flags(uuid, boolean, boolean) from public, anon;
revoke execute on function public.bootstrap_platform_admin(uuid) from public, anon, authenticated;

grant execute on function public.create_project(text, text, text, public.project_status, date, date) to authenticated, service_role;
grant execute on function public.transfer_project_ownership(uuid, uuid) to authenticated, service_role;
grant execute on function public.record_project_export(uuid, text, text) to authenticated, service_role;
grant execute on function public.add_project_member(uuid, text, public.project_role) to authenticated, service_role;
grant execute on function public.update_project_member(uuid, uuid, public.project_role, public.member_status, boolean) to authenticated, service_role;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_member_permissions(uuid, uuid, text[]) to authenticated, service_role;
grant execute on function public.get_my_project_access(uuid) to authenticated, service_role;
grant execute on function public.get_project_team(uuid) to authenticated, service_role;
grant execute on function public.get_dashboard_stats(date) to authenticated, service_role;
grant execute on function public.admin_update_user_flags(uuid, boolean, boolean) to authenticated, service_role;
grant execute on function public.bootstrap_platform_admin(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id in (select private.visible_profile_ids())
    or (select private.is_platform_admin())
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- projects (INSERT only through create_project())
-- -----------------------------------------------------------------------------
alter table public.projects enable row level security;
revoke all on table public.projects from anon, authenticated;
grant select, delete on table public.projects to authenticated;
grant update (name, description, research_goal, status, start_date, deadline) on table public.projects to authenticated;

create policy projects_select on public.projects
  for select to authenticated
  using (id in (select private.project_ids_with_permission('project.view')));

create policy projects_update on public.projects
  for update to authenticated
  using (private.has_permission(id, 'project.edit'))
  with check (private.has_permission(id, 'project.edit'));

create policy projects_delete on public.projects
  for delete to authenticated
  using (private.has_permission(id, 'project.delete'));

-- -----------------------------------------------------------------------------
-- project_members (writes only through membership RPCs)
-- -----------------------------------------------------------------------------
alter table public.project_members enable row level security;
revoke all on table public.project_members from anon, authenticated;
grant select on table public.project_members to authenticated;

create policy project_members_select on public.project_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or project_id in (select private.project_ids_with_permission('team.view'))
    or project_id in (select private.project_ids_with_permission('tasks.assign'))
  );

-- -----------------------------------------------------------------------------
-- permissions catalog / role templates (read-only reference data)
-- -----------------------------------------------------------------------------
alter table public.permissions enable row level security;
revoke all on table public.permissions from anon, authenticated;
grant select on table public.permissions to authenticated;

create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

alter table public.role_permissions enable row level security;
revoke all on table public.role_permissions from anon, authenticated;
grant select on table public.role_permissions to authenticated;

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- user_permissions (writes only through set_member_permissions())
-- -----------------------------------------------------------------------------
alter table public.user_permissions enable row level security;
revoke all on table public.user_permissions from anon, authenticated;
grant select on table public.user_permissions to authenticated;

create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or project_id in (select private.project_ids_with_permission('team.view'))
  );

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
alter table public.tasks enable row level security;
revoke all on table public.tasks from anon, authenticated;
grant select, delete on table public.tasks to authenticated;
grant insert (project_id, title, description, status, priority, assigned_to, due_date) on table public.tasks to authenticated;
grant update (title, description, status, priority, assigned_to, due_date) on table public.tasks to authenticated;

-- Members see every task with tasks.view, and always the tasks they created or
-- that are assigned to them (as long as they can access the project).
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('tasks.view'))
    or (
      (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
      and project_id in (select private.project_ids_with_permission('project.view'))
    )
  );

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_permission(project_id, 'tasks.create')
  );

-- Row-level gate; the tasks_before_update trigger then checks every field.
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    private.has_permission(project_id, 'tasks.edit')
    or private.has_permission(project_id, 'tasks.assign')
    or private.has_permission(project_id, 'tasks.review')
    or (created_by = (select auth.uid()) and private.has_permission(project_id, 'tasks.edit_own'))
    or (assigned_to = (select auth.uid()) and private.has_permission(project_id, 'tasks.edit_assigned'))
  )
  with check (private.has_permission(project_id, 'project.view'));

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (private.has_permission(project_id, 'tasks.delete'));

-- -----------------------------------------------------------------------------
-- documents
-- -----------------------------------------------------------------------------
alter table public.documents enable row level security;
revoke all on table public.documents from anon, authenticated;
grant select, delete on table public.documents to authenticated;
grant insert (id, project_id, title, description, file_name, storage_path, mime_type, size_bytes) on table public.documents to authenticated;
grant update (title, description) on table public.documents to authenticated;

create policy documents_select on public.documents
  for select to authenticated
  using (project_id in (select private.project_ids_with_permission('documents.view')));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.has_permission(project_id, 'documents.upload')
  );

create policy documents_update on public.documents
  for update to authenticated
  using (private.has_permission(project_id, 'documents.edit'))
  with check (private.has_permission(project_id, 'documents.edit'));

create policy documents_delete on public.documents
  for delete to authenticated
  using (private.has_permission(project_id, 'documents.delete'));

-- -----------------------------------------------------------------------------
-- comments
-- -----------------------------------------------------------------------------
alter table public.comments enable row level security;
revoke all on table public.comments from anon, authenticated;
grant select, delete on table public.comments to authenticated;
grant insert (project_id, task_id, content) on table public.comments to authenticated;
grant update (content) on table public.comments to authenticated;

-- Project comments follow project access; task comments follow task
-- visibility (the sub-query is itself filtered by the tasks policies).
create policy comments_select on public.comments
  for select to authenticated
  using (
    (task_id is null and project_id in (select private.project_ids_with_permission('project.view')))
    or (task_id is not null and exists (select 1 from public.tasks t where t.id = comments.task_id))
  );

create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and private.has_permission(project_id, 'comments.create')
    and (task_id is null or exists (select 1 from public.tasks t where t.id = comments.task_id))
  );

create policy comments_update on public.comments
  for update to authenticated
  using (author_id = (select auth.uid()) and private.has_permission(project_id, 'comments.create'))
  with check (author_id = (select auth.uid()));

create policy comments_delete on public.comments
  for delete to authenticated
  using (
    private.has_permission(project_id, 'comments.delete')
    or (author_id = (select auth.uid()) and private.has_permission(project_id, 'project.view'))
  );

-- -----------------------------------------------------------------------------
-- activity_logs (read-only for clients)
-- -----------------------------------------------------------------------------
alter table public.activity_logs enable row level security;
revoke all on table public.activity_logs from anon, authenticated;
grant select on table public.activity_logs to authenticated;

-- * activity.view holders see their project's full trail;
-- * everybody sees their own actions;
-- * platform admins see platform-level entries and the trail of deleted projects.
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('activity.view'))
    or actor_id = (select auth.uid())
    or (
      (select private.is_platform_admin())
      and (project_id is null or not private.project_exists(project_id))
    )
  );
