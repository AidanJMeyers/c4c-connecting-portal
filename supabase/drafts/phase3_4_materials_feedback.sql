-- =====================================================================
-- Connections 4 Change · Phase 3–4 DRAFT (not deployed)
-- Resource bank, event materials, attendee feedback, post-event surveys, news, impact views.
-- Loads on top of the core migration (see supabase/tests/drafts.test.mjs). Move this file
-- into supabase/migrations when the screens that use it are built.
-- File uploads also need two Storage buckets, created in the Supabase dashboard:
--   headshots (public read) and materials (private, read through signed links).
-- =====================================================================

create type material_kind as enum ('slides', 'handout', 'template', 'branding', 'other');

create table materials (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references profiles (id) on delete set null,
  title           text not null,
  kind            material_kind not null,
  topics          text[] not null default '{}',
  storage_path    text not null,               -- path in the private "materials" bucket
  is_c4c_official boolean not null default false,   -- template deck, branding guide, curated C4C workshops
  in_shared_bank  boolean not null default false,   -- owner agreed to share with other presenters
  created_at      timestamptz not null default now()
);

create table event_materials (
  event_id    uuid not null references events (id) on delete cascade,
  material_id uuid not null references materials (id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (event_id, material_id)
);

-- Anonymous attendee responses, submitted through the event's QR code.
create table attendee_feedback (
  id               bigint generated always as identity primary key,
  event_id         uuid not null references events (id) on delete cascade,
  submitted_at     timestamptz not null default now(),
  attendee_role    text,
  knowledge_before smallint check (knowledge_before between 1 and 5),
  knowledge_after  smallint check (knowledge_after between 1 and 5),
  would_recommend  smallint check (would_recommend between 1 and 5),
  most_useful      text check (char_length(most_useful) <= 2000),
  next_topic       text check (char_length(next_topic) <= 500)
);

-- Post-event surveys: the organization about the session, the presenter about the organization.
create table event_surveys (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references events (id) on delete cascade,
  respondent_id uuid not null references profiles (id) on delete cascade,
  answers       jsonb not null,
  submitted_at  timestamptz not null default now(),
  unique (event_id, respondent_id)
);

create table news_posts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  published_at timestamptz,
  author_id    uuid references profiles (id) on delete set null
);

-- ---------------------------------------------------------------- helpers
create or replace function is_event_party(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = p_event_id
                 and (e.professional_id = auth.uid() or e.organization_id = my_org_id()));
$$;

create or replace function is_event_presenter(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = p_event_id and e.professional_id = auth.uid());
$$;

-- A material is shared with me when it is attached to an event I am part of.
create or replace function material_shared_with_me(p_material_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_materials em join events e on e.id = em.event_id
                 where em.material_id = p_material_id
                   and (e.professional_id = auth.uid() or e.organization_id = my_org_id()));
$$;

-- May I attach this material to my event? Mine, or anything in the shared bank.
create or replace function material_usable_by_me(p_material_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from materials m where m.id = p_material_id
                 and (m.owner_id = auth.uid() or m.in_shared_bank or m.is_c4c_official));
$$;

create or replace function materials_guard() returns trigger
language plpgsql as $$
begin
  if is_privileged() then return new; end if;
  if tg_op = 'INSERT' then
    new.is_c4c_official := false;
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.is_c4c_official := old.is_c4c_official;
  end if;
  return new;
end $$;

create trigger materials_guard before insert or update on materials
  for each row execute function materials_guard();

