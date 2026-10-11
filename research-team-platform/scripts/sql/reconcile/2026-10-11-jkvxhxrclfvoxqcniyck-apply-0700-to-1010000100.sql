-- NestHire production reconciliation, part 2 of 2 (owner-run).
--
-- Target:  Supabase project jkvxhxrclfvoxqcniyck ONLY. Never run elsewhere.
-- State required before running (verified 2026-10-11):
--   supabase_migrations.schema_migrations contains 20261001000100..20261001000600,
--   20261010000200 and the five manual MCP entries (12 rows); 20261001000700 absent.
--   Part 1 (catalog/constraint repair + migrations 0300..0600) was applied through
--   the Supabase MCP with the same guarded pattern; this file is the remainder.
--
-- What it does: applies the repository migrations 20261001000700 .. 20261010000100
-- (13 files) verbatim, comments removed, each in ONE transaction that
--   1. refuses to run unless the previous version is recorded and this one is not;
--   2. runs the migration body;
--   3. records the repository version in the ledger.
-- No drop of data, no reset, no seed, no deletion from the ledger.
--
-- Running it twice is safe: the first guard stops the second run before any change.
-- If it stops part-way, the committed migrations stay applied; check the ledger,
-- then run the remaining sections only (each starts with "-- ===== NN_").
--
-- Rehearsed 2026-10-11 on a replica in exactly the production state: exit 0,
-- ledger 25 rows, schema fingerprint identical (13/13 dimensions) to a fresh build
-- of all repository migrations and to the local Supabase stack.
-- See docs/DATABASE_READINESS.md for the verification queries.

-- ===== 05_20261001000700_rpc_functions.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000600')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000700') then
    raise exception 'RECONCILE_GUARD: 20261001000700 out of order or already applied';
  end if;
end;
$$;
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261001000700', 'rpc_functions');
commit;

-- ===== 06_20261001000800_row_level_security.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000700')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000800') then
    raise exception 'RECONCILE_GUARD: 20261001000800 out of order or already applied';
  end if;
end;
$$;
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
alter table public.user_permissions enable row level security;
revoke all on table public.user_permissions from anon, authenticated;
grant select on table public.user_permissions to authenticated;
create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or project_id in (select private.project_ids_with_permission('team.view'))
  );
alter table public.tasks enable row level security;
revoke all on table public.tasks from anon, authenticated;
grant select, delete on table public.tasks to authenticated;
grant insert (project_id, title, description, status, priority, assigned_to, due_date) on table public.tasks to authenticated;
grant update (title, description, status, priority, assigned_to, due_date) on table public.tasks to authenticated;
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
alter table public.comments enable row level security;
revoke all on table public.comments from anon, authenticated;
grant select, delete on table public.comments to authenticated;
grant insert (project_id, task_id, content) on table public.comments to authenticated;
grant update (content) on table public.comments to authenticated;
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
alter table public.activity_logs enable row level security;
revoke all on table public.activity_logs from anon, authenticated;
grant select on table public.activity_logs to authenticated;
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261001000800', 'row_level_security');
commit;

-- ===== 07_20261001000900_storage.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000800')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000900') then
    raise exception 'RECONCILE_GUARD: 20261001000900 out of order or already applied';
  end if;
end;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-documents',
  'project-documents',
  false,
  52428800, -- 50 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/x-tex',
    'application/x-bibtex',
    'application/zip',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
create or replace function private.is_registered_document_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name);
$$;
revoke execute on function private.is_registered_document_path(text) from public, anon;
grant execute on function private.is_registered_document_path(text) to authenticated, service_role;
create or replace function private.is_own_pending_upload(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner_id is not null
     and p_owner_id = (select auth.uid())::text
     and private.has_permission(private.try_uuid((storage.foldername(p_name))[1]), 'documents.upload')
     and not private.is_registered_document_path(p_name);
$$;
revoke execute on function private.is_own_pending_upload(text, text) from public, anon;
grant execute on function private.is_own_pending_upload(text, text) to authenticated, service_role;
create policy project_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.view')
      or private.is_own_pending_upload(name, owner_id)
    )
  );
create policy project_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.upload')
  );
create policy project_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and (
      private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'documents.delete')
      or private.is_own_pending_upload(name, owner_id)
    )
  );
insert into supabase_migrations.schema_migrations (version, name) values ('20261001000900', 'storage');
commit;

-- ===== 08_20261007000100_nesthire_roles_teams.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000900')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000100') then
    raise exception 'RECONCILE_GUARD: 20261007000100 out of order or already applied';
  end if;
end;
$$;
alter table public.profiles add column is_director boolean not null default false;
comment on column public.profiles.is_director is
  'Organization Director: every permission in every project, manages teams and roles. Changed only by set_user_director() or trusted server code.';
create type public.team_role as enum ('team_lead', 'team_member');
create type public.team_member_status as enum ('pending', 'active', 'inactive');
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint teams_description_length check (char_length(description) <= 2000)
);
comment on table public.teams is 'Teams of the organization. Written only through Director RPCs.';
create unique index teams_name_key on public.teams (lower(btrim(name)));
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  member_code text not null,
  job_title text not null default '',
  role public.team_role not null default 'team_member',
  status public.team_member_status not null default 'pending',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_display_name_length check (char_length(btrim(display_name)) between 1 and 120),
  constraint team_members_job_title_length check (char_length(job_title) <= 120),
  constraint team_members_member_code_format check (member_code ~ '^[A-Z]{2,4}$'),
  constraint team_members_team_code_key unique (team_id, member_code),
  constraint team_members_team_user_key unique (team_id, user_id)
);
comment on table public.team_members is
  'Team roster. A pending entry has no account yet; an active entry is linked to a user. Written only through Director RPCs.';
create index team_members_user_idx on public.team_members (user_id, team_id) where user_id is not null;
create table public.team_member_invites (
  team_member_id uuid primary key references public.team_members (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  constraint team_member_invites_email_length check (char_length(email) between 3 and 254)
);
create index team_member_invites_email_idx on public.team_member_invites (lower(email));
alter table public.projects add column team_id uuid references public.teams (id) on delete set null;
comment on column public.projects.team_id is
  'Team that works on the project. Its roster is synchronized into the project membership; completed task results are published to it.';
create index projects_team_idx on public.projects (team_id) where team_id is not null;
create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function private.set_updated_at();
create trigger team_members_set_updated_at
  before update on public.team_members
  for each row execute function private.set_updated_at();
alter table public.activity_logs drop constraint activity_logs_entity_type_check;
alter table public.activity_logs add constraint activity_logs_entity_type_check
  check (entity_type in ('project', 'task', 'document', 'comment', 'member', 'permissions', 'platform_user', 'team'));
create or replace function private.user_is_director(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_director from public.profiles p where p.id = p_user_id), false);
$$;
create or replace function private.is_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_director((select auth.uid()));
$$;
create or replace function private.my_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id
  from public.team_members tm
  where tm.user_id = (select auth.uid())
    and tm.status = 'active';
$$;
create or replace function private.is_team_lead(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = p_user_id
      and tm.role = 'team_lead'
      and tm.status = 'active'
  );
$$;
create or replace function private.team_member_code(p_team_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select tm.member_code
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = p_user_id;
$$;
create or replace function private.team_lead_permissions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'project.view',
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.edit_own', 'tasks.edit_assigned',
    'tasks.assign', 'tasks.review', 'tasks.delete',
    'documents.view', 'documents.upload', 'documents.edit',
    'comments.create', 'comments.delete',
    'team.view', 'activity.view', 'data.export'
  ]::text[];
$$;
create or replace function private.member_has_permission(p_project_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    private.user_is_director(p_user_id)
    and exists (select 1 from public.projects p where p.id = p_project_id)
  )
  or exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.status = 'active'
      and (
        pm.role = 'owner'
        or (
          exists (
            select 1 from public.user_permissions up
            where up.project_id = pm.project_id
              and up.user_id = pm.user_id
              and up.permission_key = 'project.view'
          )
          and exists (
            select 1 from public.user_permissions up
            where up.project_id = pm.project_id
              and up.user_id = pm.user_id
              and up.permission_key = p_permission
          )
        )
      )
  );
$$;
create or replace function private.project_ids_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.projects p
  where private.user_is_director((select auth.uid()))
  union
  select pm.project_id
  from public.project_members pm
  where pm.user_id = (select auth.uid())
    and pm.status = 'active'
    and (
      pm.role = 'owner'
      or (
        exists (
          select 1 from public.user_permissions up
          where up.project_id = pm.project_id
            and up.user_id = pm.user_id
            and up.permission_key = 'project.view'
        )
        and exists (
          select 1 from public.user_permissions up
          where up.project_id = pm.project_id
            and up.user_id = pm.user_id
            and up.permission_key = p_permission
        )
      )
    );
