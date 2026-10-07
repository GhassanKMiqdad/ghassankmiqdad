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
begin;

do $$
declare
  v_director uuid := (select p.id from public.profiles p where p.is_director order by p.created_at limit 1);
  v_team uuid;
  v_entry record;
begin
  if v_director is null then
    raise exception 'No Director found. Run select public.bootstrap_platform_admin(''<user id>''); first.';
  end if;

  insert into public.teams (name, description, created_by)
  values ('NestHire Team', 'NestHire product team', v_director)
  on conflict ((lower(btrim(name)))) do nothing;
  select t.id into v_team from public.teams t where lower(btrim(t.name)) = 'nesthire team';

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

  perform private.log_activity(
    null, 'team.created', 'team', v_team, 'NestHire Team', null,
    jsonb_build_object('name', 'NestHire Team', 'roster', 9), jsonb_build_object('reason', 'bootstrap')
  );
end;
$$;

commit;
