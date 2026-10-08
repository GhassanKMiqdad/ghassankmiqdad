-- =============================================================================
-- HISTORICAL — already applied to the hosted database on 2026-10-07.
-- Do NOT run it again (its first check refuses to). It contains base NestHire
-- migrations 20261007000100…000500 (including data-transforming steps: enum
-- replacement, due_date → due_at with DROP COLUMN due_date, tasks.view revoked
-- from members, Director bootstrap) plus the roster and month-1 data.
-- The current security upgrade is scripts/sql/nesthire-security-upgrade.sql.
-- =============================================================================

-- =============================================================================
-- NestHire — finish the live database upgrade (Supabase project vqorfahkecswjrqgizhy)
--
-- Paste ALL of this file in Supabase Dashboard → SQL Editor → New query → Run.
-- الصق محتوى هذا الملف كاملاً في Supabase ← SQL Editor ← New query ثم اضغط Run.
--
-- It runs as one transaction: either everything is applied or nothing is.
-- 1. The rest of migration 20261007000100 (its tables and helper functions are
--    already applied), then migrations 20261007000200 … 20261007000500,
--    recorded in supabase_migrations.schema_migrations.
-- 2. scripts/sql/nesthire-team.sql — the NestHire Team roster (9 members).
-- 3. scripts/sql/nesthire-month-01.sql — project "NestHire" + the 66 month-1
--    tasks, their descriptions, predecessors and schedule.
-- Running it a second time stops at the first check and changes nothing.
-- =============================================================================

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000500') then
    raise exception 'The NestHire upgrade is already applied: nothing to do.';
  end if;
  if to_regclass('public.teams') is null
     or not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'team_lead_permissions'
     )
     or exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname = 'require_director'
     ) then
    raise exception 'Unexpected database state: this script continues the interrupted upgrade only.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Migrations
-- ---------------------------------------------------------------------------

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

insert into supabase_migrations.schema_migrations (version, name) values ('20261007000100', 'nesthire_roles_teams') on conflict (version) do nothing;

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
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000200', 'nesthire_task_model') on conflict (version) do nothing;

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
      v_task.due_at_overridden := true;
    end if;
  elsif v_task.due_at is null then
    v_task.due_at_overridden := false;
    if v_task.planned_start_at is not null and v_task.planned_duration_minutes is not null then
      v_task.due_at := v_task.planned_start_at + make_interval(mins => v_task.planned_duration_minutes);
    end if;
  end if;
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
  new.team_id := (select p.team_id from public.projects p where p.id = new.project_id);
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
    new.created_by := v_uid;
    v_supervisor := private.has_permission(new.project_id, 'tasks.edit');
    if new.assigned_to is not null then
      if new.assigned_to <> v_uid and not private.has_permission(new.project_id, 'tasks.assign') then
        raise exception using errcode = '42501', message = 'TASK_ASSIGN_FORBIDDEN';
      end if;
      if not private.is_active_member(new.project_id, new.assigned_to) then
        raise exception using errcode = '22023', message = 'ASSIGNEE_NOT_MEMBER';
      end if;
    end if;
    if new.status not in ('not_started', 'scheduled') then
      raise exception using errcode = '42501', message = 'TASK_STATUS_FORBIDDEN';
    end if;
    if not v_supervisor and (
         new.planned_start_at is not null or new.planned_duration is not null or new.due_at is not null
         or new.planning_week is not null or new.planning_month <> 1
         or nullif(btrim(coalesce(new.task_code, '')), '') is not null
       ) then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;
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
    if old.status = 'completed' then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;
    if (new.title, new.description, new.original_instructions, new.expected_output, new.completion_criteria, new.priority)
         is distinct from
       (old.title, old.description, old.original_instructions, old.expected_output, old.completion_criteria, old.priority)
       and not v_content then
      raise exception using errcode = '42501', message = 'TASK_EDIT_FORBIDDEN';
    end if;
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000300', 'nesthire_task_rules') on conflict (version) do nothing;

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
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000400', 'nesthire_workflow') on conflict (version) do nothing;

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
insert into supabase_migrations.schema_migrations (version, name) values ('20261007000500', 'nesthire_security') on conflict (version) do nothing;


-- ---------------------------------------------------------------------------
-- 2. NestHire Team roster (scripts/sql/nesthire-team.sql)
-- ---------------------------------------------------------------------------

-- =============================================================================
-- NestHire team roster — one-time bootstrap for a hosted database.
-- Run in Supabase Dashboard → SQL Editor AFTER the 20261007* migrations.
--
-- * Creates "NestHire Team" with its nine roster entries (codes and titles).
-- * Links the GH entry (Team Lead) to the organization's Director account.
-- * The other eight entries stay PENDING: the Director adds each person's
--   e-mail in Teams → Edit member; their account is linked automatically when
--   they sign up and confirm that e-mail (or immediately if it already exists).
-- * No dates or tasks are created: the real plan is entered in the app.
-- Safe to run twice (existing entries are left unchanged).
-- =============================================================================

do $$
declare
  v_director uuid := (select p.id from public.profiles p where p.is_director order by p.created_at limit 1);
  v_team uuid;
  v_created boolean;
  v_entry record;
begin
  if v_director is null then
    raise exception 'No Director found. Run select public.bootstrap_platform_admin(''<user id>''); first.';
  end if;

  insert into public.teams (name, description, created_by)
  values ('NestHire Team', 'NestHire product team', v_director)
  on conflict ((lower(btrim(name)))) do nothing
  returning id into v_team;
  v_created := v_team is not null;
  if not v_created then
    select t.id into v_team from public.teams t where lower(btrim(t.name)) = 'nesthire team';
  end if;

  for v_entry in
    select * from (values
      ('GH', 'Ghassan Meqdad', 'Founder / Team Lead / ML Engineer / AI Lead', 'team_lead'),
      ('AB', 'Abdullah Fsfs', 'AI Engineering', 'team_member'),
      ('JA', 'Janna', 'UI/UX Designer', 'team_member'),
      ('AM', 'Ammar Ramadan', 'Frontend Developer', 'team_member'),
      ('BR', 'Baraa Al-Nabih', 'Backend Developer', 'team_member'),
      ('AS', 'Ashraf Al-Kahlout', 'ML Engineer', 'team_member'),
      ('BA', 'Bashar Badawi', 'ML Engineer', 'team_member'),
      ('IS', 'Israa Hamad', 'AI Integration', 'team_member'),
      ('AH', 'Ahmed Al-Gharabli', 'Mobile Developer', 'team_member')
    ) as r (code, name, title, role)
  loop
    insert into public.team_members (team_id, display_name, member_code, job_title, role, status, added_by, user_id)
    values (
      v_team, v_entry.name, v_entry.code, v_entry.title, v_entry.role::public.team_role,
      case when v_entry.code = 'GH' then 'active' else 'pending' end::public.team_member_status,
      v_director,
      case when v_entry.code = 'GH' then v_director end
    )
    on conflict (team_id, member_code) do nothing;
  end loop;

  if v_created then
    perform private.log_activity(
      null, 'team.created', 'team', v_team, 'NestHire Team', null,
      jsonb_build_object('name', 'NestHire Team', 'roster', 9), jsonb_build_object('reason', 'bootstrap')
    );
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Month-1 plan (scripts/sql/nesthire-month-01.sql)
-- ---------------------------------------------------------------------------

