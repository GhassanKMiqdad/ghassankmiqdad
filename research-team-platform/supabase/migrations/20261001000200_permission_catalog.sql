-- =============================================================================
-- Permission catalog and default role templates (reference data).
--
-- The keys below are the single source of truth for the database. The
-- application mirrors them in src/lib/permissions/catalog.ts and a unit test
-- verifies both lists stay identical.
--
-- Semantics worth knowing:
--   * project.view is the access gate of a project: without it a member has no
--     effective permission inside the project (see private.member_has_permission).
--   * Owners implicitly hold every permission; their grants are not stored.
--   * tasks.edit            -> edit any task.
--   * tasks.edit_own        -> edit only tasks the member created.
--   * tasks.edit_assigned   -> edit only tasks assigned to the member.
--   * tasks.assign          -> set or change the assignee of a task.
--   * tasks.review          -> approve / reject tasks that are in review.
-- =============================================================================

insert into public.permissions (key, category, sort_order, description) values
  ('project.view',        'project',        10,  'View the project and access its workspace'),
  ('project.edit',        'project',        20,  'Edit project details'),
  ('project.delete',      'project',        30,  'Delete the project'),
  ('tasks.view',          'tasks',          110, 'View all tasks of the project'),
  ('tasks.create',        'tasks',          120, 'Create tasks'),
  ('tasks.edit',          'tasks',          130, 'Edit any task'),
  ('tasks.edit_own',      'tasks',          140, 'Edit tasks created by the member'),
  ('tasks.edit_assigned', 'tasks',          150, 'Edit tasks assigned to the member'),
  ('tasks.assign',        'tasks',          160, 'Assign tasks to members'),
  ('tasks.review',        'tasks',          170, 'Review, approve or reject tasks'),
  ('tasks.delete',        'tasks',          180, 'Delete tasks'),
  ('documents.view',      'documents',      210, 'View and download documents'),
  ('documents.upload',    'documents',      220, 'Upload documents'),
  ('documents.edit',      'documents',      230, 'Edit document details'),
  ('documents.delete',    'documents',      240, 'Delete documents'),
  ('comments.create',     'comments',       310, 'Add comments'),
  ('comments.delete',     'comments',       320, 'Delete comments written by others'),
  ('team.view',           'team',           410, 'View the project team'),
  ('members.add',         'team',           420, 'Add members'),
  ('members.remove',      'team',           430, 'Remove members'),
  ('members.manage',      'team',           440, 'Change member roles and status'),
  ('permissions.manage',  'team',           450, 'Manage member permissions'),
  ('activity.view',       'administration', 510, 'View the full activity log'),
  ('data.export',         'administration', 520, 'Export project data')
on conflict (key) do update
  set category = excluded.category,
      sort_order = excluded.sort_order,
      description = excluded.description;

-- Owner: every permission (documentation only — owners are never checked
-- against stored grants).
insert into public.role_permissions (role, permission_key)
select 'owner'::public.project_role, p.key from public.permissions p
on conflict do nothing;

-- Manager: runs the project day-to-day. Deleting the project, managing
-- permissions and reading the full audit log stay with the owner unless the
-- owner explicitly grants them.
insert into public.role_permissions (role, permission_key)
select 'manager'::public.project_role, k
from unnest(array[
  'project.view', 'project.edit',
  'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.edit_own', 'tasks.edit_assigned',
  'tasks.assign', 'tasks.review', 'tasks.delete',
  'documents.view', 'documents.upload', 'documents.edit', 'documents.delete',
  'comments.create', 'comments.delete',
  'team.view', 'members.add', 'members.remove', 'members.manage',
  'data.export'
]) as k
on conflict do nothing;

-- Research member: works on own / assigned tasks and contributes documents.
insert into public.role_permissions (role, permission_key)
select 'member'::public.project_role, k
from unnest(array[
  'project.view',
  'tasks.view', 'tasks.create', 'tasks.edit_own', 'tasks.edit_assigned',
  'documents.view', 'documents.upload',
  'comments.create',
  'team.view'
]) as k
on conflict do nothing;

-- Reviewer: reads everything relevant and approves / rejects work.
insert into public.role_permissions (role, permission_key)
select 'reviewer'::public.project_role, k
from unnest(array[
  'project.view',
  'tasks.view', 'tasks.review',
  'documents.view',
  'comments.create',
  'team.view'
]) as k
on conflict do nothing;
