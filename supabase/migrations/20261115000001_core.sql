-- =====================================================================
-- Connections 4 Change · core schema
-- Accounts, presenter profiles, organizations, requests, matching, events, email outbox.
-- Target: Supabase (Postgres 15+). Verified locally by supabase/tests (PGlite).
--
-- Design rules
--   1. Public and private data live in different tables, so row-level security (RLS)
--      can open one without exposing the other.
--   2. State changes that matter (accepting, choosing, scheduling) go through the
--      functions in section 6, never a raw table update from the browser.
--   3. Policies never query another RLS-protected table directly. They call the
--      SECURITY DEFINER helpers in section 3, which avoids recursive-policy errors.
--   4. Ownership checks inside functions are written `if not coalesce(<check>, false)`.
--      A comparison with NULL (for example a user with no organization) is "unknown" in SQL,
--      and a bare `if not (<check>)` would skip the check instead of failing it.
--   5. "Privileged" means a C4C admin, the SQL editor, or the service role.
--      Everyone else is a normal signed-in user and is held to the guards in section 4.
-- =====================================================================

-- ---------------------------------------------------------------- 1. types
create type user_role           as enum ('professional', 'organization', 'admin');
create type professional_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type request_status      as enum ('new', 'matching', 'awaiting_presenter', 'connected', 'confirmed', 'completed', 'declined', 'cancelled');
create type candidate_response  as enum ('interested', 'declined');
create type check_result        as enum ('ok', 'not_found', 'inactive', 'mismatch', 'error');
create type email_status        as enum ('queued', 'sent', 'failed', 'skipped');

-- ---------------------------------------------------------------- 2. tables
-- One row per signed-in user; id matches auth.users.id. Created by the trigger in section 9.
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       user_role not null default 'professional',
  email      text not null,
  full_name  text not null,
  created_at timestamptz not null default now()
);

-- PUBLIC half of a presenter profile (shown in the directory once approved).
create table professionals (
  id             uuid primary key references profiles (id) on delete cascade,
  display_name   text not null,
  city_state     text,
  license_type   text not null,
  license_state  text not null check (license_state ~ '^[A-Z]{2}$'),
  bio            text not null check (char_length(bio) <= 800),
  website        text,
  headshot_path  text,
  expertise      text[] not null default '{}',
  audiences      text[] not null default '{}',
  event_types    text[] not null default '{}',
  delivery       text[] not null default '{}',
  availability   text[] not null default '{}',
  status         professional_status not null default 'pending',
  approved_at    timestamptz,
  profile_confirmed_at timestamptz,          -- last reply to the "anything changed?" check-in
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- PRIVATE half: only the owner and admins can read it.
create table professional_private (
  professional_id    uuid primary key references professionals (id) on delete cascade,
  phone              text,
  license_number     text not null,
  years_practicing   int check (years_practicing between 0 and 80),
  timezone           text not null default 'America/New_York',
  min_notice_days    int not null default 30 check (min_notice_days between 1 and 365),
  ins_carrier        text not null,
  ins_policy_number  text not null,
  ins_limits         text not null,
  ins_expires        date not null,
  ins_verified_at    timestamptz,             -- set by an admin; cleared when the owner edits insurance
  commit_annual      boolean not null default false,
  ack_independent_at timestamptz not null default now(),  -- accepted "C4C does not employ, supervise or insure me"
  terms_version      text not null default 'draft-2026-11'
);

-- Log of automated license checks. Admins are alerted only when result <> 'ok'.
create table license_checks (
  id              bigint generated always as identity primary key,
  professional_id uuid not null references professionals (id) on delete cascade,
  checked_at      timestamptz not null default now(),
  source          text not null,
  result          check_result not null,
  detail          text
);

-- One login per organization for now (the lead contact). CC emails are copied on every message.
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references profiles (id) on delete cascade,
  name          text not null,
  org_type      text not null,
  lead_name     text not null,
  lead_email    text not null,
  cc_emails     text[] not null default '{}',
  prior_contact boolean,                      -- "Have you worked with C4C before?"
  intro_call_offered_at timestamptz,
  created_at    timestamptz not null default now()
);

