-- =============================================================================
-- RPC functions (exposed through the Data API as /rest/v1/rpc/<name>)
--
-- Membership and permission writes go exclusively through these functions:
-- clients have no direct INSERT/UPDATE/DELETE privilege on project_members or
-- user_permissions. Each function
--   1. authenticates the caller (auth.uid()),
--   2. authorizes the operation against the caller's effective permissions
--      and the role hierarchy (anti privilege-escalation rules),
--   3. performs the change and writes the audit entry in the same transaction.
--
-- Error messages are stable machine-readable codes; SQLSTATEs map to HTTP
-- statuses in PostgREST (42501 -> 403, P0002 -> 404, 22023 -> 400, 23505 -> 409).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
create or replace function public.create_project(
  p_name text,
  p_description text default '',
  p_research_goal text default '',
  p_status public.project_status default 'planning',
  p_start_date date default null,
  p_deadline date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.can_create_projects() then
    raise exception using errcode = '42501', message = 'PROJECT_CREATE_FORBIDDEN';
  end if;

  insert into public.projects (name, description, research_goal, status, start_date, deadline, created_by)
  values (
    btrim(p_name),
    coalesce(p_description, ''),
    coalesce(p_research_goal, ''),
    coalesce(p_status, 'planning'),
    p_start_date,
    p_deadline,
    v_uid
  )
  returning id into v_project_id;

  insert into public.project_members (project_id, user_id, role, status, added_by)
  values (v_project_id, v_uid, 'owner', 'active', v_uid);

  return v_project_id;
end;
$$;

create or replace function public.transfer_project_ownership(p_project_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_project_name text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if private.member_role(p_project_id, v_uid) is distinct from 'owner'
     or not private.is_active_member(p_project_id, v_uid) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_new_owner_id = v_uid then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_SELF';
  end if;

  if not private.is_active_member(p_project_id, p_new_owner_id) then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  select p.name into v_project_name from public.projects p where p.id = p_project_id;

  -- Demote the current owner to manager with the manager template.
  update public.project_members
     set role = 'manager'
   where project_id = p_project_id and user_id = v_uid;

  insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
  select p_project_id, v_uid, rp.permission_key, v_uid
  from public.role_permissions rp
  where rp.role = 'manager'
  on conflict (project_id, user_id, permission_key) do nothing;

  -- Promote the new owner (owners hold every permission implicitly).
  update public.project_members
     set role = 'owner'
   where project_id = p_project_id and user_id = p_new_owner_id;

  delete from public.user_permissions
   where project_id = p_project_id and user_id = p_new_owner_id;

  perform private.log_activity(
    p_project_id, 'project.ownership_transferred', 'project', p_project_id, v_project_name,
    jsonb_build_object('owner_id', v_uid, 'owner_name', private.profile_name(v_uid)),
    jsonb_build_object('owner_id', p_new_owner_id, 'owner_name', private.profile_name(p_new_owner_id))
  );
end;
$$;

create or replace function public.record_project_export(p_project_id uuid, p_format text, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_name text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'data.export') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_format not in ('csv', 'json') or p_scope not in ('tasks', 'project') then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  select p.name into v_project_name from public.projects p where p.id = p_project_id;

  perform private.log_activity(
    p_project_id, 'project.exported', 'project', p_project_id, v_project_name, null, null,
    jsonb_build_object('format', p_format, 'scope', p_scope)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Membership
-- -----------------------------------------------------------------------------
create or replace function public.add_project_member(
  p_project_id uuid,
  p_email text,
  p_role public.project_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.project_role;
  v_target_id uuid;
  v_target_email text;
  v_permissions text[];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'members.add') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  if p_role is null or p_role = 'owner' then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  v_actor_role := private.member_role(p_project_id, v_uid);
  if v_actor_role <> 'owner' and private.role_rank(p_role) >= private.role_rank(v_actor_role) then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  select p.id, p.email
    into v_target_id, v_target_email
  from public.profiles p
  where lower(p.email) = lower(btrim(p_email));

  if v_target_id is null then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = v_target_id
  ) then
    raise exception using errcode = '23505', message = 'ALREADY_MEMBER';
  end if;

  insert into public.project_members (project_id, user_id, role, status, added_by)
  values (p_project_id, v_target_id, p_role, 'active', v_uid);

  v_permissions := private.template_permissions_for(p_project_id, v_uid, p_role);

  insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
  select p_project_id, v_target_id, k, v_uid
  from unnest(v_permissions) as k;

  perform private.log_activity(
    p_project_id, 'member.added', 'member', v_target_id, private.profile_name(v_target_id), null,
    jsonb_build_object('role', p_role, 'status', 'active', 'permissions', to_jsonb(v_permissions)),
    jsonb_build_object('email', v_target_email)
  );

  return v_target_id;
end;
$$;

create or replace function public.update_project_member(
  p_project_id uuid,
  p_user_id uuid,
  p_role public.project_role default null,
  p_status public.member_status default null,
  p_reset_permissions boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.project_role;
  v_target_role public.project_role;
  v_target_status public.member_status;
  v_old_permissions text[];
  v_new_permissions text[];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'members.manage') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pm.role, pm.status
    into v_target_role, v_target_status
  from public.project_members pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  if v_target_role = 'owner' then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_OWNER';
  end if;

  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_SELF';
  end if;

  if p_role = 'owner' then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  v_actor_role := private.member_role(p_project_id, v_uid);
  if v_actor_role <> 'owner' then
    if private.role_rank(v_target_role) >= private.role_rank(v_actor_role) then
      raise exception using errcode = '42501', message = 'INSUFFICIENT_RANK';
    end if;
    if p_role is not null and private.role_rank(p_role) >= private.role_rank(v_actor_role) then
      raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
    end if;
  end if;

  if p_role is not null and p_role <> v_target_role then
    update public.project_members
       set role = p_role
     where project_id = p_project_id and user_id = p_user_id;

    perform private.log_activity(
      p_project_id, 'member.role_changed', 'member', p_user_id, private.profile_name(p_user_id),
      jsonb_build_object('role', v_target_role),
      jsonb_build_object('role', p_role)
    );

    if coalesce(p_reset_permissions, true) then
      v_old_permissions := private.member_permission_keys(p_project_id, p_user_id);

      if v_actor_role = 'owner' then
        v_new_permissions := private.template_permissions_for(p_project_id, v_uid, p_role);
      else
        -- A non-owner only controls the permissions they hold themselves;
        -- grants outside that set are preserved untouched.
        select coalesce(array_agg(distinct k), '{}'::text[])
          into v_new_permissions
        from (
          select unnest(private.template_permissions_for(p_project_id, v_uid, p_role)) as k
          union
          select k2
          from unnest(v_old_permissions) as k2
          where not private.member_has_permission(p_project_id, v_uid, k2)
        ) s;
      end if;

      delete from public.user_permissions up
       where up.project_id = p_project_id
         and up.user_id = p_user_id
         and not (up.permission_key = any (v_new_permissions));

      insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
      select p_project_id, p_user_id, k, v_uid
      from unnest(v_new_permissions) as k
      on conflict (project_id, user_id, permission_key) do nothing;

      perform private.log_permission_diff(
        p_project_id, p_user_id, v_old_permissions,
        private.member_permission_keys(p_project_id, p_user_id), 'role_change'
      );
    end if;
  end if;

  if p_status is not null and p_status <> v_target_status then
    update public.project_members
       set status = p_status
     where project_id = p_project_id and user_id = p_user_id;

    perform private.log_activity(
      p_project_id, 'member.status_changed', 'member', p_user_id, private.profile_name(p_user_id),
      jsonb_build_object('status', v_target_status),
      jsonb_build_object('status', p_status)
    );
  end if;
end;
$$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.project_role;
  v_target_role public.project_role;
  v_target_status public.member_status;
  v_target_name text;
  v_target_email text;
  v_permissions text[];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'members.remove') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pm.role, pm.status
    into v_target_role, v_target_status
  from public.project_members pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  if v_target_role = 'owner' then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_OWNER';
  end if;

  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_SELF';
  end if;

  v_actor_role := private.member_role(p_project_id, v_uid);
  if v_actor_role <> 'owner' and private.role_rank(v_target_role) >= private.role_rank(v_actor_role) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_RANK';
  end if;

  v_target_name := private.profile_name(p_user_id);
  select p.email into v_target_email from public.profiles p where p.id = p_user_id;
  v_permissions := private.member_permission_keys(p_project_id, p_user_id);

  -- Cascades to user_permissions and un-assigns the member's tasks.
  delete from public.project_members
   where project_id = p_project_id and user_id = p_user_id;

  perform private.log_activity(
    p_project_id, 'member.removed', 'member', p_user_id, v_target_name,
    jsonb_build_object('role', v_target_role, 'status', v_target_status, 'permissions', to_jsonb(v_permissions)),
    null,
    jsonb_build_object('email', v_target_email)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
create or replace function public.set_member_permissions(
  p_project_id uuid,
  p_user_id uuid,
  p_permissions text[]
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.project_role;
  v_target_role public.project_role;
  v_desired text[];
  v_current text[];
  v_unknown text[];
  v_changed text[];
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'permissions.manage') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select pm.role into v_target_role
  from public.project_members pm
  where pm.project_id = p_project_id and pm.user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  if v_target_role = 'owner' then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_OWNER';
  end if;

  -- Nobody can change their own permissions (prevents self-escalation).
  if p_user_id = v_uid then
    raise exception using errcode = '42501', message = 'CANNOT_MODIFY_SELF';
  end if;

  v_actor_role := private.member_role(p_project_id, v_uid);
  if v_actor_role <> 'owner' and private.role_rank(v_target_role) >= private.role_rank(v_actor_role) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_RANK';
  end if;

  select coalesce(array_agg(distinct btrim(k)), '{}'::text[])
    into v_desired
  from unnest(coalesce(p_permissions, '{}'::text[])) as k
  where btrim(k) <> '';

  select coalesce(array_agg(k), '{}'::text[])
    into v_unknown
  from unnest(v_desired) as k
  where not exists (select 1 from public.permissions p where p.key = k);

  if cardinality(v_unknown) > 0 then
    raise exception using
      errcode = '22023',
      message = 'UNKNOWN_PERMISSION',
      detail = array_to_string(v_unknown, ', ');
  end if;

  v_current := private.member_permission_keys(p_project_id, p_user_id);

  select coalesce(array_agg(k), '{}'::text[])
    into v_changed
  from (
    (select unnest(v_desired) as k except select unnest(v_current))
    union
    (select unnest(v_current) as k except select unnest(v_desired))
  ) d;

  -- A non-owner can only grant or revoke permissions they hold themselves.
  if v_actor_role <> 'owner' and exists (
    select 1 from unnest(v_changed) as k
    where not private.member_has_permission(p_project_id, v_uid, k)
  ) then
    raise exception using errcode = '42501', message = 'PERMISSION_ESCALATION';
  end if;

  if cardinality(v_changed) = 0 then
    return v_current;
  end if;

  delete from public.user_permissions up
   where up.project_id = p_project_id
     and up.user_id = p_user_id
     and not (up.permission_key = any (v_desired));

  insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
  select p_project_id, p_user_id, k, v_uid
  from unnest(v_desired) as k
  on conflict (project_id, user_id, permission_key) do nothing;

  perform private.log_permission_diff(p_project_id, p_user_id, v_current, v_desired, 'manual');

  return private.member_permission_keys(p_project_id, p_user_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Read helpers
-- -----------------------------------------------------------------------------

-- Effective access of the caller in every project they belong to (or one).
create or replace function public.get_my_project_access(p_project_id uuid default null)
returns table (
  project_id uuid,
  project_name text,
  project_status public.project_status,
  role public.project_role,
  member_status public.member_status,
  permissions text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pm.project_id,
    p.name,
    p.status,
    pm.role,
    pm.status,
    private.effective_permission_keys(pm.project_id, pm.user_id)
  from public.project_members pm
  join public.projects p on p.id = pm.project_id
  where pm.user_id = (select auth.uid())
    and (p_project_id is null or pm.project_id = p_project_id)
  order by p.name;
$$;

-- Team overview for the Team page (requires team.view).
create or replace function public.get_project_team(p_project_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.project_role,
  status public.member_status,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  permissions text[],
  assigned_open_tasks bigint,
  assigned_total_tasks bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.has_permission(p_project_id, 'team.view') then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  return query
  select
    pm.user_id,
    pr.full_name,
    pr.email,
    pm.role,
    pm.status,
    pm.created_at,
    pr.last_sign_in_at,
    case
      when pm.role = 'owner' then (select coalesce(array_agg(k.key order by k.sort_order), '{}'::text[]) from public.permissions k)
      else private.member_permission_keys(pm.project_id, pm.user_id)
    end,
    coalesce(t.open_count, 0),
    coalesce(t.total_count, 0),
    a.last_at
  from public.project_members pm
  join public.profiles pr on pr.id = pm.user_id
  left join lateral (
    select
      count(*) filter (where tk.status in ('todo', 'in_progress', 'review')) as open_count,
      count(*) as total_count
    from public.tasks tk
    where tk.project_id = pm.project_id and tk.assigned_to = pm.user_id
  ) t on true
  left join lateral (
    select max(al.created_at) as last_at
    from public.activity_logs al
    where al.project_id = pm.project_id and al.actor_id = pm.user_id
  ) a on true
  where pm.project_id = p_project_id
  order by private.role_rank(pm.role) desc, lower(coalesce(nullif(pr.full_name, ''), pr.email));
end;
$$;

-- Dashboard aggregates. SECURITY INVOKER: every count respects the caller's
-- RLS visibility, so the dashboard automatically adapts to permissions.
create or replace function public.get_dashboard_stats(p_today date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with visible_projects as (
    select p.id, p.name, p.status from public.projects p
  ),
  visible_tasks as (
    select t.id, t.project_id, t.status, t.assigned_to, t.due_date from public.tasks t
  ),
  team_projects as (
    select project_id from private.project_ids_with_permission('team.view') as project_id
  ),
  team as (
    select distinct pm.user_id
    from public.project_members pm
    where pm.status = 'active'
      and pm.project_id in (select project_id from team_projects)
  )
  select jsonb_build_object(
    'total_projects', (select count(*) from visible_projects),
    'active_projects', (select count(*) from visible_projects where status = 'active'),
    'total_tasks', (select count(*) from visible_tasks),
    'active_tasks', (select count(*) from visible_tasks where status in ('todo', 'in_progress', 'review')),
    'completed_tasks', (select count(*) from visible_tasks where status = 'completed'),
    'overdue_tasks', (
      select count(*) from visible_tasks
      where due_date < p_today and status not in ('completed', 'rejected')
    ),
    'can_view_team', exists (select 1 from team_projects),
    'team_members', (select count(*) from team),
    'tasks_by_status', coalesce(
      (select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from visible_tasks group by status) s),
      '{}'::jsonb
    ),
    'tasks_by_member', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', m.assigned_to,
            'name', coalesce(private.profile_name(m.assigned_to), ''),
            'total', m.total,
            'open', m.open,
            'completed', m.completed
          )
          order by m.total desc
        )
        from (
          select
            assigned_to,
            count(*) as total,
            count(*) filter (where status in ('todo', 'in_progress', 'review')) as open,
            count(*) filter (where status = 'completed') as completed
          from visible_tasks
          where assigned_to is not null
          group by assigned_to
          order by count(*) desc
          limit 12
        ) m
      ),
      '[]'::jsonb
    ),
    'project_progress', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'project_id', vp.id,
            'name', vp.name,
            'status', vp.status,
            'total', coalesce(c.total, 0),
            'completed', coalesce(c.completed, 0)
          )
          order by vp.name
        )
        from visible_projects vp
        left join (
          select project_id, count(*) as total, count(*) filter (where status = 'completed') as completed
          from visible_tasks
          group by project_id
        ) c on c.project_id = vp.id
      ),
      '[]'::jsonb
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Platform administration
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_user_flags(
  p_user_id uuid,
  p_is_platform_admin boolean default null,
  p_can_create_projects boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old_admin boolean;
  v_old_create boolean;
  v_new_admin boolean;
  v_new_create boolean;
  v_changes record;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  if not private.is_platform_admin() then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  select p.is_platform_admin, p.can_create_projects
    into v_old_admin, v_old_create
  from public.profiles p
  where p.id = p_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  v_new_admin := coalesce(p_is_platform_admin, v_old_admin);
  v_new_create := coalesce(p_can_create_projects, v_old_create);

  if v_old_admin and not v_new_admin
     and (select count(*) from public.profiles p where p.is_platform_admin) <= 1 then
    raise exception using errcode = '42501', message = 'LAST_PLATFORM_ADMIN';
  end if;

  update public.profiles
     set is_platform_admin = v_new_admin,
         can_create_projects = v_new_create
   where id = p_user_id;

  select * into v_changes
  from private.jsonb_changes(
    jsonb_build_object('is_platform_admin', v_old_admin, 'can_create_projects', v_old_create),
    jsonb_build_object('is_platform_admin', v_new_admin, 'can_create_projects', v_new_create),
    array['is_platform_admin', 'can_create_projects']
  );

  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(
      null, 'platform_user.updated', 'platform_user', p_user_id, private.profile_name(p_user_id),
      v_changes.old_values, v_changes.new_values
    );
  end if;
end;
$$;

-- Bootstrap helper for trusted server-side code only (service role):
-- promotes a user to platform admin. Not executable by end users.
create or replace function public.bootstrap_platform_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' or coalesce(auth.jwt() ->> 'role', '') = 'anon' then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;

  update public.profiles
     set is_platform_admin = true,
         can_create_projects = true
   where id = p_user_id
     and not is_platform_admin;

  if found then
    perform private.log_activity(
      null, 'platform_user.updated', 'platform_user', p_user_id, private.profile_name(p_user_id),
      jsonb_build_object('is_platform_admin', false),
      jsonb_build_object('is_platform_admin', true),
      jsonb_build_object('reason', 'bootstrap')
    );
  end if;
end;
$$;
