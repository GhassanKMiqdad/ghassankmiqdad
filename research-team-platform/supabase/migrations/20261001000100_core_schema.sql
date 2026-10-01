-- =============================================================================
-- Core relational schema
--
-- Tenancy model
--   Every business row (task, document, comment, membership, permission grant)
--   belongs to exactly one research project through `project_id`. Access is
--   always evaluated against the caller's membership in that project, which
--   keeps projects fully isolated from each other. A future "organizations"
--   layer only needs `projects.organization_id`; child tables and their
--   policies stay unchanged.
--
-- Conventions
--   * UUID primary keys (gen_random_uuid()).
--   * `created_at` / `updated_at` timestamps maintained by triggers.
--   * Text length limits enforced with CHECK constraints (defence in depth,
--     the application validates the same limits with Zod).
-- =============================================================================

create schema if not exists private;
comment on schema private is
  'Internal helper functions used by RLS policies and triggers. Not exposed through the Data API.';
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type public.project_role as enum ('owner', 'manager', 'member', 'reviewer');
create type public.member_status as enum ('active', 'suspended');
create type public.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'archived');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'completed', 'rejected');
create type public.task_priority as enum ('low', 'medium', 'high', 'critical');

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user (created by a trigger on auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  avatar_url text,
  is_platform_admin boolean not null default false,
  can_create_projects boolean not null default false,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048)
);
comment on table public.profiles is 'Public profile of every user. Platform flags are writable only through admin RPCs.';
comment on column public.profiles.is_platform_admin is 'System owner: may create projects and manage platform-level user flags.';
comment on column public.profiles.can_create_projects is 'Allows creating new research projects without being a platform admin.';

create unique index profiles_email_lower_key on public.profiles (lower(email)) where email is not null;

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  research_goal text not null default '',
  status public.project_status not null default 'planning',
  start_date date,
  deadline date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_length check (char_length(btrim(name)) between 2 and 160),
  constraint projects_description_length check (char_length(description) <= 5000),
  constraint projects_research_goal_length check (char_length(research_goal) <= 5000),
  constraint projects_dates_order check (start_date is null or deadline is null or deadline >= start_date)
);
comment on table public.projects is 'Research projects. Each project is an isolated workspace with its own members and permissions.';

create index projects_created_by_idx on public.projects (created_by);

-- -----------------------------------------------------------------------------
-- project_members: membership + role label + status
-- -----------------------------------------------------------------------------
create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'member',
  status public.member_status not null default 'active',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_members_project_user_key unique (project_id, user_id)
);
comment on table public.project_members is
  'Project membership. The role is a label/template; effective rights come from user_permissions (owners implicitly hold all).';

-- Exactly one owner per project.
create unique index project_members_single_owner_idx on public.project_members (project_id) where role = 'owner';
create index project_members_user_idx on public.project_members (user_id, project_id);

-- -----------------------------------------------------------------------------
-- permissions: catalog of fine-grained permission keys
-- -----------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  category text not null,
  sort_order integer not null,
  description text not null default '',
  constraint permissions_key_format check (key ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$')
);
comment on table public.permissions is 'Catalog of permission keys. Natural text keys are used because application code references them.';

-- -----------------------------------------------------------------------------
-- role_permissions: default permission template per role
-- -----------------------------------------------------------------------------
create table public.role_permissions (
  role public.project_role not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role, permission_key)
);
comment on table public.role_permissions is
  'Default permissions applied when a member is added or their role changes. Members can then be customised individually.';

-- -----------------------------------------------------------------------------
-- user_permissions: per-member, per-project permission grants
-- -----------------------------------------------------------------------------
create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_permissions_unique unique (project_id, user_id, permission_key),
  constraint user_permissions_member_fkey foreign key (project_id, user_id)
    references public.project_members (project_id, user_id) on delete cascade
);
comment on table public.user_permissions is
  'Granted permissions of a member inside one project (presence = granted). Written only through set_member_permissions().';

create index user_permissions_user_idx on public.user_permissions (user_id, project_id);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_length check (char_length(btrim(title)) between 2 and 200),
  constraint tasks_description_length check (char_length(description) <= 10000),
  constraint tasks_id_project_key unique (id, project_id),
  -- The assignee must be a member of the same project. Removing the member
  -- un-assigns the task (only the assigned_to column is nulled).
  constraint tasks_assignee_member_fkey foreign key (project_id, assigned_to)
    references public.project_members (project_id, user_id) on delete set null (assigned_to)
);
comment on table public.tasks is 'Research tasks. Field-level rules (assignment, review workflow) are enforced by triggers.';

create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_assigned_to_idx on public.tasks (assigned_to, status) where assigned_to is not null;
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_project_due_date_idx on public.tasks (project_id, due_date) where due_date is not null;

-- -----------------------------------------------------------------------------
-- documents (metadata; binary content lives in Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  description text not null default '',
  file_name text not null,
  storage_path text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_storage_path_key unique (storage_path),
  constraint documents_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint documents_description_length check (char_length(description) <= 2000),
  constraint documents_file_name_length check (char_length(file_name) between 1 and 255),
  constraint documents_size_non_negative check (size_bytes >= 0),
  -- Objects must live under "<project_id>/<document_id>/" so storage policies
  -- (which read the first folder) and table policies always agree.
  constraint documents_storage_path_scope check (storage_path like (project_id::text || '/' || id::text || '/%'))
);
comment on table public.documents is 'Document metadata. Files are stored in the private "project-documents" bucket.';

create index documents_project_created_idx on public.documents (project_id, created_at desc);
create index documents_uploaded_by_idx on public.documents (uploaded_by);

-- -----------------------------------------------------------------------------
-- comments (on a project when task_id is null, otherwise on a task)
-- -----------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_content_length check (char_length(btrim(content)) between 1 and 5000),
  -- A task comment must reference a task of the same project.
  constraint comments_task_fkey foreign key (task_id, project_id)
    references public.tasks (id, project_id) on delete cascade
);
comment on table public.comments is 'Discussion on projects (task_id null) and tasks.';

create index comments_project_created_idx on public.comments (project_id, created_at) where task_id is null;
create index comments_task_created_idx on public.comments (task_id, created_at) where task_id is not null;
create index comments_author_idx on public.comments (author_id);

-- -----------------------------------------------------------------------------
-- activity_logs: append-only audit trail
--   No foreign keys on purpose: audit entries must outlive the rows they
--   describe (deleted tasks, removed members, deleted projects). Actor name
--   and e-mail are snapshotted at write time.
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  -- clock_timestamp(): several entries written in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp(),
  constraint activity_logs_action_format check (action ~ '^[a-z_]+\.[a-z_]+$'),
  constraint activity_logs_entity_type_check
    check (entity_type in ('project', 'task', 'document', 'comment', 'member', 'permissions', 'platform_user'))
);
comment on table public.activity_logs is 'Immutable audit trail. Rows are written only by SECURITY DEFINER functions/triggers.';

create index activity_logs_project_created_idx on public.activity_logs (project_id, created_at desc);
create index activity_logs_actor_created_idx on public.activity_logs (actor_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id, created_at desc);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
