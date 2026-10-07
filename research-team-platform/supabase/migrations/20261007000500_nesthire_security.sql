-- =============================================================================
-- NestHire upgrade 5/5 — privileges, Row Level Security, role templates
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function privileges (new private helpers + exposed RPCs)
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
grant execute on function private.handle_auth_user_team_link() to supabase_auth_admin;

revoke execute on function public.set_user_director(uuid, boolean) from public, anon;
revoke execute on function public.create_team(text, text) from public, anon;
revoke execute on function public.update_team(uuid, text, text) from public, anon;
revoke execute on function public.upsert_team_member(uuid, uuid, text, text, text, public.team_role, text) from public, anon;
revoke execute on function public.link_team_member(uuid, text) from public, anon;
revoke execute on function public.set_team_member_status(uuid, public.team_member_status) from public, anon;
revoke execute on function public.remove_team_member(uuid) from public, anon;
revoke execute on function public.set_project_team(uuid, uuid) from public, anon;
revoke execute on function public.get_team_invites(uuid) from public, anon;
revoke execute on function public.submit_task(uuid, text, text[], text) from public, anon;
revoke execute on function public.start_task_review(uuid) from public, anon;
revoke execute on function public.review_task(uuid, public.review_decision, text, text, text, timestamptz) from public, anon;
revoke execute on function public.complete_task(uuid, text) from public, anon;
revoke execute on function public.get_execution_report(uuid, integer) from public, anon;
revoke execute on function public.schedule_status(public.tasks) from public, anon;
revoke execute on function public.is_blocked(public.tasks) from public, anon;
revoke execute on function public.get_my_project_access(uuid) from public, anon;
revoke execute on function public.get_project_team(uuid) from public, anon;
revoke execute on function public.get_dashboard_stats(date) from public, anon;
revoke execute on function public.bootstrap_platform_admin(uuid) from public, anon, authenticated;

grant execute on function public.set_user_director(uuid, boolean) to authenticated, service_role;
grant execute on function public.create_team(text, text) to authenticated, service_role;
grant execute on function public.update_team(uuid, text, text) to authenticated, service_role;
grant execute on function public.upsert_team_member(uuid, uuid, text, text, text, public.team_role, text) to authenticated, service_role;
grant execute on function public.link_team_member(uuid, text) to authenticated, service_role;
grant execute on function public.set_team_member_status(uuid, public.team_member_status) to authenticated, service_role;
grant execute on function public.remove_team_member(uuid) to authenticated, service_role;
grant execute on function public.set_project_team(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_team_invites(uuid) to authenticated, service_role;
grant execute on function public.submit_task(uuid, text, text[], text) to authenticated, service_role;
grant execute on function public.start_task_review(uuid) to authenticated, service_role;
grant execute on function public.review_task(uuid, public.review_decision, text, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.complete_task(uuid, text) to authenticated, service_role;
grant execute on function public.get_execution_report(uuid, integer) to authenticated, service_role;
grant execute on function public.schedule_status(public.tasks) to authenticated, service_role;
grant execute on function public.is_blocked(public.tasks) to authenticated, service_role;
grant execute on function public.get_my_project_access(uuid) to authenticated, service_role;
grant execute on function public.get_project_team(uuid) to authenticated, service_role;
grant execute on function public.get_dashboard_stats(date) to authenticated, service_role;
grant execute on function public.bootstrap_platform_admin(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- profiles: is_director is never client-writable (only full_name is granted).
-- Directors see every profile.
-- -----------------------------------------------------------------------------
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id in (select private.visible_profile_ids())
    or (select private.is_platform_admin())
    or (select private.is_director())
    or id in (
      select tm.user_id from public.team_members tm
      where tm.team_id in (select private.my_team_ids()) and tm.user_id is not null
    )
  );

-- -----------------------------------------------------------------------------
-- tasks: new columns. Visibility, task ID, team and the workflow timestamps
-- have no client grant at all.
-- -----------------------------------------------------------------------------
revoke insert, update on table public.tasks from authenticated;
grant insert (
  project_id, title, description, original_instructions, expected_output, completion_criteria,
  status, priority, assigned_to, task_code, planning_month, planning_week,
  planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden
) on table public.tasks to authenticated;
grant update (
  title, description, original_instructions, expected_output, completion_criteria,
  status, priority, assigned_to, planning_month, planning_week,
  planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden,
  progress, work_notes
) on table public.tasks to authenticated;

-- -----------------------------------------------------------------------------
-- teams / team_members / invites
-- -----------------------------------------------------------------------------
alter table public.teams enable row level security;
revoke all on table public.teams from anon, authenticated;
grant select on table public.teams to authenticated;

create policy teams_select on public.teams
  for select to authenticated
  using (
    (select private.is_director())
    or id in (select private.my_team_ids())
    or id in (select p.team_id from public.projects p where p.team_id is not null)
  );

alter table public.team_members enable row level security;
revoke all on table public.team_members from anon, authenticated;
grant select on table public.team_members to authenticated;

create policy team_members_select on public.team_members
  for select to authenticated
  using (
    (select private.is_director())
    or user_id = (select auth.uid())
    or team_id in (select private.my_team_ids())
  );

alter table public.team_member_invites enable row level security;
revoke all on table public.team_member_invites from anon, authenticated;
grant select on table public.team_member_invites to authenticated;

create policy team_member_invites_select on public.team_member_invites
  for select to authenticated
  using ((select private.is_director()));

-- -----------------------------------------------------------------------------
-- task_dependencies
-- -----------------------------------------------------------------------------
alter table public.task_dependencies enable row level security;
revoke all on table public.task_dependencies from anon, authenticated;
grant select, delete on table public.task_dependencies to authenticated;
grant insert (task_id, depends_on_task_id, project_id) on table public.task_dependencies to authenticated;

create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_dependencies.task_id));