-- =============================================================================
-- NestHire — Month 1 plan (66 tasks)
--
-- Run once AFTER the 20261007* migrations and scripts/sql/nesthire-team.sql.
-- Safe to run again: existing task IDs and dependencies are left unchanged.
--
-- * Creates the project "NestHire" (owner: the Director) and links it to the
--   "NestHire Team", so the roster members work on it.
-- * Inserts every task with its exact ID, responsible roster member, planning
--   week, priority, description, expected output and completion criteria.
--   Members without an account yet are the responsible roster entry; the task
--   is assigned to their account automatically when it is linked.
-- * Schedule: Month 1 starts Sunday 11 October 2026; working days Sunday to
--   Thursday; tasks start at 09:00 Asia/Gaza and the deadline is start +
--   duration (calculated by the database).
-- * Dependent tasks never run in the same period: every task starts at or
--   after the deadline of each of its predecessors (verified at the end).
-- * Everything is executed as the Director, so the activity log shows who
--   planned the month.
-- =============================================================================

create temporary table m01_plan (
  code text primary key,
  member text not null,
  week smallint not null,
  priority public.task_priority not null,
  start_on date not null,
  days numeric not null,
  title text not null,
  description text not null,
  expected text not null,
  criteria text not null,
  depends text[] not null default '{}'
) on commit drop;

insert into m01_plan (code, member, week, priority, start_on, days, title, description, expected, criteria, depends) values
-- ---------------------------------------------------------------- Week 1 ----
('M01-GH-01-01', 'GH', 1, 'p0', '2026-10-11', 1,
 'تحديد نتيجة النجاح للـMVP وصاحب القرار النهائي',
 'تحديد ما الذي يجب أن يثبته الـMVP حتى نعتبره ناجحًا (نتيجة قابلة للقياس للعميل وللفريق)، ومن يملك القرار النهائي في النطاق والأولويات وقبول المخرجات، حتى لا تتوقف القرارات أثناء الشهر.',
 'وثيقة قصيرة: تعريف النجاح للـMVP بمؤشرات قابلة للقياس + صاحب القرار النهائي في كل نوع من القرارات.',
 'المؤشرات قابلة للقياس ومحددة بزمن، وصاحب القرار واضح لكل من النطاق والأولويات والقبول، ومشاركة الوثيقة مع الفريق.',
 '{}'),
('M01-GH-01-04', 'GH', 1, 'p0', '2026-10-12', 1,
 'تحديد المستخدم الأساسي والـMVP Core Workflow',
 'اختيار المستخدم الأساسي للـMVP (مثل مسؤول التوظيف في المؤسسة) ورسم المسار الأساسي الوحيد الذي يجب أن يعمل من البداية للنهاية: من نشر الوظيفة حتى نتيجة تقييم المرشح.',
 'وصف للمستخدم الأساسي (Persona مختصرة) + خطوات الـCore Workflow مرقّمة مع مدخلات ومخرجات كل خطوة.',
 'مستخدم أساسي واحد محدد، والمسار يغطي من الإدخال حتى النتيجة دون فجوات، ويعتمد عليه فريق UX والـBackend.',
 '{M01-GH-01-01}'),
('M01-GH-01-02', 'GH', 1, 'p0', '2026-10-13', 1,
 'تثبيت نطاق MVP وحدوده وإصدار Scope v1.0',
 'تثبيت ما يدخل في الـMVP وما يخرج منه صراحة (In / Out of scope) بناءً على تعريف النجاح والمسار الأساسي، وإصدار نسخة Scope v1.0 كمرجع لكل الفريق.',
 'وثيقة Scope v1.0: الميزات المشمولة، المستبعدة، الافتراضات، والقيود.',
 'كل ميزة مصنفة داخل أو خارج النطاق مع السبب، والوثيقة معتمدة من صاحب القرار ومنشورة للفريق.',
 '{M01-GH-01-01,M01-GH-01-04}'),
('M01-GH-01-06', 'GH', 1, 'p0', '2026-10-13', 1,
 'تحديد فرضيات القيمة الأساسية التي يجب اختبارها',
 'كتابة فرضيات القيمة التي يقوم عليها المنتج (لماذا سيدفع العميل، وما الألم الذي نحله) بصيغة قابلة للاختبار، وترتيبها حسب الخطورة لتوجيه مقابلات العملاء.',
 'قائمة فرضيات قيمة مرتبة حسب الأولوية، لكل فرضية: الصيغة، طريقة الاختبار، وما الذي يثبتها أو ينفيها.',
 'كل فرضية قابلة للاختبار بمقابلة أو تجربة، ومحدد لكل منها معيار قبول/رفض واضح.',
 '{M01-GH-01-04}'),
('M01-GH-01-03', 'GH', 1, 'p0', '2026-10-14', 1,
 'تثبيت الـ9 Job Dimensions المعتمدة ومعايير استخدامها',
 'اعتماد الأبعاد التسعة التي تُقيَّم عليها الوظيفة والمرشح، مع تعريف كل بعد ومتى يُستخدم وحدود استخدامه، لتكون الأساس المشترك لفرق Evidence والتقييم والـML.',
 'وثيقة الأبعاد التسعة: التعريف، أمثلة، معايير الاستخدام، وحالات عدم الانطباق لكل بعد.',
 'تسعة أبعاد معتمدة بتعريفات غير متداخلة، ومراجعة من فريق AI قبل اعتمادها.',
 '{M01-GH-01-02}'),
