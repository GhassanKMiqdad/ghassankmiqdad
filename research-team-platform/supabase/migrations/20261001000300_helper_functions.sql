-- =============================================================================
-- Internal helper functions (schema "private", never exposed via the API).
--
-- The permission helpers are SECURITY DEFINER so RLS policies can consult
-- project_members / user_permissions without recursing into those tables'
-- own policies. Every function pins search_path to '' and fully qualifies
-- object names to prevent search_path hijacking.
-- =============================================================================

-- Keeps updated_at current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the statement does not come from an end-user API request
-- (migrations, SQL editor, service-role scripts). Business-rule triggers only
-- apply to end-user requests; RLS is what protects the API surface.
create or replace function private.is_system_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', '') not in ('authenticated', 'anon');
$$;

-- Hierarchy used to stop non-owners from managing peers or superiors.
create or replace function private.role_rank(p_role public.project_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then 100
    when 'manager' then 50
    when 'reviewer' then 10
    when 'member' then 10
  end;
$$;

-- Core permission check for an arbitrary member.
--   * the member must be active;
--   * owners hold every permission;
--   * everybody else needs the project.view gate AND the requested key.
create or replace function private.member_has_permission(p_project_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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

-- Permission check for the current request's user.
create or replace function private.has_permission(p_project_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_has_permission(p_project_id, (select auth.uid()), p_permission);
$$;

-- All projects in which the current user holds a permission. Used in policies
-- as `project_id in (select private.project_ids_with_permission('x'))`, which
-- Postgres evaluates once per statement instead of once per row.
create or replace function private.project_ids_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
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
  select pm.role
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;
$$;

create or replace function private.is_active_member(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.status = 'active'
  );
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function private.can_create_projects()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_platform_admin or p.can_create_projects from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

-- Profiles the current user may see: themselves and the members of every
-- project they can access.
create or replace function private.visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid())
  union
  select other.user_id
  from public.project_members other
  where other.project_id in (select private.project_ids_with_permission('project.view'));
$$;

-- Existence check that bypasses RLS (used by the audit-log policy to expose
-- the trail of deleted projects to platform admins).
create or replace function private.project_exists(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.projects p where p.id = p_project_id);
$$;

create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function private.safe_inet(p_value text)
returns inet
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return btrim(p_value)::inet;
exception
  when others then
    return null;
end;
$$;

-- Display name snapshot used in audit entries.
create or replace function private.profile_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p
  where p.id = p_user_id;
$$;

-- Raw grants of a member, ordered like the catalog.
create or replace function private.member_permission_keys(p_project_id uuid, p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(up.permission_key order by p.sort_order), '{}'::text[])
  from public.user_permissions up
  join public.permissions p on p.key = up.permission_key
  where up.project_id = p_project_id
    and up.user_id = p_user_id;
$$;

-- Effective permissions of a member (what the checks above will allow).
create or replace function private.effective_permission_keys(p_project_id uuid, p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when pm.status <> 'active' then '{}'::text[]
    when pm.role = 'owner' then (select coalesce(array_agg(p.key order by p.sort_order), '{}'::text[]) from public.permissions p)
    when 'project.view' = any (private.member_permission_keys(p_project_id, p_user_id))
      then private.member_permission_keys(p_project_id, p_user_id)
    else '{}'::text[]
  end
  from public.project_members pm
  where pm.project_id = p_project_id
    and pm.user_id = p_user_id;
$$;

-- Default permissions for a role, limited to what the acting member holds
-- (a non-owner can never hand out a permission they do not have).
create or replace function private.template_permissions_for(
  p_project_id uuid,
  p_actor_id uuid,
  p_role public.project_role
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission_key order by p.sort_order), '{}'::text[])
  from public.role_permissions rp
  join public.permissions p on p.key = rp.permission_key
  where rp.role = p_role
    and (
      private.member_role(p_project_id, p_actor_id) = 'owner'
      or private.member_has_permission(p_project_id, p_actor_id, rp.permission_key)
    );
$$;
