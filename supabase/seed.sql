-- Fill in real values before running (PRD open questions: sales team names,
-- whether "أندرو مينا" is one or two people, which Evolution instances exist).

insert into public.wa_instances (purpose, phone_number, evolution_instance) values
  ('support', '+20-SUPPORT-XXXX', 'support'),
  ('sales',   '+20-SALES-XXXX', 'sales'),
  ('courses', '+20-COURSES-XXXX', 'courses')
on conflict (purpose) do nothing;

insert into public.team_members (name, department) values
  ('أندرو مينا', 'media'),
  ('أنجي',       'media'),
  ('مادونا',     'media')
on conflict (name) do nothing;

-- After Ibrahim signs in to the dashboard once:
-- insert into public.app_owners (user_id)
--   select id from auth.users where email = '<ibrahim email>';