('M01-GH-01-05', 'GH', 1, 'p0', '2026-10-14', 2,
 'إعداد دليل مقابلات العملاء وقائمة المستهدفين',
 'تحويل فرضيات القيمة إلى دليل مقابلات (أسئلة مفتوحة غير موجِّهة) وتجهيز قائمة العملاء المستهدفين للجولة الأولى مع طريقة التواصل والمواعيد المقترحة.',
 'دليل مقابلة جاهز + قائمة مستهدفين (10 جهات على الأقل) مع جهة الاتصال وحالة التواصل.',
 'كل فرضية لها أسئلة تختبرها في الدليل، والقائمة كافية لإجراء الجولة الأولى في الأسبوع الثاني.',
 '{M01-GH-01-06}'),
-- ---------------------------------------------------------------- Week 2 ----
('M01-GH-02-01', 'GH', 2, 'p0', '2026-10-18', 5,
 'تنفيذ أول جولة مقابلات مع العملاء المستهدفين',
 'إجراء الجولة الأولى من مقابلات Customer Discovery باستخدام الدليل المعتمد، وتوثيق كل مقابلة بشكل منظم لتحليلها لاحقًا.',
 'محاضر مقابلات موحدة الشكل (اقتباسات، آلام، سلوك حالي، استعداد للدفع) لكل مقابلة.',
 'تنفيذ 5 مقابلات على الأقل وتوثيقها كاملة خلال الأسبوع.',
 '{M01-GH-01-05}'),
('M01-AB-01-01', 'AB', 2, 'p0', '2026-10-18', 1,
 'حصر حقول Evidence Object وتعريف كل حقل',
 'تحديد كل الحقول التي يحتاجها كائن الدليل (Evidence) لربط مقتطف من السيرة أو الإجابة ببعد من الأبعاد التسعة: المصدر، النص، البعد، الثقة، التاريخ... مع تعريف دقيق لكل حقل.',
 'جدول حقول Evidence Object: الاسم، النوع، إلزامي/اختياري، التعريف، ومثال.',
 'كل حقل له تعريف ونوع ومثال، والحقول تغطي ربط الدليل بالأبعاد التسعة ومصدره.',
 '{M01-GH-01-02,M01-GH-01-03}'),
('M01-JA-01-01', 'JA', 2, 'p0', '2026-10-18', 1,
 'تحديد المستخدمين وأهداف كل خطوة في رحلة التوظيف',
 'تحويل المستخدم الأساسي والمسار الأساسي إلى رحلة مستخدم: من يستخدم كل خطوة، وما هدفه، وما الذي يحتاج أن يراه أو يقرره.',
 'خريطة رحلة المستخدم (Journey) مع الهدف والاحتياج ونقاط الألم لكل خطوة.',
 'كل خطوة في الـCore Workflow لها مستخدم وهدف واضح، ومراجعة سريعة مع غسان.',
 '{M01-GH-01-04}'),
('M01-AB-01-02', 'AB', 2, 'p0', '2026-10-19', 1,
 'كتابة JSON Schema موحد للـEvidence Object',
 'تحويل جدول الحقول إلى JSON Schema رسمي يكون العقد الموحد بين الـAI والـBackend والواجهة.',
 'ملف JSON Schema موثّق مع أمثلة صالحة وغير صالحة.',
 'الـSchema يتحقق من الأمثلة الصالحة ويرفض غير الصالحة، ومتوافق مع جدول الحقول.',
 '{M01-AB-01-01}'),
('M01-JA-01-02', 'JA', 2, 'p0', '2026-10-19', 1,
 'رسم User Flow للمسار الأساسي للـMVP',
 'رسم تدفق الشاشات والقرارات للمسار الأساسي، بما في ذلك الحالات البديلة الأساسية (نقص بيانات، خطأ، حاجة لمراجعة).',
 'User Flow كامل للمسار الأساسي في Figma.',
 'التدفق يغطي المسار من البداية للنهاية مع الحالات البديلة، ويطابق الـCore Workflow.',
 '{M01-JA-01-01}'),
('M01-AB-01-03', 'AB', 2, 'p0', '2026-10-20', 1,
 'تعريف حالات Missing وContradicting وUnverifiable Evidence',
 'تحديد متى يُعتبر الدليل ناقصًا أو متناقضًا أو غير قابل للتحقق، وكيف يُمثَّل ذلك داخل الـSchema وما أثره على التقييم.',
 'تعريفات الحالات الثلاث مع أمثلة وقواعد التمثيل داخل Evidence Object.',
 'كل حالة لها تعريف قابل للتطبيق ومثالان على الأقل، وتمثيلها مدعوم في الـSchema.',
 '{M01-AB-01-02}'),
('M01-JA-01-03', 'JA', 2, 'p0', '2026-10-20', 2,
 'إنشاء Wireframes للمسارات الأساسية',
 'تصميم Wireframes منخفضة الدقة لكل شاشات المسار الأساسي وفق الـUser Flow المعتمد.',
 'Wireframes لكل شاشات المسار الأساسي مربوطة كنموذج قابل للنقر.',
 'كل خطوة في الـUser Flow لها شاشة، والنموذج قابل للعرض على الفريق.',
 '{M01-JA-01-02}'),
('M01-AH-01-01', 'AH', 2, 'p1', '2026-10-20', 2,
 'تحديد متطلبات Responsive Web وتجربة الشاشات الصغيرة',
 'تحديد ما يجب أن يعمل على الهاتف عبر الويب في الـMVP، ونقاط الانكسار، والسلوك المتوقع للشاشات الأساسية على الشاشات الصغيرة.',
 'قائمة متطلبات Responsive: الأحجام المدعومة، الشاشات ذات الأولوية، والتعديلات المطلوبة على الـFlow.',
 'المتطلبات مرتبطة بشاشات الـUser Flow ومراجعة مع جنا.',
 '{M01-JA-01-02}'),
('M01-AB-01-04', 'AB', 2, 'p0', '2026-10-21', 2,
 'إضافة اختبارات تحقق للـEvidence Schema',
 'كتابة اختبارات آلية تتحقق من الـSchema وحالات Missing وContradicting وUnverifiable حتى لا ينكسر العقد عند أي تعديل.',
 'مجموعة اختبارات آلية تعمل في الـRepository مع أمثلة لكل حالة.',
 'الاختبارات تغطي الحالات الصالحة وغير الصالحة والحالات الثلاث، وتنجح على الـSchema الحالي.',
 '{M01-AB-01-02,M01-AB-01-03}'),
