-- =====================================================================
-- Connections 4 Change · outreach campaigns (scaffold)
-- Lets C4C admins keep a contact list, draft an invitation email, send themselves a
-- test, and queue it to the list. Delivery is done by the same mail sender as every
-- other email, so nothing goes out until sending is switched on.
--
-- Built-in rules
--   * Every contact records where the address came from (source).
--   * Every outreach email carries an unsubscribe link and C4C's mailing address;
--     a campaign cannot be queued until the mailing address is filled in.
--   * Unsubscribed and bounced contacts are never emailed again, people who already
--     have an account are skipped, and nobody gets the same campaign twice.
-- =====================================================================

create type outreach_audience        as enum ('professional', 'organization');
create type outreach_contact_status  as enum ('active', 'unsubscribed', 'bounced', 'joined');
create type outreach_campaign_status as enum ('draft', 'queued', 'cancelled');

-- Small key/value settings that admins can edit.
create table app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
insert into app_settings (key) values ('mailing_address');

create table outreach_contacts (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  full_name         text,
  audience          outreach_audience not null default 'professional',
  organization      text,                       -- practice, school or organization name
  city_state        text,
  source            text not null check (char_length(trim(source)) > 0),   -- where this address came from
  status            outreach_contact_status not null default 'active',
  unsubscribe_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now(),
  added_by          uuid references profiles (id) on delete set null
);

create table outreach_campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  audience     outreach_audience not null default 'professional',
  subject      text not null check (char_length(subject) between 5 and 120),
  heading      text not null,
  body         text not null,                   -- plain text; blank lines separate paragraphs
  button_label text not null default 'Learn more',
  button_path  text not null default '#presenters' check (button_path ~ '^#[a-z]+$'),
  status       outreach_campaign_status not null default 'draft',
  created_by   uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  queued_at    timestamptz
);

-- One row per contact per campaign: the reason nobody is emailed the same campaign twice.
create table outreach_messages (
  campaign_id uuid not null references outreach_campaigns (id) on delete cascade,
  contact_id  uuid not null references outreach_contacts (id) on delete cascade,
  outbox_id   bigint references email_outbox (id) on delete set null,
  queued_at   timestamptz not null default now(),
  primary key (campaign_id, contact_id)
);

create index on outreach_contacts (audience, status);

