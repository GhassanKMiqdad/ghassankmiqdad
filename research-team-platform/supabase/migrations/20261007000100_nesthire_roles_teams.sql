-- =============================================================================
-- NestHire upgrade 1/5 — explicit role model and teams
--
-- Organization → Director → Teams (Team Lead + Team Members) → Projects → Tasks
--
--   * DIRECTOR (profiles.is_director): organization-wide authority. Holds every
--     permission in every project (the permission helpers below treat a
--     Director like a project owner), manages teams, rosters and roles.
--   * TEAM LEAD (team_members.role = 'team_lead'): operational authority over
--     the projects linked to their team only. Gets a fixed permission set in
--     those projects (create / assign / schedule / review / approve / publish
--     tasks) WITHOUT member, role or permission management.
--   * TEAM MEMBER (team_members.role = 'team_member'): executes their own tasks.
--
-- Teams are rosters: a roster entry carries the person's display name, member
-- code (used in task IDs such as M01-GH-01-01) and job title, and is linked to
-- a user account once that person has one. Linking an account (or linking a
-- project to a team) synchronizes project memberships, so the roster drives
-- who works on the team's projects.
--
-- Every role transition is performed by a SECURITY DEFINER function that
-- checks that the caller is a Director (or runs as a trusted server process)
-- and is written to the audit log. Clients have no write grant on any of
-- these tables or columns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Director flag
-- -----------------------------------------------------------------------------
alter table public.profiles add column is_director boolean not null default false;
comment on column public.profiles.is_director is
  'Organization Director: every permission in every project, manages teams and roles. Changed only by set_user_director() or trusted server code.';

-- -----------------------------------------------------------------------------
-- Teams and rosters
-- -----------------------------------------------------------------------------
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

-- Invitation e-mails are kept apart so that only Directors can read them.
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

-- Team-level audit entries.
alter table public.activity_logs drop constraint activity_logs_entity_type_check;
alter table public.activity_logs add constraint activity_logs_entity_type_check
  check (entity_type in ('project', 'task', 'document', 'comment', 'member', 'permissions', 'platform_user', 'team'));

-- -----------------------------------------------------------------------------
-- Role helpers
-- -----------------------------------------------------------------------------
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

-- Teams in which the current user is an active roster member (any role).
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

-- Member code of a user inside a team (used to build task IDs).
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

-- Fixed permission set of a Team Lead inside the projects of their team:
-- operational task authority, no member / role / permission management.
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

-- -----------------------------------------------------------------------------
-- Directors in the permission helpers: a Director holds every permission in
-- every project, exactly like the project owner.
-- -----------------------------------------------------------------------------
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

-- The acting role of a Director is "owner" in every project, so the rank
-- rules of the membership RPCs treat them as the highest authority and
-- nobody below can modify a Director's membership.
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

-- Effective access of the caller in every project they belong to, plus every
-- project for a Director.
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

-- -----------------------------------------------------------------------------
-- Roster → project membership synchronization
-- -----------------------------------------------------------------------------

-- Ensures that a linked, active roster entry is an active member of every
-- project of its team, with the role and permissions that match its team
-- role. Owners are never touched. A changed team role resets the project
-- role and permissions (audited like a role change).
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
end;
$$;

-- Links pending roster entries whose invitation e-mail matches a confirmed
-- account (called when a user confirms their e-mail).
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

-- Named so that it fires after on_auth_user_created (the profile exists).
create trigger on_auth_user_team_link
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.handle_auth_user_team_link();

grant execute on function private.handle_auth_user_team_link() to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Director RPCs
-- -----------------------------------------------------------------------------
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

-- Creates (p_member_id null) or updates a roster entry. The invitation e-mail
-- is optional; a confirmed account with that e-mail is linked automatically.
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

-- Links a roster entry to an existing account (by e-mail) and activates it.
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

-- Links a project to a team (or unlinks it with null). Members of the team
-- become project members; the project's tasks follow the team.
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

-- Roster with invitation e-mails (Directors only).
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

-- Trusted bootstrap (service role / SQL editor): the first platform admin is
-- also the organization's first Director.
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

-- Existing system owners become the organization's Directors.
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