('M01-JA-01-04', 'JA', 2, 'p0', '2026-10-22', 1,
 'مراجعة User Flow وWireframes مع Product وFrontend',
 'جلسة مراجعة مع غسان (Product) وعمار (Frontend) للتأكد من أن التصميم يحقق المسار وقابل للتنفيذ، وتوثيق التعديلات.',
 'محضر المراجعة + نسخة معتمدة من الـUser Flow والـWireframes.',
 'تعديلات المراجعة مطبقة، والتصميم معتمد من Product وFrontend.',
 '{M01-JA-01-03}'),
-- ---------------------------------------------------------------- Week 3 ----
('M01-GH-02-02', 'GH', 3, 'p0', '2026-10-25', 2,
 'تحليل نتائج المقابلات وتحديث فرضيات المنتج',
 'تجميع نتائج المقابلات وتحليلها مقابل فرضيات القيمة: ما الذي ثبت، وما الذي نُفي، وما الجديد، ثم تحديث الفرضيات.',
 'ملخص تحليل المقابلات + قائمة فرضيات محدّثة (مثبتة / منفية / تحتاج اختبارًا).',
 'كل فرضية لها حكم مدعوم بأدلة من المقابلات.',
 '{M01-GH-02-01}'),
('M01-AM-01-01', 'AM', 3, 'p1', '2026-10-25', 1,
 'تحويل الـUX المعتمد إلى Frontend Screen Specification',
 'تحويل الـWireframes المعتمدة إلى مواصفات شاشات للتطوير: المكونات، البيانات المعروضة، الحالات، والتفاعلات لكل شاشة.',
 'Frontend Screen Specification لكل شاشات المسار الأساسي.',
 'كل شاشة لها مكونات وبيانات وحالات واضحة، ومراجعة سريعة مع جنا.',
 '{M01-JA-01-04}'),
('M01-BR-01-01', 'BR', 3, 'p1', '2026-10-25', 1,
 'حصر كيانات النظام الأساسية ورسم ERD v0.1',
 'استخراج الكيانات الأساسية من النطاق والـEvidence Schema (المؤسسة، الوظيفة، المرشح، التقييم، الدليل...) ورسم ERD أولي.',
 'ERD v0.1 بالكيانات الأساسية وحقولها الرئيسية.',
 'كل كيان في النطاق ممثل، والـEvidence مرتبط بالكيانات الصحيحة.',
 '{M01-GH-01-02,M01-AB-01-02}'),
('M01-BR-01-06', 'BR', 3, 'p0', '2026-10-25', 1,
 'إنشاء Backend Foundation باستخدام FastAPI',
 'إنشاء هيكل مشروع الـBackend على FastAPI: الهيكل، الإعدادات، فحص الصحة، الـLogging، وتشغيل محلي موحد للفريق.',
 'Repository للـBackend يعمل محليًا مع Health Check وتعليمات تشغيل.',
 'أي عضو يستطيع تشغيل الخدمة محليًا باتباع التعليمات، والهيكل جاهز لإضافة الـAPIs.',
 '{}'),
('M01-IS-01-01', 'IS', 3, 'p1', '2026-10-25', 1,
 'رسم مراحل خط معالجة AI من الإدخال حتى النتيجة',
 'رسم مراحل خط معالجة الذكاء الاصطناعي: استقبال الملفات، الاستخراج، بناء الأدلة، التقييم، ثم النتيجة، مع مدخلات ومخرجات كل مرحلة.',
 'مخطط خط المعالجة (Pipeline) مع وصف كل مرحلة ومدخلاتها ومخرجاتها.',
 'كل مرحلة مرتبطة بالـEvidence Schema، والمخطط معتمد من فريق AI.',
 '{M01-GH-01-02,M01-AB-01-02}'),
('M01-AS-01-01', 'AS', 3, 'p1', '2026-10-25', 1,
 'تعريف Outcome لكل Job Dimension معتمد',
 'تحديد النتيجة (Outcome) التي يُخرجها التقييم لكل بعد من الأبعاد التسعة: المقياس، النطاق، وما الذي يعنيه كل مستوى.',
 'جدول Outcome لكل بعد: نوع الناتج، المقياس، وتفسير المستويات.',
 'كل الأبعاد التسعة لها Outcome محدد وقابل للتفسير.',
 '{M01-GH-01-03}'),
('M01-BA-01-01', 'BA', 3, 'p1', '2026-10-25', 1,
 'تحديد الحاجة الفعلية لـPredictive ML داخل MVP',
 'تقييم هل يحتاج الـMVP فعلًا إلى نموذج تنبؤي، أم تكفي القواعد والتقييم المبني على الأدلة، مع المخاطر والتكلفة لكل خيار.',
 'مذكرة قرار: الحاجة لـPredictive ML في الـMVP (نعم/لا/لاحقًا) مع المبررات.',
 'القرار مبني على النطاق والأبعاد ومعتمد من غسان.',
 '{M01-GH-01-02,M01-GH-01-03}'),
('M01-BR-01-02', 'BR', 3, 'p1', '2026-10-26', 1,
 'إنشاء Data Dictionary للكيانات والحقول الأساسية',
 'توثيق كل كيان وحقل في الـERD: النوع، القيود، الإلزامية، والمعنى، ليكون مرجعًا موحدًا للفريق.',
 'Data Dictionary كامل لكيانات ERD v0.1.',
 'كل حقل في الـERD موثق بنوعه وقيوده ومعناه.',
 '{M01-BR-01-01}'),
('M01-BR-01-03', 'BR', 3, 'p1', '2026-10-26', 1,
 'تحديد العلاقات بين المؤسسة والوظيفة والمرشح والتقييم والأدلة',
 'تحديد العلاقات وأنواعها (واحد لمتعدد...) وقواعد الحذف والملكية بين المؤسسة والوظيفة والمرشح والتقييم والأدلة.',
 'تحديث الـERD بالعلاقات وقواعدها.',
 'كل علاقة لها نوع وقاعدة حذف/ملكية واضحة.',
 '{M01-BR-01-01}'),
('M01-IS-01-02', 'IS', 3, 'p1', '2026-10-26', 1,
 'تعريف Job Status وTransitions الخاصة بالمعالجة',
 'تعريف حالات مهمة المعالجة (مثل Queued, Processing, Needs Review, Failed, Done) والانتقالات المسموحة بينها.',
 'مخطط حالات وانتقالات (State Machine) لمهام المعالجة.',
 'كل الحالات والانتقالات معرفة، بما في ذلك الفشل والمراجعة البشرية.',
 '{M01-IS-01-01}'),
