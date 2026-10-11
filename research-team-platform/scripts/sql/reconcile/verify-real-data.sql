-- Read-only fidelity check for the Month-1 data import (no data in this file).
-- Run on both projects with the session time zone set to UTC; every row must match
-- docs/DATABASE_READINESS.md section 10 (tasks_content 2a694585…, tasks_rows 9b0ad4a8…,
-- deps a4893d3f…, roster 3fcde86c…, team_project 478f2188…, logs 4bbb37c5…,
-- profile 60ad735c…, identity f2dd120e…).
set timezone = 'UTC';
select 'tasks_content' k, md5(string_agg(x, E'\n' order by x)) h, count(*) n from (
 select t.task_code||'|'||t.title||'|'||t.description||'|'||t.expected_output||'|'||t.completion_criteria||'|'||t.original_instructions||'|'||t.priority||'|'||tm.member_code||'|'||t.planning_month||'|'||coalesce(t.planning_week::text,'')||'|'||coalesce(t.planned_start_at::text,'')||'|'||coalesce(t.planned_duration::text,'')||'|'||coalesce(t.duration_unit::text,'')||'|'||coalesce(t.planned_duration_minutes::text,'')||'|'||coalesce(t.due_at::text,'')||'|'||t.status||'|'||t.visibility||'|'||t.progress as x
 from public.tasks t join public.team_members tm on tm.id=t.responsible_member_id) s
union all select 'tasks_rows', md5(string_agg(x, E'\n' order by x)), count(*) from (
 select concat_ws('|', id, project_id, team_id, responsible_member_id, assigned_to, created_by, created_at, updated_at, completed_at, actual_start_at, submitted_at, approved_at, published_at, due_at_overridden, work_notes, task_code) x from public.tasks) s
union all select 'deps', md5(string_agg(x, E'\n' order by x)), count(*) from (
 select concat_ws('|', task_id, depends_on_task_id, project_id, created_by, created_at) x from public.task_dependencies) s
union all select 'roster', md5(string_agg(x, E'\n' order by x)), count(*) from (
 select concat_ws('|', id, team_id, user_id, display_name, member_code, job_title, role, status, added_by, created_at, updated_at) x from public.team_members) s
union all select 'team_project', md5(string_agg(x, E'\n' order by x)), count(*) from (
 select concat_ws('|', 'team', id, name, description, created_by, created_at, updated_at) x from public.teams
 union all select concat_ws('|', 'project', id, name, description, research_goal, status, start_date, deadline, created_by, created_at, updated_at, team_id) from public.projects
 union all select concat_ws('|', 'pm', id, project_id, user_id, role, status, added_by, created_at, updated_at) from public.project_members) s
union all select 'logs', md5(string_agg(id::text||'|'||coalesce(project_id::text,'')||'|'||coalesce(actor_id::text,'')||'|'||coalesce(actor_name,'')||'|'||coalesce(actor_email,'')||'|'||action||'|'||entity_type||'|'||coalesce(entity_id::text,'')||'|'||coalesce(entity_label,'')||'|'||coalesce(old_values::text,'')||'|'||coalesce(new_values::text,'')||'|'||coalesce(metadata::text,'')||'|'||created_at::text, E'\n' order by created_at, id)), count(*) from public.activity_logs
union all select 'profile', md5(concat_ws('|', id, email, full_name, is_platform_admin, can_create_projects, is_director, created_at)), count(*) over () from public.profiles
union all select 'identity', md5(concat_ws('|', u.id, u.email, u.email_confirmed_at, u.created_at, i.provider, i.provider_id, i.identity_data::text)), 1 from auth.users u join auth.identities i on i.user_id = u.id
order by 1;
