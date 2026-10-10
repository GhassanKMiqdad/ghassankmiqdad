-- NestHire Workspace: narrowly scoped manager self-review exception.
-- A manager may review and publish a task assigned to themselves. Ordinary
-- members/reviewers remain unable to review their own work.
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

-- The final privacy hardening also checks the submitter at review and publish
-- time. Override that guard narrowly so a manager's own currently assigned
-- task follows the same exception at every workflow entry point.
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