('M01-AS-01-02', 'AS', 3, 'p1', '2026-10-26', 1,
 'تحديد مصادر الأدلة المطلوبة وحدود استخدامها',
 'تحديد مصادر الأدلة المقبولة لكل بعد (السيرة، الإجابات، الاختبارات...) وما لا يجوز استخدامه، ومتى يكون المصدر غير كافٍ.',
 'مصفوفة مصادر الأدلة لكل بعد مع حدود الاستخدام.',
 'لكل بعد مصادر مقبولة وممنوعة واضحة ومتوافقة مع تعريفات Evidence.',
 '{M01-AS-01-01,M01-AB-01-03}'),
('M01-BA-01-02', 'BA', 3, 'p1', '2026-10-26', 1,
 'تحديد الأدلة المطلوبة قبل استخدام أي Predictive ML',
 'تحديد البيانات والأدلة والشروط التي يجب توفرها قبل إدخال أي نموذج تنبؤي (حجم البيانات، جودتها، التحقق).',
 'قائمة شروط الجاهزية لاستخدام Predictive ML.',
 'الشروط قابلة للقياس ومرتبطة بقرار الحاجة.',
 '{M01-BA-01-01}'),
('M01-AM-01-02', 'AM', 3, 'p1', '2026-10-26', 1,
 'إنشاء هيكل التطبيق ومسارات الواجهات الأساسية',
 'إنشاء مشروع الواجهة وهيكل المجلدات والمسارات (Routes) للشاشات الأساسية وفق مواصفات الشاشات.',
 'تطبيق Frontend يعمل محليًا بمسارات لكل الشاشات الأساسية.',
 'كل شاشة في المواصفات لها مسار، والتطبيق يعمل بأمر واحد.',
 '{M01-AM-01-01}'),
('M01-GH-02-03', 'GH', 3, 'p0', '2026-10-27', 1,
 'مشاركة نتائج Customer Discovery مع الفريق واتخاذ القرارات',
 'عرض نتائج المقابلات والفرضيات المحدّثة على الفريق، واتخاذ القرارات المترتبة عليها وتوثيقها.',
 'عرض النتائج + سجل القرارات (Decision Log).',
 'كل قرار موثق مع صاحبه وأثره على النطاق أو الأولويات.',
 '{M01-GH-02-02}'),
('M01-BR-01-04', 'BR', 3, 'p1', '2026-10-27', 1,
 'تجميع واعتماد Data Contract v0.1',
 'تجميع الـERD والعلاقات والـData Dictionary في Data Contract موحد واعتماده من الفريق.',
 'وثيقة Data Contract v0.1 معتمدة.',
 'العقد متسق مع الـEvidence Schema ومعتمد من AI وFrontend.',
 '{M01-BR-01-02,M01-BR-01-03}'),
('M01-IS-01-03', 'IS', 3, 'p1', '2026-10-27', 1,
 'تحديد آلية Idempotency وRetry للمهام الحساسة',
 'تصميم آلية تمنع تكرار المعالجة عند إعادة الإرسال، وسياسة إعادة المحاولة (عدد المحاولات، الانتظار، متى نتوقف).',
 'مواصفة Idempotency وRetry لمهام المعالجة.',
 'كل مهمة حساسة لها مفتاح Idempotency وسياسة Retry واضحة.',
 '{M01-IS-01-02}'),
('M01-AS-01-03', 'AS', 3, 'p0', '2026-10-27', 1,
 'تحديد حالات Not Scorable ومتطلبات Human Review',
 'تحديد متى لا يجوز إعطاء تقييم (Not Scorable) ومتى يجب تحويل الحالة لمراجعة بشرية، وما المطلوب من المراجع.',
 'قواعد Not Scorable وHuman Review لكل بعد.',
 'كل حالة لها شرط واضح وإجراء محدد، ومتوافقة مع حالات الأدلة.',
 '{M01-AS-01-02}'),
('M01-BA-01-03', 'BA', 3, 'p1', '2026-10-27', 2,
 'تعريف ضوابط Data Leakage والاختبار خارج العينة',
 'تحديد قواعد منع تسرب البيانات بين التدريب والاختبار، وطريقة الاختبار خارج العينة لأي نموذج مستقبلي.',
 'وثيقة ضوابط Data Leakage وبروتوكول الاختبار خارج العينة.',
 'الضوابط قابلة للتطبيق ومراجعة من أشرف.',
 '{M01-BA-01-02}'),
('M01-AM-01-03', 'AM', 3, 'p1', '2026-10-27', 1,
 'إعداد TypeScript Linting وFormatting وقواعد الجودة',
 'إعداد TypeScript الصارم والـLinting والـFormatting وفحوص الجودة على مشروع الواجهة.',
 'إعدادات Lint وFormat وTypecheck تعمل بأوامر موحدة.',
 'المشروع ينجح في الفحوص بلا أخطاء، والقواعد موثقة للفريق.',
 '{M01-AM-01-02}'),
('M01-BR-01-05', 'BR', 3, 'p0', '2026-10-28', 1,
 'تحديد API Contract للمسار الأساسي للـMVP',
 'تحديد نقاط الـAPI للمسار الأساسي: المسارات، الطلبات، الاستجابات، والأخطاء، بناءً على الـData Contract ومواصفات الشاشات.',
 'API Contract (OpenAPI) للمسار الأساسي.',
 'كل شاشة في المسار الأساسي لها الـAPI الذي تحتاجه، والعقد معتمد من Frontend.',
 '{M01-BR-01-04,M01-AM-01-01}'),
('M01-BR-01-07', 'BR', 3, 'p0', '2026-10-28', 1,
 'إعداد PostgreSQL وتهيئة قاعدة البيانات الأولية',
 'إعداد PostgreSQL وإنشاء الجداول الأولية وفق الـData Contract مع آلية Migrations.',
 'قاعدة بيانات تعمل محليًا بجداول الـData Contract وأول Migration.',
 'الـMigrations تعمل من الصفر بلا أخطاء ومتوافقة مع الـERD.',
 '{M01-BR-01-04,M01-BR-01-06}'),
('M01-IS-01-04', 'IS', 3, 'p0', '2026-10-28', 1,
 'مراجعة PII وتدفق البيانات داخل خط AI',
 'تتبع البيانات الشخصية (PII) في كل مرحلة من خط المعالجة: أين تُخزن، من يصل إليها، وما الذي يُرسل لخدمات خارجية، مع ضوابط الحماية.',
 'خريطة تدفق البيانات الشخصية وقائمة ضوابط الحماية.',
 'كل حقل شخصي له مكان تخزين ومستوى وصول وضابط حماية محدد.',
 '{M01-IS-01-01,M01-BR-01-01}'),