$$;
create or replace function private.member_role(p_project_id uuid, p_user_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.user_is_director(p_user_id) then 'owner'::public.project_role
    else (
      select pm.role
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = p_user_id
    )
  end;
$$;
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
    p.id,
    p.name,
    p.status,
    case when private.is_director() then 'owner'::public.project_role else pm.role end,
    case when private.is_director() then 'active'::public.member_status else pm.status end,
    case
      when private.is_director()
        then (select coalesce(array_agg(k.key order by k.sort_order), '{}'::text[]) from public.permissions k)
      else private.effective_permission_keys(pm.project_id, pm.user_id)
    end
  from public.projects p
  left join public.project_members pm
    on pm.project_id = p.id and pm.user_id = (select auth.uid())
  where (pm.user_id is not null or private.is_director())
    and (p_project_id is null or p.id = p_project_id)
  order by p.name;
$$;
create or replace function private.sync_team_member_projects(p_team_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members;
  v_project record;
  v_role public.project_role;
  v_permissions text[];
  v_old_permissions text[];
  v_existing public.project_members;
begin
  select * into v_member from public.team_members tm where tm.id = p_team_member_id;
  if not found or v_member.user_id is null then
    return;
  end if;

  v_role := case when v_member.role = 'team_lead' then 'manager'::public.project_role else 'member'::public.project_role end;
  if v_member.role = 'team_lead' then
    v_permissions := private.team_lead_permissions();
  else
    select coalesce(array_agg(rp.permission_key), '{}'::text[]) into v_permissions
    from public.role_permissions rp
    where rp.role = 'member';
  end if;

  for v_project in
    select p.id, p.name from public.projects p where p.team_id = v_member.team_id
  loop
    select * into v_existing
    from public.project_members pm
    where pm.project_id = v_project.id and pm.user_id = v_member.user_id;

    if v_member.status <> 'active' then
      -- Deactivated roster entries lose access (owners excepted).
      if found and v_existing.role <> 'owner' and v_existing.status = 'active' then
        update public.project_members set status = 'suspended'
         where project_id = v_project.id and user_id = v_member.user_id;
        perform private.log_activity(
          v_project.id, 'member.status_changed', 'member', v_member.user_id, private.profile_name(v_member.user_id),
          jsonb_build_object('status', 'active'), jsonb_build_object('status', 'suspended'),
          jsonb_build_object('reason', 'team_sync', 'team_id', v_member.team_id)
        );
      end if;
      continue;
    end if;

    if not found then
      insert into public.project_members (project_id, user_id, role, status, added_by)
      values (v_project.id, v_member.user_id, v_role, 'active', auth.uid());

      insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
      select v_project.id, v_member.user_id, k, auth.uid()
      from unnest(v_permissions) as k
      on conflict (project_id, user_id, permission_key) do nothing;

      perform private.log_activity(
        v_project.id, 'member.added', 'member', v_member.user_id, private.profile_name(v_member.user_id), null,
        jsonb_build_object('role', v_role, 'status', 'active', 'permissions', to_jsonb(v_permissions)),
        jsonb_build_object('reason', 'team_sync', 'team_id', v_member.team_id)
      );
      continue;
    end if;

    if v_existing.role = 'owner' then
      continue;
    end if;

    if v_existing.status <> 'active' then
      update public.project_members set status = 'active'
       where project_id = v_project.id and user_id = v_member.user_id;
      perform private.log_activity(
        v_project.id, 'member.status_changed', 'member', v_member.user_id, private.profile_name(v_member.user_id),
        jsonb_build_object('status', v_existing.status), jsonb_build_object('status', 'active'),
        jsonb_build_object('reason', 'team_sync', 'team_id', v_member.team_id)
      );
    end if;

    if v_existing.role <> v_role then
      update public.project_members set role = v_role
       where project_id = v_project.id and user_id = v_member.user_id;
      perform private.log_activity(
        v_project.id, 'member.role_changed', 'member', v_member.user_id, private.profile_name(v_member.user_id),
        jsonb_build_object('role', v_existing.role), jsonb_build_object('role', v_role),
        jsonb_build_object('reason', 'team_sync', 'team_id', v_member.team_id)
      );

      v_old_permissions := private.member_permission_keys(v_project.id, v_member.user_id);
      delete from public.user_permissions up
       where up.project_id = v_project.id
         and up.user_id = v_member.user_id
         and not (up.permission_key = any (v_permissions));
      insert into public.user_permissions (project_id, user_id, permission_key, granted_by)
      select v_project.id, v_member.user_id, k, auth.uid()
      from unnest(v_permissions) as k
      on conflict (project_id, user_id, permission_key) do nothing;
      perform private.log_permission_diff(
        v_project.id, v_member.user_id, v_old_permissions,
        private.member_permission_keys(v_project.id, v_member.user_id), 'team_role'
      );
    end if;
  end loop;

  -- Tasks planned for this roster entry before the person had an account are
  -- assigned to them now (audited and notified by the tasks triggers).
  if v_member.status = 'active' then
    update public.tasks t
       set assigned_to = v_member.user_id
     where t.responsible_member_id = v_member.id
       and t.assigned_to is null
       and private.is_active_member(t.project_id, v_member.user_id);
  end if;
end;
$$;
create or replace function private.link_pending_team_memberships(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member record;
begin
  if p_user_id is null or coalesce(btrim(p_email), '') = '' then
    return;
  end if;

  for v_member in
    select tm.id, tm.team_id, tm.display_name, t.name as team_name
    from public.team_members tm
    join public.team_member_invites i on i.team_member_id = tm.id
    join public.teams t on t.id = tm.team_id
    where tm.user_id is null
      and tm.status = 'pending'
      and lower(i.email) = lower(btrim(p_email))
      and not exists (
        select 1 from public.team_members other
        where other.team_id = tm.team_id and other.user_id = p_user_id
      )
  loop
    update public.team_members
       set user_id = p_user_id, status = 'active'
     where id = v_member.id;

    perform private.log_activity(
      null, 'team.member_linked', 'team', v_member.team_id, v_member.team_name,
      null,
      jsonb_build_object('team_member_id', v_member.id, 'user_id', p_user_id, 'status', 'active'),
      jsonb_build_object('display_name', v_member.display_name, 'reason', 'email_confirmed')
    );

    perform private.sync_team_member_projects(v_member.id);
  end loop;
end;
$$;
create or replace function private.handle_auth_user_team_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform private.link_pending_team_memberships(new.id, new.email);
  end if;
  return new;
end;
$$;
create trigger on_auth_user_team_link
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user_team_link();
grant execute on function private.handle_auth_user_team_link() to supabase_auth_admin;
create or replace function private.require_director()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;
  if not private.user_is_director(v_uid) then
    raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
  end if;
  return v_uid;
end;
$$;
create or replace function public.set_user_director(p_user_id uuid, p_is_director boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean;
begin
  perform private.require_director();

  select p.is_director into v_old from public.profiles p where p.id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  if v_old = coalesce(p_is_director, false) then
    return;
  end if;

  if v_old and (select count(*) from public.profiles p where p.is_director) <= 1 then
    raise exception using errcode = '42501', message = 'LAST_DIRECTOR';
  end if;

  update public.profiles set is_director = coalesce(p_is_director, false) where id = p_user_id;

  perform private.log_activity(
    null, 'platform_user.director_changed', 'platform_user', p_user_id, private.profile_name(p_user_id),
    jsonb_build_object('is_director', v_old),
    jsonb_build_object('is_director', coalesce(p_is_director, false))
  );
end;
$$;
create or replace function public.create_team(p_name text, p_description text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_director();
  v_id uuid;
begin
  insert into public.teams (name, description, created_by)
  values (btrim(p_name), coalesce(btrim(p_description), ''), v_uid)
  returning id into v_id;

  perform private.log_activity(
    null, 'team.created', 'team', v_id, btrim(p_name), null,
    jsonb_build_object('name', btrim(p_name), 'description', coalesce(btrim(p_description), ''))
  );
  return v_id;
end;
$$;
create or replace function public.update_team(p_team_id uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.teams;
  v_changes record;
begin
  perform private.require_director();

  select * into v_old from public.teams t where t.id = p_team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  update public.teams
     set name = btrim(p_name), description = coalesce(btrim(p_description), '')
   where id = p_team_id;

  select * into v_changes
  from private.jsonb_changes(
    jsonb_build_object('name', v_old.name, 'description', v_old.description),
    jsonb_build_object('name', btrim(p_name), 'description', coalesce(btrim(p_description), '')),
    array['name', 'description']
  );
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(null, 'team.updated', 'team', p_team_id, btrim(p_name), v_changes.old_values, v_changes.new_values);
  end if;
end;
$$;
create or replace function public.upsert_team_member(
  p_team_id uuid,
  p_member_id uuid,
  p_display_name text,
  p_member_code text,
  p_job_title text,
  p_role public.team_role,
  p_invite_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_director();
  v_team_name text;
  v_old public.team_members;
  v_id uuid;
  v_email text := nullif(lower(btrim(coalesce(p_invite_email, ''))), '');
  v_changes record;
  v_user uuid;
begin
  select t.name into v_team_name from public.teams t where t.id = p_team_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

  if p_member_id is null then
    insert into public.team_members (team_id, display_name, member_code, job_title, role, status, added_by)
    values (
      p_team_id, btrim(p_display_name), upper(btrim(p_member_code)), coalesce(btrim(p_job_title), ''),
      coalesce(p_role, 'team_member'), 'pending', v_uid
    )
    returning id into v_id;

    perform private.log_activity(
      null, 'team.member_added', 'team', p_team_id, v_team_name, null,
      jsonb_build_object(
        'team_member_id', v_id, 'display_name', btrim(p_display_name), 'member_code', upper(btrim(p_member_code)),
        'job_title', coalesce(btrim(p_job_title), ''), 'role', coalesce(p_role, 'team_member')
      )
    );
  else
    select * into v_old from public.team_members tm where tm.id = p_member_id and tm.team_id = p_team_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
    end if;

    update public.team_members
       set display_name = btrim(p_display_name),
           member_code = upper(btrim(p_member_code)),
           job_title = coalesce(btrim(p_job_title), ''),
           role = coalesce(p_role, v_old.role)
     where id = p_member_id;
    v_id := p_member_id;

    select * into v_changes
    from private.jsonb_changes(
      jsonb_build_object('display_name', v_old.display_name, 'member_code', v_old.member_code,
                         'job_title', v_old.job_title, 'role', v_old.role),
      jsonb_build_object('display_name', btrim(p_display_name), 'member_code', upper(btrim(p_member_code)),
                         'job_title', coalesce(btrim(p_job_title), ''), 'role', coalesce(p_role, v_old.role)),
      array['display_name', 'member_code', 'job_title', 'role']
    );
    if v_changes.new_values <> '{}'::jsonb then
      perform private.log_activity(
        null,
        case when v_changes.new_values ? 'role' then 'team.role_changed' else 'team.member_updated' end,
        'team', p_team_id, v_team_name, v_changes.old_values, v_changes.new_values,
        jsonb_build_object('team_member_id', v_id, 'display_name', btrim(p_display_name), 'user_id', v_old.user_id)
      );
    end if;
  end if;

  if v_email is null then
    delete from public.team_member_invites where team_member_id = v_id;
  else
    insert into public.team_member_invites (team_member_id, email)
    values (v_id, v_email)
    on conflict (team_member_id) do update set email = excluded.email;

    -- An account with this e-mail may already exist and be confirmed.
    if (select tm.user_id from public.team_members tm where tm.id = v_id) is null then
      select p.id into v_user from public.profiles p where lower(p.email) = v_email;
      if v_user is not null and exists (
        select 1 from auth.users u where u.id = v_user and u.email_confirmed_at is not null
      ) then
        perform private.link_pending_team_memberships(v_user, v_email);
      end if;
    end if;
  end if;

  perform private.sync_team_member_projects(v_id);
  return v_id;
end;
$$;
create or replace function public.link_team_member(p_member_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members;
  v_user uuid;
  v_team_name text;
begin
  perform private.require_director();

  select * into v_member from public.team_members tm where tm.id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  select p.id into v_user from public.profiles p where lower(p.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception using errcode = 'P0002', message = 'USER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.team_members tm
    where tm.team_id = v_member.team_id and tm.user_id = v_user and tm.id <> p_member_id
  ) then
    raise exception using errcode = '23505', message = 'ALREADY_MEMBER';
  end if;

  update public.team_members set user_id = v_user, status = 'active' where id = p_member_id;
  select t.name into v_team_name from public.teams t where t.id = v_member.team_id;

  perform private.log_activity(
    null, 'team.member_linked', 'team', v_member.team_id, v_team_name,
    jsonb_build_object('team_member_id', p_member_id, 'user_id', v_member.user_id, 'status', v_member.status),
    jsonb_build_object('team_member_id', p_member_id, 'user_id', v_user, 'status', 'active'),
    jsonb_build_object('display_name', v_member.display_name)
  );

  perform private.sync_team_member_projects(p_member_id);
  return v_user;
end;
$$;
create or replace function public.set_team_member_status(p_member_id uuid, p_status public.team_member_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members;
  v_team_name text;
begin
  perform private.require_director();

  select * into v_member from public.team_members tm where tm.id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  if p_status = 'active' and v_member.user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;
  if p_status = 'pending' and v_member.user_id is not null then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;
  if p_status = v_member.status then
    return;
  end if;

  update public.team_members set status = p_status where id = p_member_id;
  select t.name into v_team_name from public.teams t where t.id = v_member.team_id;

  perform private.log_activity(
    null, 'team.member_status_changed', 'team', v_member.team_id, v_team_name,
    jsonb_build_object('status', v_member.status), jsonb_build_object('status', p_status),
    jsonb_build_object('team_member_id', p_member_id, 'display_name', v_member.display_name, 'user_id', v_member.user_id)
  );

  perform private.sync_team_member_projects(p_member_id);
end;
$$;
create or replace function public.remove_team_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.team_members;
  v_team_name text;
begin
  perform private.require_director();

  select * into v_member from public.team_members tm where tm.id = p_member_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MEMBER_NOT_FOUND';
  end if;

  -- Revoke project access first (the sync reads the roster entry).
  if v_member.status = 'active' then
    update public.team_members set status = 'inactive' where id = p_member_id;
    perform private.sync_team_member_projects(p_member_id);
  end if;

  delete from public.team_members where id = p_member_id;
  select t.name into v_team_name from public.teams t where t.id = v_member.team_id;

  perform private.log_activity(
    null, 'team.member_removed', 'team', v_member.team_id, v_team_name,
    jsonb_build_object(
      'team_member_id', p_member_id, 'display_name', v_member.display_name, 'member_code', v_member.member_code,
      'role', v_member.role, 'user_id', v_member.user_id
    ),
    null
  );
end;
$$;
create or replace function public.set_project_team(p_project_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_member uuid;
begin
  perform private.require_director();

  select * into v_project from public.projects p where p.id = p_project_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams t where t.id = p_team_id) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  if v_project.team_id is not distinct from p_team_id then
    return;
  end if;

  update public.projects set team_id = p_team_id where id = p_project_id;
  update public.tasks set team_id = p_team_id where project_id = p_project_id;

  perform private.log_activity(
    p_project_id, 'project.team_changed', 'project', p_project_id, v_project.name,
    jsonb_build_object('team_id', v_project.team_id, 'team_name', (select t.name from public.teams t where t.id = v_project.team_id)),
    jsonb_build_object('team_id', p_team_id, 'team_name', (select t.name from public.teams t where t.id = p_team_id))
  );

  if p_team_id is not null then
    for v_member in select tm.id from public.team_members tm where tm.team_id = p_team_id and tm.user_id is not null loop
      perform private.sync_team_member_projects(v_member);
    end loop;
  end if;
end;
$$;
create or replace function public.get_team_invites(p_team_id uuid)
returns table (team_member_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_director();
  return query
  select i.team_member_id, i.email
  from public.team_member_invites i
  join public.team_members tm on tm.id = i.team_member_id
  where tm.team_id = p_team_id;
end;
$$;
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

  if not exists (select 1 from public.profiles p where p.is_director) then
    update public.profiles set is_director = true where id = p_user_id;
    if found then
      perform private.log_activity(
        null, 'platform_user.director_changed', 'platform_user', p_user_id, private.profile_name(p_user_id),
        jsonb_build_object('is_director', false),
        jsonb_build_object('is_director', true),
        jsonb_build_object('reason', 'bootstrap')
      );
    end if;
  end if;
end;
$$;
do $$
declare
  v_profile record;
begin
  for v_profile in select p.id from public.profiles p where p.is_platform_admin and not p.is_director loop
    update public.profiles set is_director = true where id = v_profile.id;
    perform private.log_activity(
      null, 'platform_user.director_changed', 'platform_user', v_profile.id, private.profile_name(v_profile.id),
      jsonb_build_object('is_director', false),
      jsonb_build_object('is_director', true),
      jsonb_build_object('reason', 'nesthire_upgrade')
    );
  end loop;
end;
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000100', 'nesthire_roles_teams');
commit;

-- ===== 09_20261007000200_nesthire_task_model.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000100')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000200') then
    raise exception 'RECONCILE_GUARD: 20261007000200 out of order or already applied';
  end if;
end;
$$;
alter type public.task_status rename to task_status_legacy;
create type public.task_status as enum (
  'not_started',
  'scheduled',
  'in_progress',
  'blocked',
  'submitted',
  'under_review',
  'revision_required',
  'approved',
  'completed',
  'cancelled'
);
alter table public.tasks alter column status drop default;
alter table public.tasks
  alter column status type public.task_status
  using (
    case status::text
      when 'todo' then 'not_started'
      when 'review' then 'submitted'
      when 'rejected' then 'cancelled'
      else status::text
    end
  )::public.task_status;
alter table public.tasks alter column status set default 'not_started';
drop type public.task_status_legacy;
alter type public.task_priority rename to task_priority_legacy;
create type public.task_priority as enum ('p0', 'p1', 'p2', 'p3');
alter table public.tasks alter column priority drop default;
alter table public.tasks
  alter column priority type public.task_priority
  using (
    case priority::text
      when 'critical' then 'p0'
      when 'high' then 'p1'
      when 'medium' then 'p2'
      else 'p3'
    end
  )::public.task_priority;
alter table public.tasks alter column priority set default 'p2';
drop type public.task_priority_legacy;
create type public.duration_unit as enum ('hours', 'days', 'weeks');
create type public.task_visibility as enum ('private', 'team');
create type public.submission_status as enum ('submitted', 'under_review', 'revision_required', 'approved');
create type public.review_decision as enum ('approved', 'revision_required');
alter table public.tasks
  add column task_code text,
  add column team_id uuid references public.teams (id) on delete set null,
  add column responsible_member_id uuid references public.team_members (id) on delete set null,
  add column original_instructions text not null default '',
  add column expected_output text not null default '',
  add column completion_criteria text not null default '',
  add column planning_month smallint not null default 1,
  add column planning_week smallint,
  add column planned_start_at timestamptz,
  add column planned_duration numeric(8, 2),
  add column duration_unit public.duration_unit,
  add column planned_duration_minutes integer,
  add column due_at timestamptz,
  add column due_at_overridden boolean not null default false,
  add column actual_start_at timestamptz,
  add column submitted_at timestamptz,
  add column approved_at timestamptz,
  add column progress smallint not null default 0,
  add column work_notes text not null default '',
  add column visibility public.task_visibility not null default 'private',
  add column published_at timestamptz;
comment on column public.tasks.task_code is 'Human task ID (e.g. M01-GH-01-01). Unique and immutable.';
comment on column public.tasks.responsible_member_id is
  'Roster entry responsible for the task. Lets a supervisor plan work for a member who has no account yet; assigned_to follows it.';
comment on column public.tasks.original_instructions is 'Instructions as given by the supervisor (kept as the reference).';
comment on column public.tasks.planning_month is 'Plan month (M01 = first month). Planning, not actual dates.';
comment on column public.tasks.planning_week is 'Plan week inside the month (Week 1–5). Planning, not actual dates.';
comment on column public.tasks.planned_duration_minutes is 'Duration normalized to minutes (server-calculated).';
comment on column public.tasks.due_at is 'Deadline. planned_start_at + duration unless due_at_overridden.';
comment on column public.tasks.actual_start_at is 'Set by the server when the task first moves to IN_PROGRESS.';
comment on column public.tasks.visibility is 'PRIVATE until marked as completed; never written by clients.';
update public.tasks
   set due_at = ((due_date + time '23:59') at time zone 'Asia/Gaza'),
       due_at_overridden = true
 where due_date is not null;
alter table public.tasks drop column due_date;
alter table public.tasks
  add constraint tasks_task_code_format check (task_code ~ '^[A-Z0-9]{1,12}(-[A-Z0-9]{1,12}){0,5}$'),
  add constraint tasks_original_instructions_length check (char_length(original_instructions) <= 10000),
  add constraint tasks_expected_output_length check (char_length(expected_output) <= 5000),
  add constraint tasks_completion_criteria_length check (char_length(completion_criteria) <= 5000),
  add constraint tasks_work_notes_length check (char_length(work_notes) <= 10000),
  add constraint tasks_planning_month_range check (planning_month between 1 and 99),
  add constraint tasks_planning_week_range check (planning_week is null or planning_week between 1 and 5),
  add constraint tasks_planned_duration_range check (planned_duration is null or (planned_duration > 0 and planned_duration <= 1000)),
  add constraint tasks_duration_unit_pair check ((planned_duration is null) = (duration_unit is null)),
  add constraint tasks_due_after_start check (due_at is null or planned_start_at is null or due_at >= planned_start_at),
  add constraint tasks_progress_range check (progress between 0 and 100);
create index tasks_team_idx on public.tasks (team_id) where team_id is not null;
create index tasks_responsible_member_idx on public.tasks (responsible_member_id) where responsible_member_id is not null;
create index tasks_project_due_at_idx on public.tasks (project_id, due_at) where due_at is not null;
create index tasks_assigned_due_at_idx on public.tasks (assigned_to, due_at) where assigned_to is not null;
create index tasks_planned_start_idx on public.tasks (planned_start_at) where planned_start_at is not null;
create index tasks_planning_idx on public.tasks (project_id, planning_month, planning_week);
create or replace function private.next_task_code_for(p_member_code text, p_month integer, p_week integer)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_next integer;
begin
  v_prefix := format(
    'M%s-%s-%s-',
    lpad(coalesce(p_month, 1)::text, 2, '0'),
    coalesce(nullif(p_member_code, ''), 'NA'),
    lpad(coalesce(p_week, 0)::text, 2, '0')
  );
  -- Serialize generators of the same prefix (concurrent inserts).
  perform pg_advisory_xact_lock(hashtext('task_code:' || v_prefix));

  select coalesce(max(substring(t.task_code from length(v_prefix) + 1)::integer), 0) + 1
    into v_next
  from public.tasks t
  where t.task_code like v_prefix || '%'
    and substring(t.task_code from length(v_prefix) + 1) ~ '^[0-9]{1,6}$';

  return v_prefix || lpad(v_next::text, 2, '0');
end;
$$;
create or replace function private.next_task_code(
  p_team_id uuid,
  p_assignee uuid,
  p_month integer,
  p_week integer
)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select private.next_task_code_for(private.team_member_code(p_team_id, p_assignee), p_month, p_week);
$$;
update public.tasks t
   set task_code = private.next_task_code(t.team_id, t.assigned_to, t.planning_month, t.planning_week)
 where t.task_code is null;
alter table public.tasks alter column task_code set not null;
alter table public.tasks alter column task_code set default '';
create unique index tasks_task_code_key on public.tasks (task_code);
create table public.task_dependencies (
  task_id uuid not null,
  depends_on_task_id uuid not null,
  project_id uuid not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_task_fkey foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade,
  constraint task_dependencies_predecessor_fkey foreign key (depends_on_task_id, project_id)
    references public.tasks (id, project_id) on delete cascade
);
comment on table public.task_dependencies is 'A task cannot start before all its predecessors are approved or completed.';
create index task_dependencies_predecessor_idx on public.task_dependencies (depends_on_task_id);
create or replace function private.valid_links(p_links text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_links), 0) <= 10
     and not exists (
       select 1 from unnest(coalesce(p_links, '{}'::text[])) as l
       where l !~ '^https?://[^\s]+$' or char_length(l) > 2048
     );
$$;
create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid not null,
  version integer not null,
  summary text not null,
  deliverable_links text[] not null default '{}',
  notes text not null default '',
  status public.submission_status not null default 'submitted',
  is_final boolean not null default false,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  constraint task_submissions_version_key unique (task_id, version),
  constraint task_submissions_version_positive check (version > 0),
  constraint task_submissions_summary_length check (char_length(btrim(summary)) between 1 and 10000),
  constraint task_submissions_notes_length check (char_length(notes) <= 5000),
  constraint task_submissions_links_valid check (private.valid_links(deliverable_links)),
  constraint task_submissions_task_fkey foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade
);
comment on table public.task_submissions is
  'Every submission and resubmission of a task as its own version. Private: visible only to whoever can see the task.';
create unique index task_submissions_single_final_idx on public.task_submissions (task_id) where is_final;
create table public.task_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  project_id uuid not null,
  submission_id uuid not null references public.task_submissions (id) on delete cascade,
  decision public.review_decision not null,
  comment text not null default '',
  required_changes text not null default '',
  additional_instructions text not null default '',
  previous_due_at timestamptz,
  new_due_at timestamptz,
  reviewer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_reviews_comment_length check (char_length(comment) <= 5000),
  constraint task_reviews_required_changes_length check (char_length(required_changes) <= 5000),
  constraint task_reviews_instructions_length check (char_length(additional_instructions) <= 5000),
  constraint task_reviews_task_fkey foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade
);
comment on table public.task_reviews is 'Review decisions on submissions. Private (supervisors and the responsible member).';
create index task_reviews_task_idx on public.task_reviews (task_id, created_at);
create table public.task_publications (
  task_id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  task_code text not null,
  title text not null,
  responsible_id uuid references public.profiles (id) on delete set null,
  responsible_name text,
  responsible_title text,
  final_result text not null,
  deliverable_links text[] not null default '{}',
  team_comment text not null default '',
  final_submission_version integer not null,
  completed_at timestamptz not null,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  constraint task_publications_team_comment_length check (char_length(team_comment) <= 5000),
  constraint task_publications_task_fkey foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade
);
comment on table public.task_publications is
  'Sanitized final result of a completed task, published to its team. Contains no drafts, earlier versions, review notes or private notes.';
create index task_publications_team_idx on public.task_publications (team_id, completed_at desc);
create index task_publications_project_idx on public.task_publications (project_id, completed_at desc);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint notifications_type_format check (type ~ '^[a-z_]+$')
);
comment on table public.notifications is 'In-app notifications. Written only by the database; users read and dismiss their own.';
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create or replace function private.notify(
  p_user_id uuid,
  p_type text,
  p_project_id uuid,
  p_task_id uuid,
  p_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id is not distinct from auth.uid() then
    return;
  end if;
  insert into public.notifications (user_id, project_id, task_id, type, data, actor_id, actor_name)
  values (p_user_id, p_project_id, p_task_id, p_type, coalesce(p_data, '{}'::jsonb), auth.uid(), private.profile_name(auth.uid()));
end;
$$;
insert into public.task_submissions (task_id, project_id, version, summary, submitted_by, submitted_at)
select t.id, t.project_id, 1, 'Submitted before the scheduling upgrade.', t.assigned_to, t.updated_at
from public.tasks t
where t.status = 'submitted';
update public.tasks t set submitted_at = t.updated_at where t.status = 'submitted' and t.submitted_at is null;
update public.tasks t set team_id = p.team_id from public.projects p where p.id = t.project_id and p.team_id is not null;
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000200', 'nesthire_task_model');
commit;

-- ===== 10_20261007000300_nesthire_task_rules.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000200')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000300') then
    raise exception 'RECONCILE_GUARD: 20261007000300 out of order or already applied';
  end if;
end;
$$;
create or replace function private.is_direct_api_write()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon') and not private.is_system_context();
$$;
create or replace function private.apply_task_schedule(p_task public.tasks)
returns public.tasks
language plpgsql
stable
set search_path = ''
as $$
declare
  v_task public.tasks := p_task;
begin
  if v_task.planned_duration is null then
    v_task.planned_duration_minutes := null;
  else
    v_task.planned_duration_minutes := round(
      v_task.planned_duration * case v_task.duration_unit
        when 'hours' then 60
        when 'days' then 1440
        when 'weeks' then 10080
      end
    )::integer;
  end if;

  if not v_task.due_at_overridden then
    if v_task.planned_start_at is not null and v_task.planned_duration_minutes is not null then
      v_task.due_at := v_task.planned_start_at + make_interval(mins => v_task.planned_duration_minutes);
    elsif v_task.due_at is not null then
      -- A deadline without start + duration is an explicit deadline.
      v_task.due_at_overridden := true;
    end if;
  elsif v_task.due_at is null then
    v_task.due_at_overridden := false;
    if v_task.planned_start_at is not null and v_task.planned_duration_minutes is not null then
      v_task.due_at := v_task.planned_start_at + make_interval(mins => v_task.planned_duration_minutes);
    end if;
  end if;

  -- NOT_STARTED <-> SCHEDULED follows whether a start is planned.
  if v_task.status = 'not_started' and v_task.planned_start_at is not null then
    v_task.status := 'scheduled';
  elsif v_task.status = 'scheduled' and v_task.planned_start_at is null then
    v_task.status := 'not_started';
  end if;

  return v_task;
end;
$$;
create or replace function private.apply_task_responsible(p_task public.tasks, p_old public.tasks)
returns public.tasks
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks := p_task;
  v_member public.team_members;
  v_insert boolean := p_old is null;
begin
  if v_task.responsible_member_id is not null
     and (v_insert or v_task.responsible_member_id is distinct from p_old.responsible_member_id) then
    select * into v_member from public.team_members tm where tm.id = v_task.responsible_member_id;
    if not found or v_member.team_id is distinct from v_task.team_id then
      raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
    end if;
    v_task.assigned_to := case
      when v_member.user_id is not null and private.is_active_member(v_task.project_id, v_member.user_id)
        then v_member.user_id
    end;
  elsif v_insert or v_task.assigned_to is distinct from p_old.assigned_to then
    if v_task.assigned_to is null then
      if not v_insert then
        v_task.responsible_member_id := null;
      end if;
    else
      select tm.id into v_task.responsible_member_id
      from public.team_members tm
      where tm.team_id = v_task.team_id and tm.user_id = v_task.assigned_to;
    end if;
  end if;
  return v_task;
end;
$$;
create or replace function private.task_member_code(p_task public.tasks)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select tm.member_code from public.team_members tm where tm.id = p_task.responsible_member_id),
    private.team_member_code(p_task.team_id, p_task.assigned_to)
  );
$$;
create or replace function private.task_has_open_dependencies(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_dependencies d
    join public.tasks p on p.id = d.depends_on_task_id
    where d.task_id = p_task_id
      and p.status not in ('approved', 'completed')
  );
$$;
create or replace function private.task_transition_allowed(
  p_from public.task_status,
  p_to public.task_status,
  p_is_supervisor boolean,
  p_is_executor boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from = p_to then true
    -- Start (or resume after a revision request); only a supervisor unblocks.
    when p_to = 'in_progress' then
      (p_from in ('not_started', 'scheduled', 'revision_required') and (p_is_supervisor or p_is_executor))
      or (p_from = 'blocked' and p_is_supervisor)
    when p_to = 'blocked' then
      p_from in ('not_started', 'scheduled', 'in_progress') and p_is_supervisor
    when p_to in ('not_started', 'scheduled') then
      p_from in ('blocked', 'cancelled', 'not_started', 'scheduled') and p_is_supervisor
    when p_to = 'cancelled' then
      p_from not in ('completed', 'cancelled') and p_is_supervisor
    else false
  end;
$$;
create or replace function private.tasks_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_supervisor boolean;
begin
  new.created_at := now();
  new.updated_at := now();
  -- The task follows the team of its project.
  new.team_id := (select p.team_id from public.projects p where p.id = new.project_id);

  -- Planning for a roster entry is an assignment decision.
  if private.is_direct_api_write() and new.responsible_member_id is not null
     and not private.has_permission(new.project_id, 'tasks.assign') then
    raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
  end if;
  new := private.apply_task_responsible(new, null);

  if private.is_direct_api_write() then
    if v_uid is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;

    if not private.has_permission(new.project_id, 'tasks.create') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;

    -- The creator is always the caller; it cannot be spoofed.
    new.created_by := v_uid;
    v_supervisor := private.has_permission(new.project_id, 'tasks.edit');

    if new.assigned_to is not null then
      -- Without tasks.assign a user may only assign a new task to themselves.
      if new.assigned_to <> v_uid and not private.has_permission(new.project_id, 'tasks.assign') then
        raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
      end if;
      if not private.is_active_member(new.project_id, new.assigned_to) then
        raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
      end if;
    end if;

    -- A new task starts in the plan; the workflow moves it forward.
    if new.status not in ('not_started', 'scheduled') then
      raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
    end if;

    -- Schedule and manual task IDs are supervisor decisions.
    if not v_supervisor and (
         new.planned_start_at is not null or new.planned_duration is not null or new.due_at is not null
         or new.planning_week is not null or new.planning_month <> 1
         or nullif(btrim(coalesce(new.task_code, '')), '') is not null
       ) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    -- Server-controlled fields.
    new.visibility := 'private';
    new.published_at := null;
    new.actual_start_at := null;
    new.submitted_at := null;
    new.approved_at := null;
    new.progress := 0;
    new.work_notes := '';
  end if;

  new.task_code := nullif(upper(btrim(coalesce(new.task_code, ''))), '');
  if new.task_code is null then
    new.task_code := private.next_task_code_for(private.task_member_code(new), new.planning_month, new.planning_week);
  end if;

  new := private.apply_task_schedule(new);
  new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) else null end;

  return new;
end;
$$;
create or replace function private.tasks_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_supervisor boolean;
  v_content boolean;
  v_executor boolean;
begin
  new.updated_at := now();

  if private.is_direct_api_write() and pg_trigger_depth() <= 1 then
    if v_uid is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;

    -- Identity and server-controlled fields never change through the API.
    if new.id is distinct from old.id
       or new.project_id is distinct from old.project_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.task_code is distinct from old.task_code
       or new.team_id is distinct from old.team_id
       or new.visibility is distinct from old.visibility
       or new.published_at is distinct from old.published_at
       or new.actual_start_at is distinct from old.actual_start_at
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_at is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at then
      raise exception using errcode = '42501', message = 'IMMUTABLE_FIELD';
    end if;

    v_supervisor := private.has_permission(old.project_id, 'tasks.edit');
    v_content := v_supervisor
      or (old.created_by = v_uid and private.has_permission(old.project_id, 'tasks.edit_own'));
    v_executor := old.assigned_to = v_uid and private.has_permission(old.project_id, 'tasks.edit_assigned');

    -- A completed (published) task is a closed record.
    if old.status = 'completed' then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if (new.title, new.description, new.original_instructions, new.expected_output, new.completion_criteria, new.priority)
         is distinct from
       (old.title, old.description, old.original_instructions, old.expected_output, old.completion_criteria, old.priority)
       and not v_content then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    -- Members can never change the plan or the schedule of their tasks.
    if (new.planning_month, new.planning_week, new.planned_start_at, new.planned_duration, new.duration_unit,
        new.due_at, new.due_at_overridden)
         is distinct from
       (old.planning_month, old.planning_week, old.planned_start_at, old.planned_duration, old.duration_unit,
        old.due_at, old.due_at_overridden)
       and not v_supervisor then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if (new.progress, new.work_notes) is distinct from (old.progress, old.work_notes)
       and not (v_executor or v_supervisor) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;

    if new.assigned_to is distinct from old.assigned_to
       or new.responsible_member_id is distinct from old.responsible_member_id then
      if not private.has_permission(old.project_id, 'tasks.assign') then
        raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
      end if;
      if new.assigned_to is not null and not private.is_active_member(old.project_id, new.assigned_to) then
        raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
      end if;
    end if;

    if new.status is distinct from old.status then
      if not private.task_transition_allowed(old.status, new.status, v_supervisor, v_executor) then
        raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
      end if;
      if new.status = 'in_progress' and private.task_has_open_dependencies(old.id) then
        raise exception using errcode = '42501', message = 'TASK_BLOCKED';
      end if;
    end if;
  end if;

  new := private.apply_task_responsible(new, old);

  -- Actual start: recorded by the server the first time work starts.
  if new.status = 'in_progress' and old.status is distinct from 'in_progress' and new.actual_start_at is null then
    new.actual_start_at := now();
  end if;

  if new.status is distinct from old.status then
    new.completed_at := case when new.status = 'completed' then coalesce(new.completed_at, now()) else null end;
  end if;

  new := private.apply_task_schedule(new);
  return new;
end;
$$;
create or replace function private.task_dependencies_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();

  if not private.is_system_context() then
    if auth.uid() is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;
    if not private.has_permission(new.project_id, 'tasks.edit') then
      raise exception using errcode = '42501', message = 'PERMISSION_DENIED';
    end if;
    new.created_by := auth.uid();
  end if;

  -- Reject cycles: the predecessor must not (transitively) depend on the task.
  if exists (
    with recursive chain (id) as (
      select d.depends_on_task_id from public.task_dependencies d where d.task_id = new.depends_on_task_id
      union
      select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.id
    )
    select 1 from chain where id = new.task_id
  ) then
    raise exception using errcode = '22023', message = 'DEPENDENCY_CYCLE';
  end if;

  return new;
end;
$$;
create trigger task_dependencies_before_insert
  before insert on public.task_dependencies
  for each row execute function private.task_dependencies_before_insert();
create or replace function public.schedule_status(p_task public.tasks)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_task.status in ('approved', 'completed') then 'completed'
    when p_task.status = 'cancelled' then 'cancelled'
    when p_task.status in ('submitted', 'under_review') then 'active'
    when p_task.due_at is not null and p_task.due_at < now() then 'overdue'
    when p_task.due_at is not null and p_task.due_at < now() + interval '24 hours' then 'due_soon'
    when p_task.status in ('in_progress', 'revision_required') or p_task.actual_start_at is not null then 'active'
    when p_task.planned_start_at is null and p_task.due_at is null then 'unscheduled'
    when p_task.planned_start_at is not null and p_task.planned_start_at > now() then 'scheduled'
    else 'not_started'
  end;
$$;
create or replace function public.is_blocked(p_task public.tasks)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_task.status = 'blocked'
      or (
        p_task.status in ('not_started', 'scheduled')
        and private.task_has_open_dependencies(p_task.id)
      );
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000300', 'nesthire_task_rules');
commit;

-- ===== 11_20261007000400_nesthire_workflow.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000300')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000400') then
    raise exception 'RECONCILE_GUARD: 20261007000400 out of order or already applied';
  end if;
end;
$$;
create or replace function private.responsible_name(p_assigned_to uuid, p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.profile_name(p_assigned_to),
    (select tm.display_name from public.team_members tm where tm.id = p_member_id)
  );
$$;
create or replace function private.can_see_task(p_project_id uuid, p_assigned_to uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_project_id, 'tasks.view')
      or (
        ((select auth.uid()) in (p_assigned_to, p_created_by))
        and private.has_permission(p_project_id, 'project.view')
      );
$$;
create or replace function private.lock_task_for_workflow(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id for update;
  if not found or not private.can_see_task(v_task.project_id, v_task.assigned_to, v_task.created_by) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND';
  end if;
  return v_task;
end;
$$;
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
  if p_task.assigned_to = auth.uid() and not private.is_director() then
    raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
  end if;
end;
$$;
create or replace function private.set_task_event_meta(p_meta jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('app.task_event_meta', coalesce(p_meta, '{}'::jsonb)::text, true);
$$;
create or replace function private.task_supervisor_ids(p_task public.tasks)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id
  from (
    select p_task.created_by as user_id
    union
    select tm.user_id
    from public.team_members tm
    where tm.team_id = p_task.team_id
      and tm.role = 'team_lead'
      and tm.status = 'active'
      and tm.user_id is not null
  ) s
  where s.user_id is not null
    and private.member_has_permission(p_task.project_id, s.user_id, 'tasks.review');
$$;
create or replace function public.submit_task(
  p_task_id uuid,
  p_summary text,
  p_deliverable_links text[] default '{}',
  p_notes text default ''
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

  select coalesce(max(s.version), 0) + 1 into v_version
  from public.task_submissions s where s.task_id = p_task_id;

  insert into public.task_submissions (task_id, project_id, version, summary, deliverable_links, notes, submitted_by)
  values (p_task_id, v_task.project_id, v_version, btrim(p_summary), v_links, coalesce(btrim(p_notes), ''), v_uid)
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

  update public.task_submissions set status = 'under_review' where id = v_submission.id;

  perform private.set_task_event_meta(jsonb_build_object('version', v_submission.version, 'submission_id', v_submission.id));
  update public.tasks set status = 'under_review' where id = p_task_id;
  perform private.set_task_event_meta(null);
end;
$$;
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

  if v_task.status not in ('submitted', 'under_review') then
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
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_INPUT';
  end if;

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
  v_recipient uuid;
begin
  perform private.assert_task_reviewer(v_task);

  if v_task.status <> 'approved' then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

  select * into v_final from public.task_submissions s
  where s.task_id = p_task_id and s.status = 'approved'
  order by s.version desc limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
  end if;

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
    final_result, deliverable_links, team_comment, final_submission_version, completed_at, published_by
  )
  values (
    v_task.id, v_task.project_id, v_task.team_id, v_task.task_code, v_task.title, v_task.assigned_to,
    private.profile_name(v_task.assigned_to),
    (select tm.job_title from public.team_members tm where tm.team_id = v_task.team_id and tm.user_id = v_task.assigned_to),
    v_final.summary, v_final.deliverable_links, coalesce(btrim(p_team_comment), ''), v_final.version, now(), v_uid
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
create or replace function private.task_status_event(p_from public.task_status, p_to public.task_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to = 'in_progress' and p_from = 'revision_required' then 'task.resumed'
    when p_to = 'in_progress' and p_from = 'blocked' then 'task.unblocked'
    when p_to = 'in_progress' then 'task.started'
    when p_to = 'submitted' and p_from = 'revision_required' then 'task.resubmitted'
    when p_to = 'submitted' then 'task.submitted'
    when p_to = 'under_review' then 'task.review_started'
    when p_to = 'revision_required' then 'task.revision_requested'
    when p_to = 'approved' then 'task.approved'
    when p_to = 'completed' then 'task.completed'
    when p_to = 'cancelled' then 'task.cancelled'
    when p_to = 'blocked' then 'task.blocked'
    when p_from = 'cancelled' then 'task.reopened'
    when p_to = 'scheduled' and p_from = 'not_started' then 'task.scheduled'
    when p_to = 'not_started' and p_from = 'scheduled' then 'task.unscheduled'
    when p_from = 'blocked' then 'task.unblocked'
    else 'task.status_changed'
  end;
$$;
create or replace function private.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes record;
  v_metadata jsonb := '{}'::jsonb;
  v_event_meta jsonb;
  v_label text;
begin
  -- Tasks removed together with their project are covered by project.deleted.
  if tg_op = 'DELETE' and not private.project_exists(old.project_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_label := new.task_code || ' · ' || new.title;
    perform private.log_activity(
      new.project_id, 'task.created', 'task', new.id, v_label, null,
      jsonb_build_object(
        'task_code', new.task_code, 'title', new.title, 'status', new.status, 'priority', new.priority,
        'assigned_to', new.assigned_to, 'responsible_member_id', new.responsible_member_id,
        'planning_month', new.planning_month, 'planning_week', new.planning_week,
        'planned_start_at', new.planned_start_at, 'planned_duration', new.planned_duration,
        'duration_unit', new.duration_unit, 'due_at', new.due_at
      ),
      jsonb_build_object('assignee_name', private.responsible_name(new.assigned_to, new.responsible_member_id))
    );
    perform private.notify(
      new.assigned_to, 'task_assigned', new.project_id, new.id,
      jsonb_build_object('task_code', new.task_code, 'task_title', new.title, 'due_at', new.due_at)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.log_activity(
      old.project_id, 'task.deleted', 'task', old.id, old.task_code || ' · ' || old.title,
      jsonb_build_object(
        'task_code', old.task_code, 'title', old.title, 'status', old.status, 'priority', old.priority,
        'assigned_to', old.assigned_to, 'due_at', old.due_at
      ),
      null,
      jsonb_build_object('assignee_name', private.profile_name(old.assigned_to))
    );
    return null;
  end if;

  -- UPDATE
  v_label := new.task_code || ' · ' || new.title;

  select * into v_changes
  from private.jsonb_changes(
    to_jsonb(old), to_jsonb(new),
    array['title', 'description', 'original_instructions', 'expected_output', 'completion_criteria', 'priority']
  );
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.updated', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  select * into v_changes
  from private.jsonb_changes(
    to_jsonb(old), to_jsonb(new),
    array['planning_month', 'planning_week', 'planned_start_at', 'planned_duration', 'duration_unit', 'due_at']
  );
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.schedule_changed', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  select * into v_changes
  from private.jsonb_changes(to_jsonb(old), to_jsonb(new), array['progress', 'work_notes']);
  if v_changes.new_values <> '{}'::jsonb then
    perform private.log_activity(new.project_id, 'task.progress_updated', 'task', new.id, v_label, v_changes.old_values, v_changes.new_values);
  end if;

  if new.status is distinct from old.status then
    begin
      v_event_meta := nullif(current_setting('app.task_event_meta', true), '')::jsonb;
    exception
      when others then
        v_event_meta := null;
    end;
    perform private.log_activity(
      new.project_id, private.task_status_event(old.status, new.status), 'task', new.id, v_label,
      jsonb_build_object('status', old.status),
      jsonb_strip_nulls(jsonb_build_object(
        'status', new.status,
        'actual_start_at', case when new.actual_start_at is distinct from old.actual_start_at then new.actual_start_at end,
        'submitted_at', case when new.submitted_at is distinct from old.submitted_at then new.submitted_at end,
        'approved_at', case when new.approved_at is distinct from old.approved_at then new.approved_at end,
        'completed_at', case when new.completed_at is distinct from old.completed_at then new.completed_at end
      )),
      coalesce(v_event_meta, '{}'::jsonb)
    );
  end if;

  if new.visibility is distinct from old.visibility then
    perform private.log_activity(
      new.project_id, 'task.published', 'task', new.id, v_label,
      jsonb_build_object('visibility', old.visibility),
      jsonb_build_object('visibility', new.visibility),
      jsonb_build_object('team_id', new.team_id)
    );
  end if;

  if new.assigned_to is distinct from old.assigned_to
     or new.responsible_member_id is distinct from old.responsible_member_id then
    -- Un-assignment caused by removing the assignee from the project.
    if new.assigned_to is null and old.assigned_to is not null and not exists (
      select 1 from public.project_members pm
      where pm.project_id = new.project_id and pm.user_id = old.assigned_to
    ) then
      v_metadata := jsonb_build_object('reason', 'member_removed');
    end if;

    perform private.log_activity(
      new.project_id, 'task.assigned', 'task', new.id, v_label,
      jsonb_build_object('assigned_to', old.assigned_to,
                         'assignee_name', private.responsible_name(old.assigned_to, old.responsible_member_id)),
      jsonb_build_object('assigned_to', new.assigned_to,
                         'assignee_name', private.responsible_name(new.assigned_to, new.responsible_member_id)),
      v_metadata
    );
    perform private.notify(
      new.assigned_to, 'task_assigned', new.project_id, new.id,
      jsonb_build_object('task_code', new.task_code, 'task_title', new.title, 'due_at', new.due_at)
    );
  end if;

  return null;
end;
$$;
create or replace function private.audit_task_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.task_dependencies := case when tg_op = 'DELETE' then old else new end;
  v_task text;
  v_predecessor text;
begin
  if tg_op = 'DELETE' and (
       not private.project_exists(old.project_id)
       or not exists (select 1 from public.tasks t where t.id = old.task_id)
       or not exists (select 1 from public.tasks t where t.id = old.depends_on_task_id)
     ) then
    return null;
  end if;

  select t.task_code || ' · ' || t.title into v_task from public.tasks t where t.id = v_row.task_id;
  select t.task_code into v_predecessor from public.tasks t where t.id = v_row.depends_on_task_id;

  perform private.log_activity(
    v_row.project_id,
    case when tg_op = 'INSERT' then 'task.dependency_added' else 'task.dependency_removed' end,
    'task', v_row.task_id, v_task,
    case when tg_op = 'DELETE' then jsonb_build_object('depends_on', v_row.depends_on_task_id, 'depends_on_code', v_predecessor) end,
    case when tg_op = 'INSERT' then jsonb_build_object('depends_on', v_row.depends_on_task_id, 'depends_on_code', v_predecessor) end
  );
  return null;
end;
$$;
create trigger task_dependencies_audit
  after insert or delete on public.task_dependencies
  for each row execute function private.audit_task_dependencies();
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
      count(*) filter (where tk.status not in ('completed', 'cancelled')) as open_count,
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
    select t.id, t.project_id, t.status, t.priority, t.assigned_to, t.due_at, public.schedule_status(t) as schedule
    from public.tasks t
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
    'active_tasks', (select count(*) from visible_tasks where status not in ('completed', 'cancelled')),
    'completed_tasks', (select count(*) from visible_tasks where status = 'completed'),
    'overdue_tasks', (select count(*) from visible_tasks where schedule = 'overdue'),
    'due_soon_tasks', (select count(*) from visible_tasks where schedule = 'due_soon'),
    'awaiting_review', (select count(*) from visible_tasks where status in ('submitted', 'under_review')),
    'awaiting_completion', (select count(*) from visible_tasks where status = 'approved'),
    'can_view_team', exists (select 1 from team_projects),
    'team_members', (select count(*) from team),
    'tasks_by_status', coalesce(
      (select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from visible_tasks group by status) s),
      '{}'::jsonb
    ),
    'tasks_by_priority', coalesce(
      (select jsonb_object_agg(s.priority, s.n) from (
        select priority, count(*) as n from visible_tasks where status not in ('completed', 'cancelled') group by priority
      ) s),
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
            'completed', m.completed,
            'overdue', m.overdue
          )
          order by m.total desc
        )
        from (
          select
            assigned_to,
            count(*) as total,
            count(*) filter (where status not in ('completed', 'cancelled')) as open,
            count(*) filter (where status = 'completed') as completed,
            count(*) filter (where schedule = 'overdue') as overdue
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
          select project_id, count(*) filter (where status <> 'cancelled') as total,
                 count(*) filter (where status = 'completed') as completed
          from visible_tasks
          group by project_id
        ) c on c.project_id = vp.id
      ),
      '[]'::jsonb
    )
  );
$$;
create or replace function public.get_execution_report(p_project_id uuid default null, p_planning_month integer default null)
returns table (
  user_id uuid,
  name text,
  total bigint,
  completed bigint,
  completed_on_time bigint,
  overdue bigint,
  in_review bigint,
  revisions bigint,
  submissions bigint,
  avg_start_delay_hours numeric,
  avg_completion_delay_hours numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select tk.*, public.schedule_status(tk) as schedule
    from public.tasks tk
    where tk.assigned_to is not null
      and (p_project_id is null or tk.project_id = p_project_id)
      and (p_planning_month is null or tk.planning_month = p_planning_month)
      and tk.status <> 'cancelled'
  )
  select
    t.assigned_to,
    coalesce(private.profile_name(t.assigned_to), ''),
    count(*),
    count(*) filter (where t.status = 'completed'),
    count(*) filter (where t.status in ('approved', 'completed') and t.due_at is not null
                     and coalesce(t.submitted_at, t.approved_at) <= t.due_at),
    count(*) filter (where t.schedule = 'overdue'),
    count(*) filter (where t.status in ('submitted', 'under_review')),
    (select count(*) from public.task_reviews r where r.task_id = any (array_agg(t.id)) and r.decision = 'revision_required'),
    (select count(*) from public.task_submissions s where s.task_id = any (array_agg(t.id))),
    round(avg(extract(epoch from (t.actual_start_at - t.planned_start_at)) / 3600)
          filter (where t.actual_start_at is not null and t.planned_start_at is not null)::numeric, 1),
    round(avg(extract(epoch from (coalesce(t.submitted_at, t.approved_at) - t.due_at)) / 3600)
          filter (where t.status in ('approved', 'completed') and t.due_at is not null)::numeric, 1)
  from t
  group by t.assigned_to
  order by 2;
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000400', 'nesthire_workflow');
commit;

-- ===== 12_20261007000500_nesthire_security.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000400')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000500') then
    raise exception 'RECONCILE_GUARD: 20261007000500 out of order or already applied';
  end if;
end;
$$;
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
revoke insert, update on table public.tasks from authenticated;
grant insert (
  project_id, title, description, original_instructions, expected_output, completion_criteria,
  status, priority, assigned_to, responsible_member_id, task_code, planning_month, planning_week,
  planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden
) on table public.tasks to authenticated;
grant update (
  title, description, original_instructions, expected_output, completion_criteria,
  status, priority, assigned_to, responsible_member_id, planning_month, planning_week,
  planned_start_at, planned_duration, duration_unit, due_at, due_at_overridden,
  progress, work_notes
) on table public.tasks to authenticated;
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000500', 'nesthire_security');
commit;

-- ===== 13_20261008000100_workflow_security_hardening.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000500')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000100') then
    raise exception 'RECONCILE_GUARD: 20261008000100 out of order or already applied';
  end if;
end;
$$;
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
create or replace function private.is_submitted_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.task_submissions s where p_document_id = any (s.document_ids));
$$;
create or replace function private.is_task_file_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.documents d where d.storage_path = p_name and d.task_id is not null);
$$;
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
create or replace function private.is_storage_link(p_link text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_link ~* '^https?://[^/]+/storage/v1/';
$$;
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
drop policy documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    (task_id is null and project_id in (select private.project_ids_with_permission('documents.view')))
    or (
      task_id is not null
      and (
        exists (select 1 from public.tasks t where t.id = documents.task_id)
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
drop policy task_publications_select on public.task_publications;
create policy task_publications_select on public.task_publications
  for select to authenticated
  using (project_id in (select private.project_ids_with_permission('project.view')));
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
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function public.submit_task(uuid, text, text[], text, uuid[]) from public, anon;
grant execute on function public.submit_task(uuid, text, text[], text, uuid[]) to authenticated, service_role;
insert into supabase_migrations.schema_migrations (version, name) values ('20261008000100', 'workflow_security_hardening');
commit;

-- ===== 14_20261008000200_final_privacy_hardening.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000100')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000200') then
    raise exception 'RECONCILE_GUARD: 20261008000200 out of order or already applied';
  end if;
end;
$$;
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
alter table public.tasks add column assigned_at timestamptz;
comment on column public.tasks.assigned_at is
  'Start of the current assignment (server-controlled). NULL for tasks assigned before this column existed: no window applies.';
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
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function public.submit_task(uuid, text, text[], text, uuid[]) from public, anon;
grant execute on function public.submit_task(uuid, text, text[], text, uuid[]) to authenticated, service_role;
insert into supabase_migrations.schema_migrations (version, name) values ('20261008000200', 'final_privacy_hardening');
commit;

-- ===== 15_20261008000300_strict_external_links.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000200')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000300') then
    raise exception 'RECONCILE_GUARD: 20261008000300 out of order or already applied';
  end if;
end;
$$;
create or replace function private.is_safe_external_link(p_link text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
  v_host_for_labels text;
  v_port text;
  v_significant_port text;
  v_labels text[];
  v_label text;
  v_ip inet;
begin
  if p_link is null or char_length(p_link) > 2048 then
    return false;
  end if;

  -- No credentials, whitespace/control characters, or non-HTTPS schemes.
  if p_link !~* '^https://[^/?#@\s]+([/?#][^\s]*)?$' then
    return false;
  end if;
  if private.is_storage_link(p_link) then
    return false;
  end if;

  v_authority := substring(lower(p_link) from '^https://([^/?#]+)');
  if v_authority is null or v_authority = '' then
    return false;
  end if;

  if left(v_authority, 1) = '[' then
    -- IPv6 literals must be bracketed and accepted by PostgreSQL's inet parser.
    if v_authority !~ '^\[[0-9a-f:.]+\](:[0-9]+)?$' then
      return false;
    end if;
    v_host := substring(v_authority from '^\[([0-9a-f:.]+)\]');
    v_port := substring(v_authority from '^\[[0-9a-f:.]+\]:([0-9]+)$');
    begin
      v_ip := v_host::inet;
    exception when others then
      return false;
    end;
    if family(v_ip) <> 6 then
      return false;
    end if;
  else
    if strpos(v_authority, ':') > 0 then
      if v_authority !~ '^[^:]+:[0-9]+$' then
        return false;
      end if;
      v_port := substring(v_authority from ':([0-9]+)$');
      v_host := left(v_authority, char_length(v_authority) - char_length(v_port) - 1);
    else
      v_host := v_authority;
    end if;

    if v_host is null or v_host = '' or char_length(v_host) > 254
       or v_host ~ '[^[:alnum:].-]'
       or v_host ~ '\.\.'
       or v_host ~ '(^|\.)-|-(\.|$)' then
      return false;
    end if;

    v_host_for_labels := case
      when right(v_host, 1) = '.' then left(v_host, char_length(v_host) - 1)
      else v_host
    end;
    if v_host_for_labels = '' or char_length(v_host_for_labels) > 253 then
      return false;
    end if;

    v_labels := string_to_array(v_host_for_labels, '.');
    foreach v_label in array v_labels loop
      if char_length(v_label) > 63
         or v_label !~ '^[[:alnum:]]([[:alnum:]-]{0,61}[[:alnum:]])?$' then
        return false;
      end if;
    end loop;

    -- Reject numeric hosts that are not valid IPv4 addresses (WHATWG URL parsing
    -- treats all-numeric dotted hosts as IP literals, not DNS names).
    if v_host ~ '^[0-9.]+$' then
      begin
        v_ip := v_host::inet;
      exception when others then
        return false;
      end;
      if family(v_ip) <> 4 or masklen(v_ip) <> 32 then
        return false;
      end if;
    end if;
  end if;

  if v_port is not null then
    -- Allow leading zeroes as URL parsers do, but bound the normalized port.
    v_significant_port := nullif(ltrim(v_port, '0'), '');
    if coalesce(char_length(v_significant_port), 0) > 5
       or coalesce(v_significant_port::integer, 0) > 65535 then
      return false;
    end if;
  end if;

  return true;
end;
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261008000300', 'strict_external_links');
commit;

-- ===== 16_20261009000100_export_rate_limit.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000300')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261009000100') then
    raise exception 'RECONCILE_GUARD: 20261009000100 out of order or already applied';
  end if;
end;
$$;
create table if not exists private.export_rate_limits (
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, project_id)
);
revoke all on table private.export_rate_limits from anon, authenticated;
create or replace function public.check_project_export_rate_limit(
  p_project_id uuid,
  p_limit integer default 5,
  p_window_seconds integer default 60
)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_row private.export_rate_limits%rowtype;
  v_elapsed numeric;