create policy task_dependencies_insert on public.task_dependencies
  for insert to authenticated
  with check (
    private.has_permission(project_id, 'tasks.edit')
    and exists (select 1 from public.tasks t where t.id = task_dependencies.task_id)
    and exists (select 1 from public.tasks t where t.id = task_dependencies.depends_on_task_id)
  );

create policy task_dependencies_delete on public.task_dependencies
  for delete to authenticated
  using (private.has_permission(project_id, 'tasks.edit'));

-- -----------------------------------------------------------------------------
-- task_submissions / task_reviews: private, read-only for clients (written
-- by submit_task / review_task / complete_task). Visible exactly to those who
-- can see the task row: supervisors and the responsible member.
-- -----------------------------------------------------------------------------
alter table public.task_submissions enable row level security;
revoke all on table public.task_submissions from anon, authenticated;
grant select on table public.task_submissions to authenticated;

create policy task_submissions_select on public.task_submissions
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_submissions.task_id));

alter table public.task_reviews enable row level security;
revoke all on table public.task_reviews from anon, authenticated;
grant select on table public.task_reviews to authenticated;

create policy task_reviews_select on public.task_reviews
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_reviews.task_id));

-- -----------------------------------------------------------------------------
-- task_publications: what the team sees after MARK AS COMPLETED.
--   * members of the task's team;
--   * for a project without a team: the project's members;
--   * supervisors (tasks.view) and Directors.
-- -----------------------------------------------------------------------------
alter table public.task_publications enable row level security;
revoke all on table public.task_publications from anon, authenticated;
grant select on table public.task_publications to authenticated;

create policy task_publications_select on public.task_publications
  for select to authenticated
  using (
    (team_id is not null and team_id in (select private.my_team_ids()))
    or (team_id is null and project_id in (select private.project_ids_with_permission('project.view')))
    or project_id in (select private.project_ids_with_permission('tasks.view'))
  );

-- -----------------------------------------------------------------------------
-- notifications: own rows only; users may only mark them as read or delete.
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select, delete on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Activity log: Directors read the whole organization's trail.
-- -----------------------------------------------------------------------------
drop policy activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (
    project_id in (select private.project_ids_with_permission('activity.view'))
    or actor_id = (select auth.uid())
    or (select private.is_director())
    or (
      (select private.is_platform_admin())
      and (project_id is null or not private.project_exists(project_id))
    )
  );

-- -----------------------------------------------------------------------------
-- Role templates: a Team Member executes their own tasks. Seeing every task
-- of the project (tasks.view), creating tasks and editing self-created tasks
-- are supervisor rights now, so other members' work stays PRIVATE until it is
-- published.
-- -----------------------------------------------------------------------------
delete from public.role_permissions
 where role = 'member'
   and permission_key in ('tasks.view', 'tasks.create', 'tasks.edit_own');

update public.permissions set description = 'See every task of the project, including private work in progress'
 where key = 'tasks.view';
update public.permissions set description = 'Execute assigned tasks: start, progress, work notes, submit'
 where key = 'tasks.edit_assigned';
update public.permissions set description = 'Review submissions, approve, request revisions and mark tasks as completed'
 where key = 'tasks.review';
update public.permissions set description = 'Edit any task, including its plan and schedule'
 where key = 'tasks.edit';

-- Existing members lose the right to read other people's private tasks.
do $$
declare
  v_member record;
  v_old text[];
begin
  for v_member in
    select pm.project_id, pm.user_id
    from public.project_members pm
    where pm.role = 'member'
      and exists (
        select 1 from public.user_permissions up
        where up.project_id = pm.project_id and up.user_id = pm.user_id and up.permission_key = 'tasks.view'
      )
  loop
    v_old := private.member_permission_keys(v_member.project_id, v_member.user_id);
    delete from public.user_permissions
     where project_id = v_member.project_id and user_id = v_member.user_id and permission_key = 'tasks.view';
    perform private.log_permission_diff(
      v_member.project_id, v_member.user_id, v_old,
      private.member_permission_keys(v_member.project_id, v_member.user_id), 'private_task_visibility'
    );
  end loop;
end;
$$;