('M01-AS-01-04', 'AS', 3, 'p1', '2026-10-28', 1,
 'توثيق ضوابط Explainability وFairness الأولية',
 'توثيق كيف يُفسَّر كل تقييم للمستخدم (لماذا هذه النتيجة) وضوابط العدالة الأولية لمنع التحيز.',
 'وثيقة ضوابط Explainability وFairness v0.1.',
 'لكل تقييم طريقة تفسير مرتبطة بالأدلة، وضوابط عدالة قابلة للفحص.',
 '{M01-AS-01-03}'),
('M01-AM-01-04', 'AM', 3, 'p1', '2026-10-28', 2,
 'إنشاء Frontend Shell باستخدام Mock Data',
 'بناء هيكل الواجهة (التخطيط، التنقل، الشاشات الأساسية) ببيانات تجريبية حتى يمكن عرض المسار كاملًا قبل ربط الـAPI.',
 'Frontend Shell قابل للتشغيل يعرض المسار الأساسي ببيانات Mock.',
 'يمكن المرور على المسار الأساسي كاملًا في المتصفح، والكود يجتاز فحوص الجودة.',
 '{M01-AM-01-02,M01-AM-01-03}'),
('M01-BR-01-08', 'BR', 3, 'p1', '2026-10-29', 1,
 'إعداد Validation وError Handling للمسار الأساسي',
 'تطبيق التحقق من المدخلات وصيغة موحدة للأخطاء في الـBackend وفق الـAPI Contract.',
 'طبقة Validation وError Handling موحدة مع أمثلة استجابات الأخطاء.',
 'الأخطاء تطابق الـAPI Contract، والمدخلات غير الصالحة تُرفض برسائل واضحة.',
 '{M01-BR-01-05,M01-BR-01-06}'),
-- ---------------------------------------------------------------- Week 4 ----
('M01-GH-02-04', 'GH', 4, 'p0', '2026-11-01', 1,
 'تحديد فرضية الـPilot ومعايير نجاحها',
 'بناءً على قرارات Discovery، تحديد فرضية تجربة الـPilot مع عميل حقيقي ومعايير نجاحها ومدتها.',
 'وثيقة Pilot: الفرضية، العميل المستهدف، المدة، ومعايير النجاح.',
 'معايير النجاح قابلة للقياس ومرتبطة بتعريف نجاح الـMVP.',
 '{M01-GH-02-03}'),
('M01-AB-02-01', 'AB', 4, 'p1', '2026-11-01', 2,
 'تنفيذ Parsing Spike محدود على عينات حقيقية',
 'تجربة محدودة لاستخراج النصوص من عينات حقيقية (سير ذاتية بصيغ مختلفة) لاختبار الجدوى التقنية.',
 'كود الـSpike ونتائج الاستخراج على العينات.',
 'تجربة على 20 عينة على الأقل بصيغ مختلفة مع نتائج موثقة.',
 '{M01-AB-01-04,M01-IS-01-01}'),
('M01-AS-02-01', 'AS', 4, 'p1', '2026-11-01', 1,
 'إعداد فحوص جودة وأهلية البيانات',
 'تحديد الفحوص التي تحكم هل البيانات المدخلة صالحة وكافية للتقييم (اكتمال، صيغة، حداثة...).',
 'قائمة فحوص جودة وأهلية مع معيار نجاح/فشل لكل فحص.',
 'كل فحص قابل للتطبيق آليًا ومرتبط بمصادر الأدلة.',
 '{M01-AS-01-02}'),
('M01-BA-02-01', 'BA', 4, 'p1', '2026-11-01', 2,
 'إعداد Golden Dataset أولي للحالات الأساسية',
 'تجهيز مجموعة بيانات مرجعية صغيرة مُعلَّمة يدويًا للحالات الأساسية، لاستخدامها في اختبار مخرجات الـAI.',
 'Golden Dataset أولي مع التعليمات (Labels) وطريقة الإعداد.',
 'الحالات تغطي الأبعاد الأساسية، والتعليم مراجع من شخص ثانٍ.',
 '{M01-AS-01-01,M01-AB-01-02}'),
('M01-IS-02-01', 'IS', 4, 'p1', '2026-11-01', 1,
 'إنشاء AI Trace Schema لكل تشغيل AI',
 'تصميم سجل تتبع لكل تشغيل AI (المدخلات المرجعية، النموذج، الإصدار، الزمن، النتيجة، الأخطاء) لتمكين التدقيق والتحليل.',
 'AI Trace Schema موثق مع مثال.',
 'كل تشغيل يمكن تتبعه وإعادة تفسيره، دون تخزين PII غير لازم.',
 '{M01-IS-01-02}'),
('M01-JA-02-01', 'JA', 4, 'p1', '2026-11-01', 2,
 'إعداد UI State Matrix للحالات الطبيعية والفشل والمراجعة',
 'تحديد شكل كل شاشة في كل حالة: تحميل، فارغ، نجاح، فشل، قيد المراجعة، Not Scorable، وفق حالات المعالجة.',
 'UI State Matrix لكل شاشات المسار الأساسي.',
 'كل شاشة × كل حالة لها تصميم أو قاعدة واضحة، ومتوافقة مع حالات المعالجة.',
 '{M01-JA-01-04,M01-IS-01-02}'),
('M01-AM-02-01', 'AM', 4, 'p1', '2026-11-01', 2,
 'ربط Frontend بالـAPI Contract باستخدام Mock/Stub',
 'استبدال البيانات التجريبية بطبقة API تطابق الـAPI Contract، مع Mock/Stub يحاكي الـBackend.',
 'طبقة API في الواجهة مربوطة بـMock Server يطابق العقد.',
 'كل شاشات المسار تعمل عبر طبقة الـAPI، والتبديل للـBackend الحقيقي لا يتطلب تغيير الشاشات.',
 '{M01-AM-01-04,M01-BR-01-05}'),
('M01-BR-02-01', 'BR', 4, 'p0', '2026-11-01', 2,
 'تنفيذ أول API للمسار الأساسي وربطه بقاعدة البيانات',
 'تنفيذ أول نقطة API حقيقية في المسار الأساسي مع القراءة والكتابة في PostgreSQL.',
 'API يعمل محليًا ومربوط بقاعدة البيانات مع اختبارات أساسية.',
 'الـAPI يطابق العقد، ويجتاز الاختبارات، ويعيد الأخطاء بالصيغة الموحدة.',
 '{M01-BR-01-05,M01-BR-01-07,M01-BR-01-08}'),