create table requests (
  id                        uuid primary key default gen_random_uuid(),
  tracking_id               text not null unique,           -- e.g. C4C-7HK2MQ, set by trigger
  organization_id           uuid not null references organizations (id) on delete cascade,
  requested_professional_id uuid references professionals (id) on delete set null,  -- picked from the directory
  matched_professional_id   uuid references professionals (id) on delete set null,
  event_type                text not null,
  topics                    text[] not null default '{}',
  audiences                 text[] not null default '{}',
  age_range                 text,
  attendees_expected        int check (attendees_expected > 0),
  delivery                  text not null default 'In-person',
  location                  text,
  duration_min              int not null default 60 check (duration_min between 15 and 480),
  timezone                  text not null default 'America/New_York',
  window_start              date not null,
  window_end                date not null,
  description               text not null,
  support_level             text,                           -- intent only; no payment is processed
  status                    request_status not null default 'new',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (window_end >= window_start)
);

-- Presenters C4C invited to consider a request (up to five suggested).
create table request_candidates (
  request_id      uuid not null references requests (id) on delete cascade,
  professional_id uuid not null references professionals (id) on delete cascade,
  score           int not null default 0,
  invited_at      timestamptz not null default now(),
  response        candidate_response,
  responded_at    timestamptz,
  primary key (request_id, professional_id)
);

-- Timeline shown to the organization and the matched presenter. Wording stays neutral
-- (no names of presenters who were merely invited or who declined).
create table request_history (
  id         bigint generated always as identity primary key,
  request_id uuid not null references requests (id) on delete cascade,
  at         timestamptz not null default now(),
  actor_id   uuid references profiles (id) on delete set null,
  what       text not null
);

