-- =============================================================================
-- Profiles lifecycle (driven by Supabase Auth)
-- =============================================================================

-- Create the profile row when Supabase Auth creates a user (sign-up or invite).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, last_sign_in_at)
  values (
    new.id,
    new.email,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        ''
      ),
      120
    ),
    new.last_sign_in_at
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep e-mail and last sign-in time in sync (used by the Team page).
create or replace function private.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email = new.email,
         last_sign_in_at = new.last_sign_in_at
   where p.id = new.id
     and (p.email is distinct from new.email or p.last_sign_in_at is distinct from new.last_sign_in_at);
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, last_sign_in_at on auth.users
  for each row execute function private.handle_auth_user_updated();

-- Supabase Auth runs as supabase_auth_admin; make the trigger functions
-- explicitly reachable for it.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;
grant execute on function private.handle_auth_user_updated() to supabase_auth_admin;

-- A user who still owns projects cannot be deleted; otherwise those projects
-- would be left without anybody able to manage them.
create or replace function private.prevent_owner_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.project_members pm
    where pm.user_id = old.id and pm.role = 'owner'
  ) then
    raise exception using
      errcode = '23503',
      message = 'OWNER_HAS_PROJECTS',
      detail = 'Transfer ownership of (or delete) the projects owned by this user before deleting the account.';
  end if;
  return old;
end;
$$;

create trigger profiles_prevent_owner_delete
  before delete on public.profiles
  for each row execute function private.prevent_owner_profile_delete();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();