('M01-AH-02-01', 'AH', 4, 'p1', '2026-11-01', 1,
 'مراجعة Wireframes وتجربة UX على الهاتف',
 'مراجعة الـWireframes على شاشات الهاتف وتجربة المسار الأساسي عليها، وتوثيق المشاكل والتحسينات.',
 'تقرير مراجعة تجربة الهاتف مع قائمة التعديلات المقترحة.',
 'كل شاشة أساسية جُرّبت على مقاس هاتف، والملاحظات مشاركة مع جنا.',
 '{M01-AH-01-01,M01-JA-01-03}'),
('M01-GH-02-05', 'GH', 4, 'p0', '2026-11-02', 1,
 'مراجعة Scope مقابل نتائج Discovery واعتماد أي تعديل',
 'مقارنة Scope v1.0 بنتائج Discovery وفرضية الـPilot، واعتماد أي تعديل في النطاق وإبلاغ الفريق.',
 'Scope محدّث (أو تأكيد عدم التغيير) مع سجل التعديلات.',
 'كل تعديل مبرر بنتيجة من Discovery ومعتمد ومنشور للفريق.',
 '{M01-GH-02-03,M01-GH-02-04}'),
('M01-AS-02-02', 'AS', 4, 'p0', '2026-11-02', 2,
 'إصدار Not Scorable Policy v0.1',
 'تحويل قواعد Not Scorable وفحوص الأهلية إلى سياسة رسمية v0.1 تُطبق في المنتج.',
 'وثيقة Not Scorable Policy v0.1.',
 'السياسة تغطي كل الأبعاد وتربط كل حالة بفحص وإجراء، ومعتمدة من غسان.',
 '{M01-AS-01-03,M01-AS-02-01}'),
('M01-IS-02-02', 'IS', 4, 'p1', '2026-11-02', 1,
 'تحديد مؤشرات زمن المعالجة والفشل والتكلفة',
 'تحديد المؤشرات التي نقيس بها خط المعالجة: زمن المعالجة، نسبة الفشل، والتكلفة لكل تشغيل، مع الحدود المقبولة.',
 'قائمة مؤشرات مع طريقة الحساب والحدود المقبولة.',
 'كل مؤشر قابل للحساب من الـAI Trace.',
 '{M01-IS-02-01}'),
('M01-AH-02-02', 'AH', 4, 'p2', '2026-11-02', 1,
 'توثيق متطلبات Mobile MVP وقرار التنفيذ/التأجيل',
 'توثيق متطلبات تطبيق الهاتف للـMVP بناءً على مراجعة التجربة، ورفع توصية: تنفيذ الآن أو الاكتفاء بالويب المتجاوب وتأجيل التطبيق.',
 'وثيقة متطلبات Mobile MVP + توصية القرار.',
 'المتطلبات واضحة والتوصية مبررة ومعروضة على غسان للقرار.',
 '{M01-AH-02-01}'),
('M01-AB-02-02', 'AB', 4, 'p1', '2026-11-03', 1,
 'اختبار جودة Parsing وتحديد حالات الفشل',
 'قياس دقة الاستخراج على العينات وتصنيف حالات الفشل وأسبابها.',
 'تقرير جودة الـParsing مع تصنيف حالات الفشل.',
 'نسبة الدقة محسوبة، وكل نوع فشل له أمثلة وسبب.',
 '{M01-AB-02-01}'),
('M01-BA-02-02', 'BA', 4, 'p1', '2026-11-03', 1,
 'إعداد حالات Positive وNegative وMissing وContradicting',
 'إضافة حالات اختبار تغطي النتائج الإيجابية والسلبية والأدلة الناقصة والمتناقضة إلى الـGolden Dataset.',
 'حالات اختبار مصنفة ضمن الـGolden Dataset.',
 'كل نوع من الأنواع الأربعة ممثل بحالات كافية ومراجعة.',
 '{M01-BA-02-01}'),
('M01-IS-02-03', 'IS', 4, 'p1', '2026-11-03', 2,
 'إعداد أساس مراقبة حالات AI Jobs والأخطاء',
 'إعداد مراقبة أولية لحالات مهام المعالجة والأخطاء بناءً على الـTrace والمؤشرات (لوحة أو تنبيهات بسيطة).',
 'لوحة مراقبة أو تقرير دوري لحالات AI Jobs والأخطاء.',
 'يمكن رؤية المهام العالقة والفاشلة والمؤشرات الأساسية.',
 '{M01-IS-02-01,M01-IS-02-02}'),
('M01-JA-02-02', 'JA', 4, 'p1', '2026-11-03', 2,
 'تسليم Design Tokens والمكونات الأساسية',
 'تجهيز Design Tokens (الألوان، الخطوط، المسافات) والمكونات الأساسية بحالاتها لتسليمها للـFrontend.',
 'ملف Design Tokens + مكتبة مكونات أساسية في Figma.',
 'المكونات تغطي حالات الـUI State Matrix، والتسليم مراجع مع عمار.',
 '{M01-JA-02-01}'),
('M01-AM-02-02', 'AM', 4, 'p1', '2026-11-03', 1,
 'كتابة E2E Scenarios للمسار الطبيعي',
 'كتابة سيناريوهات اختبار طرفية (End-to-End) للمسار الأساسي في الحالة الطبيعية.',
 'سيناريوهات E2E مكتوبة وقابلة للتشغيل على الواجهة.',
 'المسار الأساسي مغطى من البداية للنهاية والسيناريوهات تنجح.',
 '{M01-AM-02-01}'),
('M01-BR-02-02', 'BR', 4, 'p0', '2026-11-03', 1,
 'تطبيق Validation وصلاحيات الوصول الأساسية',
 'تطبيق التحقق وصلاحيات الوصول على الـAPIs الأولى بحيث لا يصل مستخدم إلا لبيانات مؤسسته.',
 'صلاحيات وصول مطبقة مع اختبارات رفض الوصول.',
 'اختبارات تثبت رفض الوصول لبيانات مؤسسة أخرى.',
 '{M01-BR-02-01}'),
('M01-AB-02-03', 'AB', 4, 'p0', '2026-11-04', 1,
 'تحديد قواعد الانتقال من Text Extraction إلى Evidence Extraction',
 'تحديد القواعد التي تحول النص المستخرج إلى أدلة مرتبطة بالأبعاد وفق الـEvidence Schema.',
 'قواعد الانتقال موثقة مع أمثلة من العينات.',
 'كل قاعدة تنتج Evidence صالح حسب الـSchema على الأمثلة.',
 '{M01-AB-02-02}'),