create table events (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null unique references requests (id) on delete cascade,
  organization_id   uuid not null references organizations (id) on delete cascade,
  professional_id   uuid not null references professionals (id) on delete restrict,
  title             text not null,
  starts_at         timestamptz not null,
  duration_min      int not null default 60,
  location          text,
  share_token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  feedback_token    text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  attendance_actual int check (attendance_actual >= 0),
  presenter_hours   numeric(5,2) check (presenter_hours >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Every email the system wants to send. A small sender job delivers queued rows and marks
-- them sent, so admins can see all outbound contact in one place.
create table email_outbox (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  template    text not null,
  to_emails   text[] not null,
  cc_emails   text[] not null default '{}',
  payload     jsonb not null default '{}',
  request_id  uuid references requests (id) on delete set null,
  status      email_status not null default 'queued',
  sent_at     timestamptz,
  provider_id text,
  error       text
);

create index on professionals (status);
create index on professionals using gin (expertise);
create index on professionals using gin (audiences);
create index on requests (organization_id);
create index on requests (status);
create index on requests (matched_professional_id);
create index on request_candidates (professional_id);
create index on request_history (request_id, at);
create index on events (starts_at);
create index on license_checks (professional_id, checked_at desc);
create index on email_outbox (status, id);

-- ---------------------------------------------------------------- 3. helpers used by policies
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from organizations where owner_id = auth.uid();
$$;

-- SECURITY INVOKER on purpose: it must see the role of whoever is running the statement.
-- API users run as "authenticated" or "anon"; everything else (SQL editor, service role,
-- and the SECURITY DEFINER functions below) is trusted.
create or replace function is_privileged() returns boolean
language sql stable as $$
  select current_user not in ('authenticated', 'anon') or is_admin();
$$;

create or replace function admin_emails() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(email), '{}') from profiles where role = 'admin';
$$;

create or replace function request_org_id(p_request_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from requests where id = p_request_id;
$$;

-- Is the caller the requested, matched or an invited presenter on this request?
create or replace function is_request_professional(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = p_request_id
      and (r.matched_professional_id = auth.uid()
           or r.requested_professional_id = auth.uid()
           or exists (select 1 from request_candidates c
                      where c.request_id = r.id and c.professional_id = auth.uid()))
  );
$$;

create or replace function is_matched_professional(p_request_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests where id = p_request_id and matched_professional_id = auth.uid());
$$;

-- A presenter may see an organization once they share a request with it.
create or replace function org_visible_to_me(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.organization_id = p_org_id
      and (r.matched_professional_id = auth.uid()
           or r.requested_professional_id = auth.uid()
           or exists (select 1 from request_candidates c
                      where c.request_id = r.id and c.professional_id = auth.uid()))
  );
$$;

-- An organization may see its matched presenter's contact details once connected.
create or replace function profile_visible_to_me(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.matched_professional_id = p_profile_id
      and r.organization_id = my_org_id()
      and r.status in ('connected', 'confirmed', 'completed')
  );
$$;

-- Unused, unambiguous tracking number such as C4C-7HK2MQ.
create or replace function gen_tracking_id() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    select 'C4C-' || string_agg(substr(alphabet, 1 + get_byte(s.b, i) % length(alphabet), 1), '' order by i)
      into candidate
      from (select uuid_send(gen_random_uuid()) as b) s, generate_series(0, 5) as i;
    exit when not exists (select 1 from requests where tracking_id = candidate);
  end loop;
  return candidate;
end $$;

-- ---------------------------------------------------------------- 4. guards (BEFORE triggers)
-- Presenters edit their own public profile but can never approve themselves.
-- Changing license details sends an approved profile back to review.
create or replace function professionals_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not is_privileged() then
      new.status := 'pending';
      new.approved_at := null;
    end if;
  else
    if not is_privileged() then
      new.id := old.id;
      new.created_at := old.created_at;
      new.status := old.status;
      new.approved_at := old.approved_at;
      if (new.license_type is distinct from old.license_type
          or new.license_state is distinct from old.license_state)
         and old.status in ('approved', 'rejected') then
        new.status := 'pending';
        new.approved_at := null;
      end if;
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'approved' and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end $$;

create trigger professionals_guard before insert or update on professionals
  for each row execute function professionals_guard();

-- Called when a presenter changes their own license number. Acts only on the caller.
create or replace function unlist_me_for_reverification() returns void
language sql security definer set search_path = public as $$
  update professionals set status = 'pending', approved_at = null
  where id = auth.uid() and status in ('approved', 'rejected');
$$;

create or replace function professional_private_guard() returns trigger
language plpgsql as $$
begin
  if is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.ins_verified_at := null;
    return new;
  end if;
  new.professional_id := old.professional_id;
  new.ins_verified_at := old.ins_verified_at;
  if new.license_number is distinct from old.license_number then
    perform unlist_me_for_reverification();
  end if;
  if (new.ins_carrier, new.ins_policy_number, new.ins_limits, new.ins_expires)
     is distinct from (old.ins_carrier, old.ins_policy_number, old.ins_limits, old.ins_expires) then
    new.ins_verified_at := null;
  end if;
  return new;
end $$;

create trigger professional_private_guard before insert or update on professional_private
  for each row execute function professional_private_guard();

create or replace function organizations_guard() returns trigger
language plpgsql as $$
begin
  if is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.intro_call_offered_at := null;
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.intro_call_offered_at := old.intro_call_offered_at;
  end if;
  return new;
end $$;

create trigger organizations_guard before insert or update on organizations
  for each row execute function organizations_guard();

-- Organizations describe what they need; they cannot set status, matches or tracking numbers.
create or replace function requests_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not is_privileged() then
      new.tracking_id := gen_tracking_id();
      new.matched_professional_id := null;
      new.created_at := now();
      if new.requested_professional_id is not null then
        if not exists (select 1 from professionals
                       where id = new.requested_professional_id and status = 'approved') then
          raise exception 'That presenter is not available for requests';
        end if;
        new.status := 'awaiting_presenter';
      else
        new.status := 'new';
      end if;
    elsif new.tracking_id is null then
      new.tracking_id := gen_tracking_id();
    end if;
  else
    if not is_privileged() then
      if new.id is distinct from old.id
         or new.tracking_id is distinct from old.tracking_id
         or new.organization_id is distinct from old.organization_id
         or new.requested_professional_id is distinct from old.requested_professional_id
         or new.matched_professional_id is distinct from old.matched_professional_id
         or new.status is distinct from old.status then
        raise exception 'That change is made by C4C or through the portal actions, not by editing the request';
      end if;
      if old.status in ('completed', 'cancelled') then
        raise exception 'This request is closed';
      end if;
      new.created_at := old.created_at;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger requests_guard before insert or update on requests
  for each row execute function requests_guard();

-- ---------------------------------------------------------------- 5. email outbox and AFTER triggers
create or replace function enqueue_email(p_template text, p_to text[], p_cc text[], p_payload jsonb, p_request_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_to text[] := array_remove(coalesce(p_to, '{}'), null);
begin
  if cardinality(v_to) = 0 then return; end if;
  insert into email_outbox (template, to_emails, cc_emails, payload, request_id)
  values (p_template, v_to, array_remove(coalesce(p_cc, '{}'), null), coalesce(p_payload, '{}'), p_request_id);
end $$;

-- Everything an email template needs to know about a request.
create or replace function request_payload(p_request_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tracking_id', r.tracking_id, 'status', r.status, 'event_type', r.event_type,
    'window_start', r.window_start, 'window_end', r.window_end,
    'audiences', r.audiences, 'topics', r.topics, 'delivery', r.delivery,
    'org_name', o.name, 'lead_name', o.lead_name, 'lead_email', o.lead_email,
    'presenter_name', pr.display_name, 'presenter_email', pf.email,
    'event_starts_at', e.starts_at, 'event_location', coalesce(e.location, r.location))
  from requests r
  join organizations o on o.id = r.organization_id
  left join professionals pr on pr.id = r.matched_professional_id
  left join profiles pf on pf.id = r.matched_professional_id
  left join events e on e.request_id = r.id
  where r.id = p_request_id;
$$;

create or replace function requests_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o organizations%rowtype;
  v_payload jsonb;
  v_pres_email text;
  v_what text;
begin
  select * into o from organizations where id = new.organization_id;
  v_payload := request_payload(new.id);

  if tg_op = 'INSERT' then
    insert into request_history (request_id, actor_id, what) values (new.id, auth.uid(), 'Request submitted');
    perform enqueue_email('request_received', array[o.lead_email], o.cc_emails, v_payload, new.id);
    perform enqueue_email('admin_new_request', admin_emails(), null, v_payload, new.id);
    if new.requested_professional_id is not null then
      select email into v_pres_email from profiles where id = new.requested_professional_id;
      perform enqueue_email('presenter_invited', array[v_pres_email], null, v_payload, new.id);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    select email into v_pres_email from profiles
      where id = coalesce(new.matched_professional_id, new.requested_professional_id);
    v_what := case new.status
      when 'new'                then 'Request reopened'
      when 'matching'           then 'C4C is finding presenters for this request'
      when 'awaiting_presenter' then 'Waiting for the requested presenter to reply'
      when 'connected'          then 'Connected with ' || coalesce(v_payload ->> 'presenter_name', 'a presenter')
      when 'confirmed'          then 'Date confirmed'
      when 'completed'          then 'Session completed'
      when 'declined'           then 'C4C could not fill this request'
      when 'cancelled'          then 'Request cancelled'
    end;
    insert into request_history (request_id, actor_id, what) values (new.id, auth.uid(), v_what);

    if new.status = 'connected' then
      perform enqueue_email('connected_organization', array[o.lead_email], o.cc_emails, v_payload, new.id);
      perform enqueue_email('connected_presenter', array[v_pres_email], null, v_payload, new.id);
      perform enqueue_email('admin_connection', admin_emails(), null, v_payload, new.id);
    elsif new.status = 'confirmed' then
      perform enqueue_email('event_confirmed', array[o.lead_email, v_pres_email], o.cc_emails, v_payload, new.id);
      perform enqueue_email('admin_event_confirmed', admin_emails(), null, v_payload, new.id);
    elsif new.status = 'matching' and old.status = 'awaiting_presenter' then
      perform enqueue_email('admin_needs_matching', admin_emails(), null, v_payload, new.id);
    elsif new.status = 'cancelled' then
      perform enqueue_email('request_cancelled', array[v_pres_email], null, v_payload, new.id);
      perform enqueue_email('admin_request_cancelled', admin_emails(), null, v_payload, new.id);
    end if;
  end if;
  return new;
end $$;

create trigger requests_after after insert or update on requests
  for each row execute function requests_after();

create or replace function professionals_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_payload jsonb;
begin
  select email into v_email from profiles where id = new.id;
  v_payload := jsonb_build_object('presenter_name', new.display_name, 'presenter_email', v_email,
                                  'license_type', new.license_type, 'license_state', new.license_state);
  if tg_op = 'INSERT' then
    perform enqueue_email('application_received', array[v_email], null, v_payload);
    perform enqueue_email('admin_new_presenter', admin_emails(), null, v_payload);
  elsif new.status is distinct from old.status then
    if new.status = 'approved' then
      perform enqueue_email('profile_approved', array[v_email], null, v_payload);
    elsif new.status = 'pending' and old.status = 'approved' then
      perform enqueue_email('admin_reverify_presenter', admin_emails(), null, v_payload);
    end if;
  end if;
  return new;
end $$;

create trigger professionals_after after insert or update on professionals
  for each row execute function professionals_after();

-- New organizations: tell the admins, and offer an intro call to first-timers.
create or replace function organizations_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := jsonb_build_object('org_name', new.name, 'org_type', new.org_type, 'lead_name', new.lead_name,
                                        'lead_email', new.lead_email, 'prior_contact', new.prior_contact);
begin
  perform enqueue_email('admin_new_organization', admin_emails(), null, v_payload);
  if new.prior_contact is false then
    perform enqueue_email('intro_call_offer', array[new.lead_email], new.cc_emails, v_payload);
    update organizations set intro_call_offered_at = now() where id = new.id;
  end if;
  return new;
end $$;

create trigger organizations_after_insert after insert on organizations
  for each row execute function organizations_after_insert();

-- ---------------------------------------------------------------- 6. portal actions (called from the browser)
-- A presenter answers an invitation.
--   * The presenter the organization picked: yes connects them; no sends the request to C4C for matching.
--   * A presenter C4C invited: yes marks them "interested" so the organization can choose; no is recorded.
create or replace function respond_to_request(p_request_id uuid, p_accept boolean) returns request_status
language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  me uuid := auth.uid();
  o organizations%rowtype;
begin
  if me is null then raise exception 'Please sign in first'; end if;
  select * into r from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not exists (select 1 from professionals where id = me and status = 'approved') then
    raise exception 'Only approved presenters can respond to requests';
  end if;

  if r.requested_professional_id = me and r.status = 'awaiting_presenter' then
    if p_accept then
      update requests set matched_professional_id = me, status = 'connected' where id = r.id;
    else
      insert into request_history (request_id, actor_id, what) values (r.id, me, 'The requested presenter was unavailable');
      update requests set status = 'matching' where id = r.id;
    end if;

  elsif r.status = 'matching'
        and exists (select 1 from request_candidates where request_id = r.id and professional_id = me) then
    update request_candidates
       set response = (case when p_accept then 'interested' else 'declined' end)::candidate_response,
           responded_at = now()
     where request_id = r.id and professional_id = me;
    if p_accept then
      select * into o from organizations where id = r.organization_id;
      insert into request_history (request_id, actor_id, what) values (r.id, me, 'A presenter is interested');
      perform enqueue_email('presenter_interested', array[o.lead_email], o.cc_emails, request_payload(r.id), r.id);
      perform enqueue_email('admin_presenter_interested', admin_emails(), null, request_payload(r.id), r.id);
    end if;

  else
    raise exception 'You do not have an open invitation for this request';
  end if;

  return (select status from requests where id = r.id);
end $$;

-- The organization (or an admin) picks one of the presenters who said they are interested.
create or replace function choose_presenter(p_request_id uuid, p_professional_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
begin
  select * into r from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not coalesce(r.organization_id = my_org_id() or is_admin(), false) then
    raise exception 'Only the requesting organization can choose a presenter';
  end if;
  if r.status <> 'matching' then raise exception 'This request is not open for choosing a presenter'; end if;
  if not exists (select 1 from request_candidates
                 where request_id = r.id and professional_id = p_professional_id and response = 'interested') then
    raise exception 'That presenter has not said they are interested';
  end if;
  if not exists (select 1 from professionals where id = p_professional_id and status = 'approved') then
    raise exception 'That presenter is no longer available';
  end if;
  update requests set matched_professional_id = p_professional_id, status = 'connected' where id = r.id;
end $$;

create or replace function cancel_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
begin
  select * into r from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not coalesce(r.organization_id = my_org_id() or is_admin(), false) then
    raise exception 'Only the requesting organization can cancel a request';
  end if;
  if r.status in ('completed', 'cancelled') then raise exception 'This request is already closed'; end if;
  update requests set status = 'cancelled' where id = r.id;
end $$;

-- Either side records the date they agreed on. Calling it again changes the date.
create or replace function schedule_event(p_request_id uuid, p_starts_at timestamptz, p_duration_min int, p_location text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  o organizations%rowtype;
  v_event_id uuid;
  v_pres_email text;
begin
  select * into r from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not coalesce(r.organization_id = my_org_id() or r.matched_professional_id = auth.uid() or is_admin(), false) then
    raise exception 'Only the organization or its presenter can set the date';
  end if;
  if r.matched_professional_id is null or r.status not in ('connected', 'confirmed') then
    raise exception 'Connect with a presenter before setting a date';
  end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'Choose a date in the future'; end if;

  select * into o from organizations where id = r.organization_id;
  insert into events (request_id, organization_id, professional_id, title, starts_at, duration_min, location)
  values (r.id, r.organization_id, r.matched_professional_id, r.event_type || ' · ' || o.name,
          p_starts_at, coalesce(p_duration_min, r.duration_min), coalesce(nullif(trim(p_location), ''), r.location))
  on conflict (request_id) do update
    set starts_at = excluded.starts_at, duration_min = excluded.duration_min,
        location = excluded.location, updated_at = now()
  returning id into v_event_id;

  if r.status = 'connected' then
    update requests set status = 'confirmed' where id = r.id;       -- trigger logs it and emails both sides
  else
    select email into v_pres_email from profiles where id = r.matched_professional_id;
    insert into request_history (request_id, actor_id, what) values (r.id, auth.uid(), 'Date changed');
    perform enqueue_email('event_rescheduled', array[o.lead_email, v_pres_email], o.cc_emails, request_payload(r.id), r.id);
    perform enqueue_email('admin_event_rescheduled', admin_emails(), null, request_payload(r.id), r.id);
  end if;
  return v_event_id;
end $$;

-- After the session, the presenter (or an admin) records turnout and time given.
create or replace function record_event_outcome(p_event_id uuid, p_attendance int, p_hours numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  e events%rowtype;
begin
  select * into e from events where id = p_event_id for update;
  if not found then raise exception 'Session not found'; end if;
  if not coalesce(e.professional_id = auth.uid() or is_admin(), false) then
    raise exception 'Only the presenter can record the outcome';
  end if;
  if e.starts_at > now() then raise exception 'This session has not happened yet'; end if;
  update events set attendance_actual = p_attendance, presenter_hours = p_hours, updated_at = now() where id = e.id;
  update requests set status = 'completed' where id = e.request_id and status = 'confirmed';
end $$;

-- Status lookup without signing in: tracking number plus the lead or a CC email.
create or replace function track_request(p_tracking_id text, p_email text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tracking_id', r.tracking_id, 'org_name', o.name, 'event_type', r.event_type, 'status', r.status,
    'window_start', r.window_start, 'window_end', r.window_end,
    'presenter_name', case when r.status in ('connected', 'confirmed', 'completed') then pr.display_name end,
    'event_starts_at', e.starts_at,
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'what', h.what) order by h.at, h.id)
                         from request_history h where h.request_id = r.id), '[]'::jsonb))
  from requests r
  join organizations o on o.id = r.organization_id
  left join professionals pr on pr.id = r.matched_professional_id
  left join events e on e.request_id = r.id
  where r.tracking_id = upper(trim(p_tracking_id))
    and (lower(o.lead_email) = lower(trim(p_email))
         or lower(trim(p_email)) in (select lower(x) from unnest(o.cc_emails) as x));
$$;

-- Admin: rank approved presenters for a request. Topic fit counts most, then audience,
-- session type, delivery, and whether the window leaves enough notice.
create or replace function suggest_presenters(p_request_id uuid)
returns table (professional_id uuid, display_name text, score int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select p.id, p.display_name,
           (3 * (select count(*) from unnest(r.topics) as t where t = any (p.expertise))
            + 2 * (select count(*) from unnest(r.audiences) as a where a = any (p.audiences))
            + case when r.event_type = any (p.event_types) then 1 else 0 end
            + case when cardinality(p.delivery) = 0 or r.delivery = any (p.delivery) then 1 else 0 end
            - case when (r.window_end - current_date) < coalesce(pp.min_notice_days, 30) then 2 else 0 end)::int
    from requests r
    cross join professionals p
    left join professional_private pp on pp.professional_id = p.id
    where r.id = p_request_id and p.status = 'approved'
    order by 3 desc, 2;
end $$;

-- Admin: invite presenters to consider a request. Returns how many new invitations went out.
create or replace function invite_presenters(p_request_id uuid, p_professional_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  r requests%rowtype;
  c record;
  n int := 0;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('new', 'matching', 'declined') then
    raise exception 'This request is not open for invitations';
  end if;

  for c in
    insert into request_candidates (request_id, professional_id, score)
    select r.id, s.professional_id, s.score
      from suggest_presenters(r.id) as s
     where s.professional_id = any (p_professional_ids)
    on conflict do nothing
    returning professional_id
  loop
    n := n + 1;
    perform enqueue_email('presenter_invited', array[(select email from profiles where id = c.professional_id)],
                          null, request_payload(r.id), r.id);
  end loop;

  if r.status <> 'matching' then
    update requests set status = 'matching' where id = r.id;
  end if;
  if n > 0 then
    insert into request_history (request_id, actor_id, what)
    values (r.id, auth.uid(), 'C4C invited ' || n || case when n = 1 then ' presenter' else ' presenters' end);
  end if;
  return n;
end $$;

-- Everything the signed-in user may see about requests, assembled as JSON.
-- SECURITY INVOKER: row-level security decides what each caller gets.
create or replace function my_requests() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
  from (
    select r.created_at,
           to_jsonb(r) || jsonb_build_object(
             'organization', (select to_jsonb(o) - 'owner_id' from organizations o where o.id = r.organization_id),
             'requested', (select jsonb_build_object('id', p.id, 'display_name', p.display_name)
                           from professionals p where p.id = r.requested_professional_id),
             'matched', (select jsonb_build_object('id', p.id, 'display_name', p.display_name,
                                                   'email', (select pf.email from profiles pf where pf.id = p.id))
                         from professionals p where p.id = r.matched_professional_id),
             'event', (select to_jsonb(e) - 'share_token' - 'feedback_token' from events e where e.request_id = r.id),
             'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'what', h.what) order by h.at, h.id)
                                  from request_history h where h.request_id = r.id), '[]'::jsonb),
             'candidates', coalesce((select jsonb_agg(jsonb_build_object(
                                              'professional_id', c.professional_id, 'display_name', p.display_name,
                                              'score', case when is_admin() then c.score end,
                                              'invited_at', c.invited_at, 'response', c.response)
                                            order by c.score desc, p.display_name)
                                     from request_candidates c
                                     join professionals p on p.id = c.professional_id
                                     where c.request_id = r.id), '[]'::jsonb)
           ) as j
    from requests r
  ) x;
$$;

-- Admin dashboard data in one call.
create or replace function admin_overview() returns jsonb
language plpgsql stable as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'professionals', coalesce((
        select jsonb_agg(to_jsonb(p) || jsonb_build_object('email', pf.email, 'private', to_jsonb(pp) - 'professional_id')
                         order by p.created_at desc)
        from professionals p
        join profiles pf on pf.id = p.id
        left join professional_private pp on pp.professional_id = p.id), '[]'::jsonb),
    'organizations', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from organizations o), '[]'::jsonb),
    'requests', my_requests(),
    'outbox', coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc)
                        from (select * from email_outbox order by id desc limit 200) m), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- 7. row-level security