-- ---------------------------------------------------------------- functions
-- Like enqueue_email, but returns the outbox row id.
create or replace function enqueue_email_id(p_template text, p_to text[], p_cc text[], p_payload jsonb, p_request_id uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  insert into email_outbox (template, to_emails, cc_emails, payload, request_id)
  values (p_template, p_to, coalesce(p_cc, '{}'), coalesce(p_payload, '{}'), p_request_id)
  returning id into v_id;
  return v_id;
end $$;

-- Admin: add contacts from a pasted list. p_rows is a JSON array of
-- {email, full_name, organization, city_state}. Returns what happened to each row.
create or replace function import_outreach_contacts(p_rows jsonb, p_audience outreach_audience, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_email text;
  n_added int := 0; n_existing int := 0; n_invalid int := 0; n_members int := 0;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if coalesce(trim(p_source), '') = '' then raise exception 'Say where these contacts came from'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_email := lower(trim(coalesce(r ->> 'email', '')));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      n_invalid := n_invalid + 1;
    elsif exists (select 1 from outreach_contacts where email = v_email) then
      n_existing := n_existing + 1;
    else
      insert into outreach_contacts (email, full_name, audience, organization, city_state, source, status, added_by)
      values (v_email, nullif(trim(r ->> 'full_name'), ''), p_audience, nullif(trim(r ->> 'organization'), ''),
              nullif(trim(r ->> 'city_state'), ''), trim(p_source),
              case when exists (select 1 from profiles where lower(email) = v_email) then 'joined' else 'active' end::outreach_contact_status,
              auth.uid());
      if exists (select 1 from profiles where lower(email) = v_email) then n_members := n_members + 1; else n_added := n_added + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('added', n_added, 'already_listed', n_existing, 'already_members', n_members, 'invalid', n_invalid);
end $$;

-- The unsubscribe link in every outreach email lands here. No sign-in needed; the token is the key.
create or replace function unsubscribe_outreach(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_found boolean;
begin
  update outreach_contacts set status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token and length(coalesce(p_token, '')) >= 32;
  v_found := found;
  return v_found;
end $$;

-- Admin: send a test to yourself (p_test_only), or queue the campaign to everyone eligible.
-- Returns how many emails were queued.
create or replace function queue_outreach_campaign(p_campaign_id uuid, p_test_only boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  c outreach_campaigns%rowtype;
  k record;
  v_address text;
  v_me text;
  v_outbox bigint;
  n int := 0;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into c from outreach_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  select trim(value) into v_address from app_settings where key = 'mailing_address';
  if coalesce(v_address, '') = '' then
    raise exception 'Add the C4C mailing address first. Outreach emails must show it.';
  end if;

  if p_test_only then
    select email into v_me from profiles where id = auth.uid();
    perform enqueue_email_id('outreach_campaign', array[v_me], null, jsonb_build_object(
      'campaign_name', c.name, 'subject', '[Test] ' || c.subject, 'heading', c.heading, 'body', c.body,
      'button_label', c.button_label, 'button_path', c.button_path, 'contact_name', null,
      'source', 'this is a test sent to you', 'mailing_address', v_address, 'unsubscribe_token', null));
    return 1;
  end if;

  if c.status <> 'draft' then raise exception 'This campaign has already been queued or cancelled'; end if;

  -- Anyone who has since created an account is no longer a prospect.
  update outreach_contacts oc set status = 'joined'
   where oc.status = 'active' and exists (select 1 from profiles p where lower(p.email) = oc.email);

  for k in
    select oc.* from outreach_contacts oc
     where oc.audience = c.audience and oc.status = 'active'
       and not exists (select 1 from outreach_messages m where m.campaign_id = c.id and m.contact_id = oc.id)
     order by oc.created_at
  loop
    v_outbox := enqueue_email_id('outreach_campaign', array[k.email], null, jsonb_build_object(
      'campaign_name', c.name, 'subject', c.subject, 'heading', c.heading, 'body', c.body,
      'button_label', c.button_label, 'button_path', c.button_path, 'contact_name', k.full_name,
      'source', k.source, 'mailing_address', v_address, 'unsubscribe_token', k.unsubscribe_token));
    insert into outreach_messages (campaign_id, contact_id, outbox_id) values (c.id, k.id, v_outbox);
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'No eligible contacts for this campaign'; end if;
  update outreach_campaigns set status = 'queued', queued_at = now() where id = c.id;
  return n;
end $$;

-- Admin: everything the Outreach tab shows, in one call.
create or replace function outreach_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from app_settings),
    'contacts', coalesce((select jsonb_agg(to_jsonb(oc) - 'unsubscribe_token' - 'added_by' order by oc.created_at desc) from outreach_contacts oc), '[]'::jsonb),
    'campaigns', coalesce((
        select jsonb_agg(to_jsonb(c) - 'created_by' || jsonb_build_object(
                 'recipients', (select count(*) from outreach_messages m where m.campaign_id = c.id),
                 'sent', (select count(*) from outreach_messages m join email_outbox o on o.id = m.outbox_id where m.campaign_id = c.id and o.status = 'sent'),
                 'failed', (select count(*) from outreach_messages m join email_outbox o on o.id = m.outbox_id where m.campaign_id = c.id and o.status = 'failed'),
                 'eligible', (select count(*) from outreach_contacts oc where oc.audience = c.audience and oc.status = 'active'
                              and not exists (select 1 from outreach_messages m where m.campaign_id = c.id and m.contact_id = oc.id)))
               order by c.created_at desc)
        from outreach_campaigns c), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- access
alter table app_settings       enable row level security;
alter table outreach_contacts  enable row level security;
alter table outreach_campaigns enable row level security;
alter table outreach_messages  enable row level security;

create policy settings_admin  on app_settings       for all to authenticated using (is_admin()) with check (is_admin());
create policy contacts_admin  on outreach_contacts  for all to authenticated using (is_admin()) with check (is_admin());
create policy campaigns_admin on outreach_campaigns for all to authenticated using (is_admin()) with check (is_admin());
create policy messages_admin  on outreach_messages  for select to authenticated using (is_admin());

-- Once queued, a campaign's wording is frozen (it has already gone to people). This holds
-- for admins using the portal too; only the SQL editor can override it.
create or replace function outreach_campaigns_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and old.status <> 'draft'
     and (new.subject, new.heading, new.body, new.button_label, new.button_path, new.audience)
         is distinct from (old.subject, old.heading, old.body, old.button_label, old.button_path, old.audience) then
    raise exception 'This campaign has already been queued, so its wording can no longer change';
  end if;
  return new;
end $$;

create trigger outreach_campaigns_guard before update on outreach_campaigns
  for each row execute function outreach_campaigns_guard();

revoke all on app_settings, outreach_contacts, outreach_campaigns, outreach_messages from anon, authenticated;
revoke execute on function enqueue_email_id(text, text[], text[], jsonb, uuid), import_outreach_contacts(jsonb, outreach_audience, text),
                           unsubscribe_outreach(text), queue_outreach_campaign(uuid, boolean), outreach_overview(),
                           outreach_campaigns_guard()
  from public, anon, authenticated;

grant select, insert, update on app_settings to authenticated;                          -- admins only, by RLS
grant select, insert, update, delete on outreach_contacts, outreach_campaigns to authenticated;
grant select on outreach_messages to authenticated;
grant execute on function import_outreach_contacts(jsonb, outreach_audience, text), queue_outreach_campaign(uuid, boolean),
                          outreach_overview() to authenticated;
grant execute on function unsubscribe_outreach(text) to anon, authenticated;
