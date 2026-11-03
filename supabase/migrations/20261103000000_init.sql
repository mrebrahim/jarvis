-- =====================================================================
-- JARVIS — initial schema (MVP)
-- Every fact JARVIS says must be backed by a row in one of these tables.
--   * n8n / OpenClaw write with the service role (bypasses RLS).
--   * The dashboard reads as the signed-in owner (RLS: is_owner()).
--   * All "day" boundaries are Africa/Cairo.
-- =====================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.cairo_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Africa/Cairo')::date
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Owners (only Ibrahim in the MVP). A user id is added manually after the
-- first magic-link sign-in:  insert into app_owners(user_id) values ('<uuid>');
create table public.app_owners (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_owners where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- Reference data (manual)
-- ---------------------------------------------------------------------

create table public.team_members (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  department       text not null check (department in ('media', 'sales', 'support', 'management')),
  perfex_staff_id  integer unique,
  whatsapp_number  text unique,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.wa_instances (
  id                 uuid primary key default gen_random_uuid(),
  purpose            text not null unique check (purpose in ('support', 'sales', 'courses')),
  phone_number       text not null unique,
  evolution_instance text not null unique,      -- instance name in Evolution API
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- WhatsApp (Evolution API webhooks -> n8n -> here)
-- ---------------------------------------------------------------------

create table public.wa_messages (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references public.wa_instances(id),
  external_id      text not null,               -- Evolution message key id (dedupe)
  contact_number   text not null,
  contact_name     text,
  direction        text not null check (direction in ('inbound', 'outbound')),
  body             text,
  message_type     text not null default 'text', -- text / audio / image / ...
  team_member_id   uuid references public.team_members(id),  -- who replied (outbound)
  sent_by_agent    boolean not null default false,           -- outbound written by an AI agent
  sent_at          timestamptz not null,
  raw              jsonb,
  created_at       timestamptz not null default now(),
  unique (instance_id, external_id)
);
create index wa_messages_instance_sent_idx on public.wa_messages (instance_id, sent_at desc);
create index wa_messages_contact_idx on public.wa_messages (instance_id, contact_number, sent_at);

-- Daily summary per conversation. Produced by n8n through a *tool-less* Gemini
-- call (quarantine): message text is data, never instructions.
create table public.wa_conversations (
  id               uuid primary key default gen_random_uuid(),
  instance_id      uuid not null references public.wa_instances(id),
  contact_number   text not null,
  contact_name     text,
  day              date not null,
  category         text check (category in ('issue', 'inquiry', 'sale', 'other')),
  status           text not null default 'open' check (status in ('open', 'resolved', 'waiting_customer')),
  sentiment        text check (sentiment in ('positive', 'neutral', 'negative', 'angry')),
  summary          text,
  handled_by       uuid references public.team_members(id),
  message_count    integer not null default 0,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (instance_id, contact_number, day)
);
create index wa_conversations_day_idx on public.wa_conversations (day desc, instance_id);
create trigger wa_conversations_updated before update on public.wa_conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfex snapshots
-- ---------------------------------------------------------------------

create table public.leads_daily (
  id               uuid primary key default gen_random_uuid(),
  snapshot_date    date not null default public.cairo_today(),
  perfex_lead_id   integer not null,
  name             text,
  company          text,
  phone            text,
  source           text,
  status           text,
  assigned_staff_id integer,
  date_added       timestamptz,
  last_contact     timestamptz,
  raw              jsonb,
  synced_at        timestamptz not null default now(),
  unique (perfex_lead_id, snapshot_date)
);
create index leads_daily_added_idx on public.leads_daily (date_added desc);

create table public.team_activity (
  id               uuid primary key default gen_random_uuid(),
  team_member_id   uuid not null references public.team_members(id),
  day              date not null default public.cairo_today(),
  kind             text not null check (kind in ('task_closed', 'hours_logged', 'conversation', 'post_published')),
  quantity         numeric not null default 1,   -- hours for hours_logged, else 1
  source           text not null,                -- perfex / whatsapp / youtube / ...
  external_ref     text,                         -- task id, post url, ...
  title            text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (source, kind, external_ref)
);
create index team_activity_day_idx on public.team_activity (day desc, team_member_id);

create table public.social_metrics (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null check (platform in ('youtube', 'facebook', 'instagram', 'tiktok')),
  day              date not null,
  views            bigint,
  followers        bigint,
  new_followers    bigint,
  engagement       bigint,
  top_post         jsonb,                        -- {title, url, views}
  raw              jsonb,
  created_at       timestamptz not null default now(),
  unique (platform, day)
);

-- ---------------------------------------------------------------------
-- Agent output & governance
-- ---------------------------------------------------------------------

create table public.briefings (
  id               uuid primary key default gen_random_uuid(),
  for_date         date not null unique,
  text             text not null,
  audio_url        text,
  channel          text check (channel in ('telegram', 'whatsapp', 'dashboard')),
  status           text not null default 'draft' check (status in ('draft', 'sent', 'failed')),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now()
);

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  type             text not null,                -- angry_customer / hot_lead / server_down / ...
  severity         text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title            text not null,
  body             text,
  payload          jsonb,
  sent_at          timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index events_created_idx on public.events (created_at desc);

create table public.tool_calls (
  id               uuid primary key default gen_random_uuid(),
  agent            text not null,                -- jarvis-live / openclaw / courses-agent / n8n
  session_id       text,
  tool             text not null,
  input            jsonb,
  output           jsonb,
  status           text not null check (status in ('ok', 'error', 'blocked')),
  error            text,
  duration_ms      integer,
  created_at       timestamptz not null default now()
);
create index tool_calls_created_idx on public.tool_calls (created_at desc);

-- Level 2 (outbound) actions wait here. Level 3 is forbidden in the MVP.
create table public.approvals (
  id               uuid primary key default gen_random_uuid(),
  agent            text not null,
  action           text not null,                -- e.g. whatsapp.send
  level            smallint not null check (level in (1, 2)),
  summary          text not null,                -- human readable, Arabic
  payload          jsonb not null,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  expires_at       timestamptz not null default now() + interval '10 minutes',
  decided_at       timestamptz,
  decided_by       uuid references auth.users(id),
  executed_at      timestamptz,
  result           jsonb,
  created_at       timestamptz not null default now()
);
create index approvals_pending_idx on public.approvals (status, expires_at);

-- Kill switch (D-4). Single row. Every agent checks it before any tool call.
create table public.agent_controls (
  id               boolean primary key default true check (id),
  agents_enabled   boolean not null default true,
  reason           text,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);
insert into public.agent_controls (id, agents_enabled) values (true, true);
create trigger agent_controls_updated before update on public.agent_controls
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Vector stores (gemini-embedding with output_dimensionality = 768)
-- ---------------------------------------------------------------------

create table public.memories (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('fact', 'preference', 'person', 'project')),
  content          text not null,
  embedding        extensions.vector(768),
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);
create index memories_embedding_idx on public.memories using hnsw (embedding extensions.vector_cosine_ops);

create table public.course_kb (
  id               uuid primary key default gen_random_uuid(),
  course           text not null,
  kind             text not null check (kind in ('price', 'content', 'offer', 'faq', 'policy')),
  title            text not null,
  content          text not null,
  price_egp        numeric,                      -- the ONLY prices the courses agent may quote
  valid_until      date,
  embedding        extensions.vector(768),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index course_kb_embedding_idx on public.course_kb using hnsw (embedding extensions.vector_cosine_ops);
create trigger course_kb_updated before update on public.course_kb
  for each row execute function public.set_updated_at();

-- The ONLY retrieval surface for the courses Sales Agent.
create or replace function public.match_course_kb(query_embedding extensions.vector(768), match_count int default 5)
returns table (id uuid, course text, kind text, title text, content text, price_egp numeric, similarity float)
language sql stable set search_path = public as $$
  select k.id, k.course, k.kind, k.title, k.content, k.price_egp,
         1 - (k.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.course_kb k
  where k.embedding is not null
    and (k.valid_until is null or k.valid_until >= public.cairo_today())
  order by k.embedding operator(extensions.<=>) query_embedding
  limit match_count
$$;

-- ---------------------------------------------------------------------
-- Read models used by the dashboard, the live tools and the briefing
-- ---------------------------------------------------------------------

-- W-2: sales outreach for a day, computed from raw messages (no LLM involved).
create or replace function public.sales_outreach(p_day date default public.cairo_today())
returns table (contact_number text, contact_name text, first_outbound_at timestamptz,
               first_reply_at timestamptz, replied boolean, contacted_by text)
language sql stable set search_path = public as $$
  with sales as (
    select id from public.wa_instances where purpose = 'sales'
  ), day_msgs as (
    select m.*
    from public.wa_messages m
    where m.instance_id in (select id from sales)
      and (m.sent_at at time zone 'Africa/Cairo')::date = p_day
  ), firsts as (
    select contact_number,
           max(contact_name) as contact_name,
           min(sent_at) filter (where direction = 'outbound') as first_outbound_at
    from day_msgs group by contact_number
  )
  select f.contact_number, f.contact_name, f.first_outbound_at,
         (select min(d.sent_at) from day_msgs d
           where d.contact_number = f.contact_number and d.direction = 'inbound'
             and d.sent_at > f.first_outbound_at) as first_reply_at,
         exists (select 1 from day_msgs d
           where d.contact_number = f.contact_number and d.direction = 'inbound'
             and d.sent_at > f.first_outbound_at) as replied,
         (select t.name from day_msgs d join public.team_members t on t.id = d.team_member_id
           where d.contact_number = f.contact_number and d.direction = 'outbound'
           order by d.sent_at limit 1) as contacted_by
  from firsts f
  where f.first_outbound_at is not null
  order by f.first_outbound_at
$$;

-- C-1: leads added since a Cairo date, from today's snapshot.
create or replace function public.new_leads(p_since date default public.cairo_today())
returns table (perfex_lead_id int, name text, company text, source text, status text, date_added timestamptz)
language sql stable set search_path = public as $$
  select perfex_lead_id, name, company, source, status, date_added
  from public.leads_daily
  where snapshot_date = public.cairo_today()
    and (date_added at time zone 'Africa/Cairo')::date >= p_since
  order by date_added desc
  limit 50
$$;

-- One JSON document = the "Today" screen, the morning briefing input and the
-- get_today_overview tool. Security invoker: RLS applies to the caller.
create or replace function public.today_overview(p_day date default public.cairo_today())
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'day', p_day,
    'generated_at', now(),
    'agents_enabled', (select agents_enabled from public.agent_controls limit 1),

    'leads', jsonb_build_object(
      'new_count', (select count(*) from public.leads_daily
                     where snapshot_date = p_day
                       and (date_added at time zone 'Africa/Cairo')::date = p_day),
      'by_source', coalesce((select jsonb_object_agg(coalesce(source, 'غير معروف'), n) from (
                     select source, count(*) n from public.leads_daily
                     where snapshot_date = p_day and (date_added at time zone 'Africa/Cairo')::date = p_day
                     group by source) s), '{}'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', perfex_lead_id, 'name', name, 'source', source, 'status', status,
                     'date_added', date_added) order by date_added desc) from (
                     select * from public.leads_daily
                     where snapshot_date = p_day and (date_added at time zone 'Africa/Cairo')::date = p_day
                     order by date_added desc limit 20) l), '[]'::jsonb)
    ),

    'support', (select jsonb_build_object(
        'issues', count(*) filter (where c.category = 'issue'),
        'unresolved', count(*) filter (where c.category = 'issue' and c.status <> 'resolved'),
        'angry', count(*) filter (where c.sentiment = 'angry'),
        'items', coalesce(jsonb_agg(jsonb_build_object(
            'contact', coalesce(c.contact_name, c.contact_number), 'summary', c.summary,
            'status', c.status, 'sentiment', c.sentiment) order by c.last_message_at desc)
          filter (where c.category = 'issue'), '[]'::jsonb))
      from public.wa_conversations c
      join public.wa_instances i on i.id = c.instance_id and i.purpose = 'support'
      where c.day = p_day),

    'sales', (select jsonb_build_object(
        'contacted', count(*),
        'replied', count(*) filter (where replied),
        'no_reply', coalesce(jsonb_agg(jsonb_build_object(
            'contact', coalesce(contact_name, contact_number), 'contacted_by', contacted_by,
            'at', first_outbound_at)) filter (where not replied), '[]'::jsonb))
      from public.sales_outreach(p_day)),

    'team', coalesce((select jsonb_agg(jsonb_build_object(
        'name', t.name, 'department', t.department,
        'tasks_closed', coalesce(a.tasks_closed, 0), 'hours', coalesce(a.hours, 0),
        'conversations', coalesce(a.conversations, 0), 'posts', coalesce(a.posts, 0))
        order by t.department, t.name)
      from public.team_members t
      left join (
        select team_member_id,
               sum(quantity) filter (where kind = 'task_closed')    as tasks_closed,
               sum(quantity) filter (where kind = 'hours_logged')   as hours,
               sum(quantity) filter (where kind = 'conversation')   as conversations,
               sum(quantity) filter (where kind = 'post_published') as posts
        from public.team_activity where day = p_day group by team_member_id
      ) a on a.team_member_id = t.id
      where t.active), '[]'::jsonb),

    'social', coalesce((select jsonb_agg(jsonb_build_object(
        'platform', s.platform, 'day', s.day, 'views', s.views, 'followers', s.followers,
        'new_followers', s.new_followers, 'top_post', s.top_post) order by s.platform)
      from (select distinct on (platform) * from public.social_metrics
            where day <= p_day order by platform, day desc) s), '[]'::jsonb),

    'pending_approvals', (select count(*) from public.approvals
                          where status = 'pending' and expires_at > now()),
    'open_events', coalesce((select jsonb_agg(jsonb_build_object(
        'type', type, 'severity', severity, 'title', title, 'at', created_at) order by created_at desc)
      from (select * from public.events where acknowledged_at is null
            order by created_at desc limit 10) e), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------
-- Approvals housekeeping (pg_cron, every minute)
-- ---------------------------------------------------------------------

create or replace function public.expire_approvals()
returns integer language sql set search_path = public as $$
  with x as (
    update public.approvals set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning 1
  ) select count(*)::int from x
$$;

select cron.schedule('jarvis-expire-approvals', '* * * * *', $$select public.expire_approvals()$$);

-- Owner decides on an approval from the dashboard (approve / reject).
-- Approving does NOT execute: n8n picks up approved rows (write token) and
-- marks them executed/failed. Expired or non-pending rows cannot be approved.
create or replace function public.decide_approval(p_id uuid, p_approve boolean)
returns public.approvals
language plpgsql security definer set search_path = public as $$
declare r public.approvals;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;
  update public.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_id and status = 'pending' and expires_at > now()
  returning * into r;
  if r.id is null then
    raise exception 'approval not pending or expired';
  end if;
  return r;
end $$;

-- Kill switch toggle (owner only).
create or replace function public.set_agents_enabled(p_enabled boolean, p_reason text default null)
returns public.agent_controls
language plpgsql security definer set search_path = public as $$
declare r public.agent_controls;
begin
  if not public.is_owner() then
    raise exception 'not allowed';
  end if;
  update public.agent_controls
     set agents_enabled = p_enabled, reason = p_reason, updated_by = auth.uid()
   where id
  returning * into r;
  if not p_enabled then
    -- Nothing that was waiting may run after the switch is pulled.
    update public.approvals set status = 'rejected', decided_at = now(), decided_by = auth.uid()
     where status in ('pending', 'approved');
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- RLS: on for every table. Owner can read everything; writes from the
-- dashboard go only through the security-definer functions above.
-- n8n / OpenClaw use the service role server-side.
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'app_owners', 'team_members', 'wa_instances', 'wa_messages', 'wa_conversations',
    'leads_daily', 'team_activity', 'social_metrics', 'briefings', 'events',
    'tool_calls', 'approvals', 'agent_controls', 'memories', 'course_kb'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (public.is_owner())', t);
  end loop;
end $$;

-- Owner may acknowledge events from the dashboard.
create policy owner_ack_events on public.events for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

revoke all on function public.decide_approval(uuid, boolean) from public, anon;
revoke all on function public.set_agents_enabled(boolean, text) from public, anon;
grant execute on function public.decide_approval(uuid, boolean) to authenticated;
grant execute on function public.set_agents_enabled(boolean, text) to authenticated;
revoke all on function public.match_course_kb(extensions.vector, int) from public, anon, authenticated;
grant execute on function public.match_course_kb(extensions.vector, int) to service_role;

-- ---------------------------------------------------------------------
-- Realtime for the "Today" screen (D-1)
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table
  public.wa_conversations, public.wa_messages, public.leads_daily, public.team_activity,
  public.social_metrics, public.events, public.approvals, public.agent_controls,
  public.tool_calls, public.briefings;