begin
  if v_user_id is null then
    return query select false, p_window_seconds;
    return;
  end if;
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_INPUT';
  end if;

  -- Serialize only this user/project pair; concurrent requests cannot bypass the cap.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_project_id::text, 0));
  select * into v_row
    from private.export_rate_limits
   where user_id = v_user_id and project_id = p_project_id
   for update;

  if not found or v_now >= v_row.window_started_at + make_interval(secs => p_window_seconds) then
    insert into private.export_rate_limits(user_id, project_id, window_started_at, request_count)
    values (v_user_id, p_project_id, v_now, 1)
    on conflict (user_id, project_id) do update
      set window_started_at = excluded.window_started_at, request_count = 1;
    return query select true, 0;
    return;
  end if;

  if v_row.request_count >= p_limit then
    v_elapsed := extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now));
    return query select false, greatest(1, ceil(v_elapsed)::integer);
    return;
  end if;

  update private.export_rate_limits
     set request_count = request_count + 1
   where user_id = v_user_id and project_id = p_project_id;
  return query select true, 0;
end;
$$;
revoke all on function public.check_project_export_rate_limit(uuid, integer, integer) from public, anon;
grant execute on function public.check_project_export_rate_limit(uuid, integer, integer) to authenticated;
insert into supabase_migrations.schema_migrations (version, name) values ('20261009000100', 'export_rate_limit');
commit;

