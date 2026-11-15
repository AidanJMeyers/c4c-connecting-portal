-- Connections 4 Change: database schema (DRAFT, not yet run against a live project)
-- Target: Supabase (Postgres + Auth + Storage). See docs/SPEC.md.
-- Run in the Supabase SQL editor on a fresh project. Review with the board before loading real data.
--
-- Design rule: anything the public may see lives in a different table from anything private,
-- so row-level security can open one without exposing the other.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type user_role          as enum ('professional', 'organization', 'admin');
create type professional_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type request_status     as enum ('new', 'matching', 'awaiting_presenter', 'connected', 'confirmed', 'completed', 'declined', 'cancelled');
create type candidate_response as enum ('invited', 'interested', 'declined', 'no_reply');
create type material_kind      as enum ('slides', 'handout', 'template', 'branding', 'other');
create type check_result       as enum ('ok', 'not_found', 'inactive', 'mismatch', 'error');

-- ---------------------------------------------------------------- accounts
-- One row per signed-in user. id matches auth.users.id.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null,
  email       text not null,
  full_name   text not null,
  created_at  timestamptz not null default now()
);

-- SECURITY DEFINER so policies can ask "is this user an admin?" without recursive RLS.
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------- professionals
-- PUBLIC half of a profile (shown in the directory once approved).
create table professionals (
  id                uuid primary key references profiles(id) on delete cascade,
  display_name      text not null,
  city_state        text,
  license_type      text not null,
  license_state     char(2) not null,
  bio               text not null check (char_length(bio) <= 800),
  website           text,
  headshot_path     text,                    -- storage path in bucket "headshots"
  expertise         text[] not null default '{}',
  audiences         text[] not null default '{}',
  event_types       text[] not null default '{}',   -- panel, workshop, psychoeducation...
  delivery          text[] not null default '{}',   -- Virtual, In-person
  availability      text[] not null default '{}',   -- general windows, not exact days
  status            professional_status not null default 'pending',
  approved_at       timestamptz,
  profile_confirmed_at timestamptz,           -- last time they answered the bi-monthly "anything changed?" email
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- PRIVATE half: only the owner and admins can read it.
create table professional_private (
  professional_id   uuid primary key references professionals(id) on delete cascade,
  phone             text,
  license_number    text not null,
  years_practicing  int,
  timezone          text not null default 'America/New_York',
  min_notice_days   int not null default 30,
  ins_carrier       text not null,
  ins_policy_number text not null,
  ins_limits        text not null,            -- e.g. "$1M / $3M"
  ins_expires       date not null,
  commit_annual     boolean not null default false,  -- willing to present once a year if called
  ack_not_insured_by_c4c_at timestamptz not null,    -- when they accepted the liability acknowledgment
  terms_version     text not null
);

-- Result of each automated license check (monthly job). Admins are emailed only when result <> 'ok'.
create table license_checks (
  id              bigint generated always as identity primary key,
  professional_id uuid not null references professionals(id) on delete cascade,
  checked_at      timestamptz not null default now(),
  source          text not null,              -- e.g. 'FL DOH MQA'
  result          check_result not null,
  detail          text
);

-- ---------------------------------------------------------------- organizations
-- One login per organization for now: the lead contact. CC emails are copied on every message.
create table organizations (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null unique references profiles(id) on delete cascade,
  name            text not null,
  org_type        text not null,
  lead_name       text not null,
  lead_email      text not null,
  cc_emails       text[] not null default '{}',
  prior_contact   boolean,                    -- "Have you worked with C4C before?"
  intro_call_offered_at timestamptz,          -- set when the automatic intro-call email goes out
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- requests and matching
create table requests (
  id              uuid primary key default gen_random_uuid(),
  tracking_id     text not null unique,       -- e.g. C4C-7HK2MQ
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_professional_id uuid references professionals(id) on delete set null,  -- chosen from the directory, if any
  matched_professional_id   uuid references professionals(id) on delete set null,
  event_type      text not null,
  topics          text[] not null default '{}',
  audiences       text[] not null default '{}',
  age_range       text,
  attendees_expected int,
  delivery        text not null,
  location        text,
  duration_min    int not null default 60,
  window_start    date not null,
  window_end      date not null check (window_end >= window_start),
  description     text not null,
  support_level   text,                       -- intent only; no payment is processed
  status          request_status not null default 'new',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Up to five suggested presenters per request; each can be invited by email.
create table request_candidates (
  request_id      uuid not null references requests(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  score           int not null default 0,
  invited_at      timestamptz,
  response        candidate_response,
  responded_at    timestamptz,
  primary key (request_id, professional_id)
);

create table request_history (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references requests(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid references profiles(id) on delete set null,
  what        text not null
);

-- ---------------------------------------------------------------- events
create table events (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references requests(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete restrict,
  title           text not null,
  starts_at       timestamptz not null,
  duration_min    int not null default 60,
  location        text,
  share_token     text not null unique default encode(gen_random_bytes(16), 'hex'),    -- event page link for the school
  feedback_token  text not null unique default encode(gen_random_bytes(8), 'hex'),     -- attendee QR code target
  attendance_actual int,
  presenter_hours numeric(5,2),
  slides_reminder_sent_at timestamptz,
  surveys_sent_at timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- materials and resource bank
create table materials (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references profiles(id) on delete set null,
  title           text not null,
  kind            material_kind not null,
  topics          text[] not null default '{}',
  storage_path    text not null,              -- path in private bucket "materials"
  is_c4c_official boolean not null default false,  -- template deck, branding guide, curated C4C workshops
  in_shared_bank  boolean not null default false,  -- owner agreed to share with other presenters
  created_at      timestamptz not null default now()
);

create table event_materials (
  event_id    uuid not null references events(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  primary key (event_id, material_id)
);

-- ---------------------------------------------------------------- feedback
-- Anonymous attendee responses, submitted through the event's QR code (via an Edge Function that checks feedback_token).
create table attendee_feedback (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references events(id) on delete cascade,
  submitted_at  timestamptz not null default now(),
  role          text,                         -- student, parent, educator...
  knowledge_before smallint check (knowledge_before between 1 and 5),
  knowledge_after  smallint check (knowledge_after between 1 and 5),
  would_recommend  smallint check (would_recommend between 1 and 5),
  most_useful   text,
  next_topic    text
);

-- Post-event surveys: the organization about the session, and the presenter about the organization.
create table event_surveys (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references events(id) on delete cascade,
  respondent_id uuid not null references profiles(id) on delete cascade,
  respondent_role user_role not null,
  answers       jsonb not null,
  submitted_at  timestamptz not null default now(),
  unique (event_id, respondent_id)
);

-- ---------------------------------------------------------------- communications
-- Every email the system sends, so admins can see all outbound contact.
create table email_log (
  id          bigint generated always as identity primary key,
  sent_at     timestamptz not null default now(),
  template    text not null,
  to_emails   text[] not null,
  cc_emails   text[] not null default '{}',
  subject     text not null,
  request_id  uuid references requests(id) on delete set null,
  event_id    uuid references events(id) on delete set null,
  provider_id text,
  status      text not null default 'sent'
);

create table news_posts (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  published_at timestamptz,
  author_id   uuid references profiles(id) on delete set null
);

-- ---------------------------------------------------------------- indexes
create index on professionals (status);
create index on professionals using gin (expertise);
create index on professionals using gin (audiences);
create index on requests (organization_id);
create index on requests (status);
create index on events (starts_at);
create index on license_checks (professional_id, checked_at desc);

-- ================================================================ row-level security
alter table profiles             enable row level security;
alter table professionals        enable row level security;
alter table professional_private enable row level security;
alter table license_checks       enable row level security;
alter table organizations        enable row level security;
alter table requests             enable row level security;
alter table request_candidates   enable row level security;
alter table request_history      enable row level security;
alter table events               enable row level security;
alter table materials            enable row level security;
alter table event_materials      enable row level security;
alter table attendee_feedback    enable row level security;
alter table event_surveys        enable row level security;
alter table email_log            enable row level security;
alter table news_posts           enable row level security;

-- helpers (SECURITY DEFINER so a policy never has to query its own table, which Postgres rejects as recursive)
create or replace function my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from organizations where owner_id = auth.uid();
$$;
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;
create or replace function my_pro_status() returns professional_status
language sql stable security definer set search_path = public as $$
  select status from professionals where id = auth.uid();
$$;

-- profiles: you see yourself; admins see everyone. Role can't be self-assigned to admin (signup goes through an Edge Function).
create policy profiles_self   on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = my_role());
create policy profiles_admin  on profiles for all using (is_admin()) with check (is_admin());

-- professionals: anyone (even signed out) can read APPROVED profiles; owners read and edit their own; admins everything.
create policy pro_public on professionals for select using (status = 'approved' or id = auth.uid() or is_admin());
create policy pro_insert on professionals for insert with check (id = auth.uid() and status = 'pending');
-- Owners may edit their public fields but not their own approval status.
create policy pro_update on professionals for update using (id = auth.uid())
  with check (id = auth.uid() and status = my_pro_status());
create policy pro_admin  on professionals for all using (is_admin()) with check (is_admin());

-- private half: owner and admins only.
create policy priv_owner on professional_private for all using (professional_id = auth.uid()) with check (professional_id = auth.uid());
create policy priv_admin on professional_private for all using (is_admin()) with check (is_admin());

create policy lic_owner on license_checks for select using (professional_id = auth.uid() or is_admin());
create policy lic_admin on license_checks for all using (is_admin()) with check (is_admin());

-- organizations: owner and admins. A professional can see the organization once they share a request.
create policy org_owner on organizations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy org_admin on organizations for all using (is_admin()) with check (is_admin());
create policy org_matched on organizations for select using (
  exists (select 1 from requests r where r.organization_id = organizations.id
          and (r.matched_professional_id = auth.uid() or r.requested_professional_id = auth.uid()))
  or exists (select 1 from request_candidates c join requests r on r.id = c.request_id
             where r.organization_id = organizations.id and c.professional_id = auth.uid() and c.invited_at is not null)
);

-- requests: the organization that made it; the requested, matched or invited professional; admins.
create policy req_org on requests for all using (organization_id = my_org_id()) with check (organization_id = my_org_id());
create policy req_pro on requests for select using (
  requested_professional_id = auth.uid() or matched_professional_id = auth.uid()
  or exists (select 1 from request_candidates c where c.request_id = requests.id and c.professional_id = auth.uid() and c.invited_at is not null)
);
create policy req_admin on requests for all using (is_admin()) with check (is_admin());
-- Accept/decline by a professional goes through an Edge Function (it also logs history and sends email).

create policy cand_pro   on request_candidates for select using (professional_id = auth.uid());
create policy cand_admin on request_candidates for all using (is_admin()) with check (is_admin());

create policy hist_read on request_history for select using (
  is_admin() or exists (select 1 from requests r where r.id = request_history.request_id
                        and (r.organization_id = my_org_id() or r.matched_professional_id = auth.uid()))
);

-- events: both parties and admins. (The share-token event page is served by an Edge Function, not by direct table access.)
create policy ev_party on events for select using (organization_id = my_org_id() or professional_id = auth.uid() or is_admin());
create policy ev_pro_update on events for update using (professional_id = auth.uid()) with check (professional_id = auth.uid());
create policy ev_admin on events for all using (is_admin()) with check (is_admin());

-- materials: owners manage their own; signed-in professionals can read the shared bank and official C4C items.
create policy mat_owner on materials for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and is_c4c_official = false);
create policy mat_bank  on materials for select using (
  (in_shared_bank or is_c4c_official) and my_role() in ('professional', 'admin')
);
create policy mat_event on materials for select using (
  exists (select 1 from event_materials em join events e on e.id = em.event_id
          where em.material_id = materials.id and e.organization_id = my_org_id())
);
create policy mat_admin on materials for all using (is_admin()) with check (is_admin());

create policy em_party on event_materials for select using (
  exists (select 1 from events e where e.id = event_materials.event_id
          and (e.organization_id = my_org_id() or e.professional_id = auth.uid())) or is_admin()
);
create policy em_pro on event_materials for all using (
  exists (select 1 from events e where e.id = event_materials.event_id and e.professional_id = auth.uid())
) with check (
  exists (select 1 from events e where e.id = event_materials.event_id and e.professional_id = auth.uid())
);
create policy em_admin on event_materials for all using (is_admin()) with check (is_admin());

-- attendee feedback: inserted only by the Edge Function (service role). Read by the presenter, the organization and admins.
create policy fb_read on attendee_feedback for select using (
  is_admin() or exists (select 1 from events e where e.id = attendee_feedback.event_id
                        and (e.professional_id = auth.uid() or e.organization_id = my_org_id()))
);

-- surveys: you write your own; admins read all. (Each side does not see the other's survey.)
create policy sv_own   on event_surveys for all using (respondent_id = auth.uid()) with check (respondent_id = auth.uid());
create policy sv_admin on event_surveys for select using (is_admin());

-- email log: admins only.
create policy mail_admin on email_log for all using (is_admin()) with check (is_admin());

-- news: published posts are public.
create policy news_public on news_posts for select using (published_at is not null and published_at <= now() or is_admin());
create policy news_admin  on news_posts for all using (is_admin()) with check (is_admin());

-- ================================================================ impact reporting (admin dashboard / annual statement)
create or replace view impact_by_year with (security_invoker = true) as
select date_part('year', e.starts_at)::int        as year,
       count(*)                                    as events,
       coalesce(sum(e.attendance_actual), 0)       as people_reached,
       coalesce(sum(e.presenter_hours), 0)         as presenter_hours,
       count(distinct e.organization_id)           as organizations_served,
       count(distinct e.professional_id)           as presenters_active
from events e
where e.starts_at < now()
group by 1;

create or replace view top_contributors with (security_invoker = true) as
select p.id, p.display_name,
       count(e.id)                           as events,
       coalesce(sum(e.attendance_actual), 0) as people_reached,
       coalesce(sum(e.presenter_hours), 0)   as hours
from professionals p
join events e on e.professional_id = p.id and e.starts_at < now()
group by p.id, p.display_name
order by people_reached desc;

-- ================================================================ storage buckets (create in the Supabase dashboard)
--   headshots  : public read
--   materials  : private; access through signed URLs issued after the policies above are checked
--
-- ================================================================ scheduled jobs (pg_cron -> Edge Functions), to build next
--   monthly     license-recheck        : re-verify every approved license; email admins only on failures; auto-suspend lapsed
--   daily       insurance-expiry       : warn presenters 30 days before ins_expires; flag admins when expired
--   daily       slides-reminder        : remind presenters with no event_materials as the event approaches
--   daily       post-event-surveys     : send both surveys the day after an event
--   bi-monthly  profile-checkin        : "anything changed?" email with a one-click update link