alter table profiles             enable row level security;
alter table professionals        enable row level security;
alter table professional_private enable row level security;
alter table license_checks       enable row level security;
alter table organizations        enable row level security;
alter table requests             enable row level security;
alter table request_candidates   enable row level security;
alter table request_history      enable row level security;
alter table events               enable row level security;
alter table email_outbox         enable row level security;

-- profiles: yourself, admins, and an organization's matched presenter once connected.
-- Users may change only their name (column grant below); roles are changed in the SQL editor.
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin() or profile_visible_to_me(id));
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- professionals: approved profiles are public; owners and admins see the rest.
create policy professionals_select on professionals for select
  using (status = 'approved' or id = auth.uid() or is_admin() or profile_visible_to_me(id));
create policy professionals_insert on professionals for insert
  with check (id = auth.uid() and my_role() = 'professional');
create policy professionals_update on professionals for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy professionals_admin on professionals for all
  using (is_admin()) with check (is_admin());

create policy private_owner on professional_private for all
  using (professional_id = auth.uid()) with check (professional_id = auth.uid());
create policy private_admin on professional_private for all
  using (is_admin()) with check (is_admin());

create policy license_checks_select on license_checks for select
  using (professional_id = auth.uid() or is_admin());
create policy license_checks_admin on license_checks for all
  using (is_admin()) with check (is_admin());