('M01-AS-02-03', 'AS', 4, 'p1', '2026-11-04', 1,
 'إعداد قواعد أولية لاكتشاف Evidence غير القابلة للتحقق',
 'كتابة قواعد أولية تكتشف الأدلة غير القابلة للتحقق وتحولها للحالة المناسبة حسب السياسة.',
 'قواعد اكتشاف أولية مع أمثلة إيجابية وسلبية.',
 'القواعد تطبق السياسة وتنجح على أمثلة الاختبار.',
 '{M01-AS-02-02}'),
('M01-BA-02-03', 'BA', 4, 'p1', '2026-11-04', 1,
 'كتابة Test Specification v0.1 للـAI Outputs',
 'كتابة مواصفة اختبار مخرجات الـAI: ما الذي نقيسه، على أي بيانات، وما معايير القبول.',
 'وثيقة Test Specification v0.1.',
 'المواصفة تستخدم الـGolden Dataset ولها معايير قبول قابلة للقياس.',
 '{M01-BA-02-02}'),
('M01-AM-02-03', 'AM', 4, 'p1', '2026-11-04', 1,
 'كتابة E2E Scenarios للفشل والمراجعة',
 'كتابة سيناريوهات E2E لحالات الفشل والمراجعة البشرية وNot Scorable وفق الـUI State Matrix.',
 'سيناريوهات E2E للفشل والمراجعة قابلة للتشغيل.',
 'كل حالة فشل ومراجعة في الـState Matrix مغطاة بسيناريو.',
 '{M01-AM-02-02,M01-JA-02-01}'),
('M01-BR-02-03', 'BR', 4, 'p1', '2026-11-04', 1,
 'تحديد سياسات الحذف والاحتفاظ بالبيانات',
 'تحديد مدة الاحتفاظ بكل نوع بيانات وطريقة الحذف (خاصة البيانات الشخصية) وفق مراجعة PII.',
 'سياسة الاحتفاظ والحذف لكل نوع بيانات.',
 'كل نوع بيانات له مدة وطريقة حذف، ومتوافقة مع مراجعة PII.',
 '{M01-IS-01-04,M01-BR-01-04}'),
('M01-AB-02-04', 'AB', 4, 'p1', '2026-11-05', 1,
 'توثيق حدود Parsing وقرار التقنية المعتمدة',
 'توثيق حدود الـParsing الحالية واتخاذ قرار التقنية/الأداة المعتمدة للمرحلة القادمة بناءً على النتائج.',
 'مذكرة قرار تقني + قائمة الحدود المعروفة.',
 'القرار مبني على نتائج الجودة ومعتمد من غسان.',
 '{M01-AB-02-02,M01-AB-02-03}');

do $$
declare
  v_director uuid := (select p.id from public.profiles p where p.is_director order by p.created_at limit 1);
  v_team uuid := (select t.id from public.teams t where lower(btrim(t.name)) = 'nesthire team');
  v_project uuid;
  v_missing text;
  v_row record;
begin
  if v_director is null then
    raise exception 'No Director found.';
  end if;
  if v_team is null then
    raise exception 'Run scripts/sql/nesthire-team.sql first (NestHire Team not found).';
  end if;

  select string_agg(distinct p.member, ', ') into v_missing
  from m01_plan p
  where not exists (select 1 from public.team_members tm where tm.team_id = v_team and tm.member_code = p.member);
  if v_missing is not null then
    raise exception 'Roster codes missing in NestHire Team: %', v_missing;
  end if;

  -- Act as the Director for the rest of the transaction (authorship + audit).
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_director, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true
  );

  select p.id into v_project from public.projects p where p.name = 'NestHire' order by p.created_at limit 1;
  if v_project is null then
    v_project := public.create_project(
      'NestHire',
      'منصة NestHire للتوظيف المبني على الأدلة: خطة العمل الشهرية للفريق.',
      'إطلاق MVP يقيّم المرشحين على الأبعاد التسعة بأدلة قابلة للتفسير، والتحقق منه مع عملاء حقيقيين.',
      'active',
      date '2026-10-11',
      null
    );
  end if;
  if (select p.team_id from public.projects p where p.id = v_project) is distinct from v_team then
    perform public.set_project_team(v_project, v_team);
  end if;

  for v_row in select * from m01_plan order by start_on, code loop
    insert into public.tasks (
      project_id, task_code, title, description, expected_output, completion_criteria, priority,
      responsible_member_id, planning_month, planning_week,
      planned_start_at, planned_duration, duration_unit
    )
    select
      v_project, v_row.code, v_row.title, v_row.description, v_row.expected, v_row.criteria, v_row.priority,
      (select tm.id from public.team_members tm where tm.team_id = v_team and tm.member_code = v_row.member),
      1, v_row.week,
      (v_row.start_on + time '09:00') at time zone 'Asia/Gaza', v_row.days, 'days'
    where not exists (select 1 from public.tasks t where t.task_code = v_row.code);
  end loop;

  insert into public.task_dependencies (task_id, depends_on_task_id, project_id)
  select t.id, d.id, t.project_id
  from m01_plan p
  cross join lateral unnest(p.depends) as dep(code)
  join public.tasks t on t.task_code = p.code
  join public.tasks d on d.task_code = dep.code
  where t.project_id = d.project_id
    and not exists (
      select 1 from public.task_dependencies x where x.task_id = t.id and x.depends_on_task_id = d.id
    );

  -- Guarantees of the plan.
  if (select count(*) from public.tasks t where t.task_code in (select code from m01_plan)) <> 66 then
    raise exception 'Expected 66 month-1 tasks.';
  end if;
  if exists (
    select 1
    from public.task_dependencies x
    join public.tasks t on t.id = x.task_id
    join public.tasks d on d.id = x.depends_on_task_id
    where t.task_code in (select code from m01_plan)
      and t.planned_start_at < d.due_at
  ) then
    raise exception 'A task starts before one of its predecessors is due.';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Result (expected: 5 · 1 · 9 · 66 · 90)
-- ---------------------------------------------------------------------------
select
  (select count(*) from supabase_migrations.schema_migrations where version like '20261007%') as nesthire_migrations,
  (select count(*) from public.profiles where is_director) as directors,
  (select count(*) from public.team_members tm join public.teams t on t.id = tm.team_id
    where lower(btrim(t.name)) = 'nesthire team') as roster,
  (select count(*) from public.tasks where task_code like 'M01-%') as month1_tasks,
  (select count(*) from public.task_dependencies) as dependencies;