-- ===== 17_20261010000100_nesthire_manager_self_review.sql =====
begin;
do $$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261009000100')
     or exists (select 1 from supabase_migrations.schema_migrations where version = '20261010000100') then
    raise exception 'RECONCILE_GUARD: 20261010000100 out of order or already applied';
  end if;
end;
$$;
create or replace function private.can_self_review_task(p_task public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_task.assigned_to = (select auth.uid())
    and private.has_permission(p_task.project_id, 'tasks.review')
    and (
      (select private.is_director())
      or exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_task.project_id
          and pm.user_id = (select auth.uid())
          and pm.role in ('owner', 'manager')
          and pm.status = 'active'
      )
    );
$$;
comment on function private.can_self_review_task(public.tasks) is
  'Allows only an active project owner/manager or Director to review their own assigned task.';
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
  if p_task.assigned_to = (select auth.uid())
     and not private.can_self_review_task(p_task) then
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
declare
  v_task public.tasks;
begin
  if p_submission.submitted_by = (select auth.uid()) then
    select t.* into v_task from public.tasks t where t.id = p_submission.task_id;
    if not found or not private.can_self_review_task(v_task) then
      raise exception using errcode = '42501', message = 'SELF_REVIEW_FORBIDDEN';
    end if;
  end if;
end;
$$;
comment on function private.assert_not_own_submission(public.task_submissions) is
  'Blocks self-review except for an active project owner/manager or Director assigned to the task.';
revoke execute on function private.can_self_review_task(public.tasks) from public, anon;
grant execute on function private.can_self_review_task(public.tasks) to authenticated, service_role;
insert into supabase_migrations.schema_migrations (version, name) values ('20261010000100', 'nesthire_manager_self_review');
commit;