create policy organizations_select on organizations for select
  using (owner_id = auth.uid() or is_admin() or org_visible_to_me(id));
create policy organizations_insert on organizations for insert
  with check (owner_id = auth.uid() and my_role() = 'organization');
create policy organizations_update on organizations for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy organizations_admin on organizations for all
  using (is_admin()) with check (is_admin());

create policy requests_select on requests for select
  using (organization_id = my_org_id() or is_admin() or is_request_professional(id));
create policy requests_insert on requests for insert
  with check (organization_id = my_org_id());
create policy requests_update on requests for update
  using (organization_id = my_org_id()) with check (organization_id = my_org_id());
create policy requests_admin on requests for all
  using (is_admin()) with check (is_admin());

-- candidates: a presenter sees their own invitation; the organization sees who is interested.
create policy candidates_select on request_candidates for select
  using (professional_id = auth.uid()
         or is_admin()
         or (response = 'interested' and request_org_id(request_id) = my_org_id()));
create policy candidates_admin on request_candidates for all
  using (is_admin()) with check (is_admin());

create policy history_select on request_history for select
  using (is_admin() or request_org_id(request_id) = my_org_id() or is_matched_professional(request_id));

create policy events_select on events for select
  using (organization_id = my_org_id() or professional_id = auth.uid() or is_admin());
