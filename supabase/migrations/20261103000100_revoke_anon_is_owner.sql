-- Security advisor: is_owner() is SECURITY DEFINER; anon has no reason to call it.
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;
