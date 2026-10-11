-- Restrict Supabase's platform event-trigger helper.
-- The event trigger invokes this function as its owner; end users never need
-- EXECUTE on it through the Data API/RPC surface.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
