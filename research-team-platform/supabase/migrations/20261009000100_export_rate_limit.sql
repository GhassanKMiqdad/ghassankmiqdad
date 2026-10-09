-- Distributed export rate limiting. State lives in PostgreSQL so it works across
-- Vercel instances and does not require a new external secret or service.
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
