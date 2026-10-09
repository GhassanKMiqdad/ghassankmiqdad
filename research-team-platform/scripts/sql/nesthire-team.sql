-- =============================================================================
-- NestHire demo team roster — fictional development data only.
--
-- This public sample intentionally contains no real people, e-mail addresses,
-- live assignments, or production schedule. Use a separate private bootstrap
-- process for any real Production roster.
-- Run after the 20261007* migrations. Safe to run twice.
-- =============================================================================
begin;
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
  values ('NestHire Demo Team', 'Fictional demo team for local development only', v_director)
  on conflict ((lower(btrim(name)))) do nothing
  returning id into v_team;
  v_created := v_team is not null;
  if not v_created then
    select t.id into v_team from public.teams t where lower(btrim(t.name)) = 'nesthire demo team';
  end if;

  for v_entry in
    select * from (values
      ('DL', 'Demo Lead', 'Demo team lead', 'team_lead'),
      ('UX', 'Demo Designer', 'Demo design', 'team_member'),
      ('EN', 'Demo Engineer', 'Demo engineering', 'team_member'),
      ('QA', 'Demo Reviewer', 'Demo quality review', 'team_member')
    ) as r (code, name, title, role)
  loop
    insert into public.team_members (team_id, display_name, member_code, job_title, role, status, added_by, user_id)
    values (
      v_team, v_entry.name, v_entry.code, v_entry.title, v_entry.role::public.team_role,
      case when v_entry.code = 'DL' then 'active' else 'pending' end::public.team_member_status,
      v_director,
      case when v_entry.code = 'DL' then v_director end
    )
    on conflict (team_id, member_code) do nothing;
  end loop;

  if v_created then
    perform private.log_activity(
      null, 'team.created', 'team', v_team, 'NestHire Demo Team', null,
      jsonb_build_object('name', 'NestHire Demo Team', 'roster', 4),
      jsonb_build_object('reason', 'fictional_demo_bootstrap')
    );
  end if;
end;
$$;
commit;