create policy events_admin on events for all
  using (is_admin()) with check (is_admin());

create policy outbox_admin on email_outbox for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------- 8. grants
-- Supabase gives the API roles broad default rights on new objects. Take them back and
-- grant only what the portal uses; RLS then narrows it to the right rows.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on professionals to anon;

grant select on profiles, professionals, professional_private, license_checks, organizations,
                requests, request_candidates, request_history, events, email_outbox to authenticated;
grant update (full_name) on profiles to authenticated;
grant insert, update, delete on professionals, organizations, requests to authenticated;
grant insert, update on professional_private to authenticated;
grant insert, update, delete on request_candidates, license_checks to authenticated;   -- admins only, by RLS
grant update, delete on events, email_outbox to authenticated;                         -- admins only, by RLS

grant execute on function is_admin(), my_role(), my_org_id(), is_privileged(), request_org_id(uuid),
                          is_request_professional(uuid), is_matched_professional(uuid),
                          org_visible_to_me(uuid), profile_visible_to_me(uuid)
  to anon, authenticated;
grant execute on function track_request(text, text) to anon, authenticated;
grant execute on function gen_tracking_id(), unlist_me_for_reverification(), my_requests(), admin_overview(),
                          respond_to_request(uuid, boolean), choose_presenter(uuid, uuid), cancel_request(uuid),
                          schedule_event(uuid, timestamptz, int, text), record_event_outcome(uuid, int, numeric),
                          suggest_presenters(uuid), invite_presenters(uuid, uuid[])
  to authenticated;

-- ---------------------------------------------------------------- 9. account creation
-- Runs when someone signs up. The role comes from the sign-up form but can only ever be
-- 'professional' or 'organization'. Admins are promoted by hand in the SQL editor:
--   update profiles set role = 'admin' where email = 'someone@counselorsforchange.org';
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, role, email, full_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'organization' then 'organization'::user_role
         else 'professional'::user_role end,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create or replace function handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function handle_user_email_change();

revoke execute on function handle_new_user(), handle_user_email_change() from public, anon, authenticated;
