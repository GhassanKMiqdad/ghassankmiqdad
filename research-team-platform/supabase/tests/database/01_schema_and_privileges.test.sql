-- Schema, privileges and reference data.
begin;
\ir _helpers.psql
select plan(27);

select tables_are(
  'public',
  array[
    'profiles', 'projects', 'project_members', 'permissions', 'role_permissions',
    'user_permissions', 'tasks', 'documents', 'comments', 'activity_logs'
  ],
  'public schema contains exactly the application tables'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'Row Level Security is enabled on every public table'
);

select is(
  (select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  0,
  'the anon role has no privilege on any public table'
);

-- Writes that must only happen through audited RPCs.
select ok(not has_table_privilege('authenticated', 'public.projects', 'INSERT'), 'projects can only be created through create_project()');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'INSERT'), 'project_members is not directly insertable');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'UPDATE'), 'project_members is not directly updatable');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'DELETE'), 'project_members is not directly deletable');
select ok(not has_table_privilege('authenticated', 'public.user_permissions', 'INSERT'), 'user_permissions is not directly insertable');
select ok(not has_table_privilege('authenticated', 'public.user_permissions', 'DELETE'), 'user_permissions is not directly deletable');
select ok(not has_table_privilege('authenticated', 'public.activity_logs', 'INSERT'), 'activity_logs is not writable by clients');
select ok(not has_table_privilege('authenticated', 'public.activity_logs', 'UPDATE'), 'activity_logs cannot be modified by clients');
select ok(not has_table_privilege('authenticated', 'public.activity_logs', 'DELETE'), 'activity_logs cannot be deleted by clients');
select ok(not has_table_privilege('authenticated', 'public.permissions', 'INSERT'), 'the permission catalog is read-only');

-- Column-level protection.
select ok(not has_column_privilege('authenticated', 'public.profiles', 'is_platform_admin', 'UPDATE'), 'users cannot grant themselves platform admin');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'can_create_projects', 'UPDATE'), 'users cannot grant themselves project creation');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'project_id', 'UPDATE'), 'a task cannot be moved to another project');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'created_by', 'UPDATE'), 'the task creator cannot be rewritten');
select ok(not has_column_privilege('authenticated', 'public.documents', 'storage_path', 'UPDATE'), 'a document cannot be re-pointed to another file');
select ok(not has_column_privilege('authenticated', 'public.comments', 'author_id', 'UPDATE'), 'the comment author cannot be rewritten');

-- Function privileges.
select ok(
  not has_function_privilege('anon', 'public.create_project(text, text, text, public.project_status, date, date)', 'EXECUTE'),
  'anon cannot execute create_project()'
);
select ok(
  not has_function_privilege('anon', 'public.set_member_permissions(uuid, uuid, text[])', 'EXECUTE'),
  'anon cannot execute set_member_permissions()'
);
select ok(
  not has_function_privilege('authenticated', 'public.bootstrap_platform_admin(uuid)', 'EXECUTE'),
  'end users cannot execute bootstrap_platform_admin()'
);
select ok(
  not has_function_privilege('anon', 'private.has_permission(uuid, text)', 'EXECUTE'),
  'anon cannot execute the private permission helpers'
);

-- Reference data.
select is((select count(*)::int from public.permissions), 24, 'the catalog defines 24 permissions');
select is(
  (select count(*)::int from public.role_permissions where role = 'owner'),
  (select count(*)::int from public.permissions),
  'the owner template covers every permission'
);
select ok(
  not exists (
    select 1 from public.role_permissions
    where role = 'manager' and permission_key in ('project.delete', 'permissions.manage', 'activity.view')
  ),
  'managers do not get project.delete, permissions.manage or activity.view by default'
);
select is(
  (select public from storage.buckets where id = 'project-documents'),
  false,
  'the document bucket is private'
);

select * from finish();
rollback;