-- The QR code form posts here. No sign-in; the event's feedback token is the key.
create or replace function submit_attendee_feedback(p_token text, p_role text, p_before int, p_after int,
                                                    p_recommend int, p_most_useful text, p_next_topic text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid;
begin
  select id into v_event_id from events where feedback_token = p_token;
  if v_event_id is null then raise exception 'This feedback link is not valid'; end if;
  insert into attendee_feedback (event_id, attendee_role, knowledge_before, knowledge_after, would_recommend, most_useful, next_topic)
  values (v_event_id, nullif(trim(p_role), ''), p_before, p_after, p_recommend,
          nullif(trim(p_most_useful), ''), nullif(trim(p_next_topic), ''));
end $$;

-- ---------------------------------------------------------------- row-level security
alter table materials         enable row level security;
alter table event_materials   enable row level security;
alter table attendee_feedback enable row level security;
alter table event_surveys     enable row level security;
alter table news_posts        enable row level security;

create policy materials_select on materials for select
  using (owner_id = auth.uid() or is_admin()
         or ((in_shared_bank or is_c4c_official) and my_role() in ('professional', 'admin'))
         or material_shared_with_me(id));
create policy materials_insert on materials for insert
  with check (owner_id = auth.uid() and my_role() in ('professional', 'admin'));
create policy materials_update on materials for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy materials_delete on materials for delete
  using (owner_id = auth.uid());
create policy materials_admin on materials for all
  using (is_admin()) with check (is_admin());

create policy event_materials_select on event_materials for select
  using (is_admin() or is_event_party(event_id));
create policy event_materials_insert on event_materials for insert
  with check (is_event_presenter(event_id) and material_usable_by_me(material_id));
create policy event_materials_delete on event_materials for delete
  using (is_event_presenter(event_id));
create policy event_materials_admin on event_materials for all
  using (is_admin()) with check (is_admin());

create policy feedback_select on attendee_feedback for select
  using (is_admin() or is_event_party(event_id));

-- Each side writes its own survey and does not see the other's. Admins read both.
create policy surveys_own on event_surveys for all
  using (respondent_id = auth.uid())
  with check (respondent_id = auth.uid() and is_event_party(event_id));
create policy surveys_admin on event_surveys for select
  using (is_admin());

create policy news_public on news_posts for select to anon
  using (published_at is not null and published_at <= now());
create policy news_select on news_posts for select to authenticated
  using ((published_at is not null and published_at <= now()) or is_admin());
create policy news_admin on news_posts for all
  using (is_admin()) with check (is_admin());

-- As in the core schema: every policy except the public news one is for signed-in users.
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname not in ('professionals_public', 'news_public') loop
    execute format('alter policy %I on %I to authenticated', p.policyname, p.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------- impact reporting
create or replace view impact_by_year with (security_invoker = true) as
select date_part('year', e.starts_at)::int   as year,
       count(*)::int                          as sessions,
       coalesce(sum(e.attendance_actual), 0)::int as people_reached,
       coalesce(sum(e.presenter_hours), 0)    as presenter_hours,
       count(distinct e.organization_id)::int as organizations_served,
       count(distinct e.professional_id)::int as presenters_active
from events e
where e.starts_at < now()
group by 1;

create or replace view top_contributors with (security_invoker = true) as
select p.id, p.display_name,
       count(e.id)::int                           as sessions,
       coalesce(sum(e.attendance_actual), 0)::int as people_reached,
       coalesce(sum(e.presenter_hours), 0)        as hours
from professionals p
join events e on e.professional_id = p.id and e.starts_at < now()
group by p.id, p.display_name;

-- ---------------------------------------------------------------- grants
revoke all on materials, event_materials, attendee_feedback, event_surveys, news_posts, impact_by_year, top_contributors
  from anon, authenticated;
revoke execute on function is_event_party(uuid), is_event_presenter(uuid), material_shared_with_me(uuid),
                           material_usable_by_me(uuid), materials_guard(),
                           submit_attendee_feedback(text, text, int, int, int, text, text)
  from public, anon, authenticated;

grant select on news_posts to anon;
grant select on materials, event_materials, attendee_feedback, event_surveys, news_posts,
                impact_by_year, top_contributors to authenticated;
grant insert, update, delete on materials, event_materials, event_surveys, news_posts to authenticated;
grant execute on function is_event_party(uuid), is_event_presenter(uuid), material_shared_with_me(uuid),
                          material_usable_by_me(uuid) to authenticated;
grant execute on function submit_attendee_feedback(text, text, int, int, int, text, text) to anon, authenticated;
