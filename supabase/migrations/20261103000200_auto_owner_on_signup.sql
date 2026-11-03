-- The owner's account becomes an app owner as soon as it is created in Supabase Auth.
create or replace function public.grant_owner_on_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'ebrahimkhlil01@gmail.com' then
    insert into public.app_owners (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.grant_owner_on_signup() from public, anon, authenticated;
create trigger grant_owner_on_signup after insert on auth.users
  for each row execute function public.grant_owner_on_signup();
