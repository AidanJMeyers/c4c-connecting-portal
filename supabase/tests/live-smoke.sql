-- Live walkthrough for the real database. Paste into the Supabase SQL editor and run.
-- It signs up a presenter, an organization and an admin, runs a request from start to
-- confirmed date, checks the privacy rules along the way, and then ROLLS EVERYTHING BACK.
-- Success looks like an "error" that starts with:  SMOKE OK (rolled back): ...
-- Any other message names the check that failed. Nothing is left in the database either way.
do $smoke$
declare
  pro_id uuid := gen_random_uuid();
  org_user uuid := gen_random_uuid();
  adm_id uuid := gen_random_uuid();
  v_org uuid; v_req uuid; v_track text; v_status text; v_n int; v_roles text; v_j jsonb; v_denied boolean; v_templates text;
begin
  -- accounts, as Supabase Auth would create them (a temporary allowlist entry stands in for a real admin)
  insert into admin_allowlist (email) values ('smoke-admin@example.test');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
   ('00000000-0000-0000-0000-000000000000', pro_id, 'authenticated', 'authenticated', 'smoke-pro@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"role":"professional","full_name":"Smoke Presenter"}', now(), now()),
   ('00000000-0000-0000-0000-000000000000', org_user, 'authenticated', 'authenticated', 'smoke-org@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"role":"organization","full_name":"Smoke Lead"}', now(), now()),
   ('00000000-0000-0000-0000-000000000000', adm_id, 'authenticated', 'authenticated', 'smoke-admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"role":"admin","full_name":"Smoke Admin"}', now(), now());
  select string_agg(role::text, ',' order by email) into v_roles from profiles where id in (pro_id, org_user, adm_id);
  if v_roles <> 'admin,organization,professional' then raise exception 'FAIL roles: %', v_roles; end if;

  -- presenter creates a profile and tries to approve themselves
  perform set_config('request.jwt.claim.sub', pro_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into professionals (id, display_name, license_type, license_state, bio, expertise, audiences, status)
    values (pro_id, 'Smoke Presenter, LMHC', 'LMHC', 'FL', 'bio', '{Anxiety & Stress}', '{K-12 Students}', 'approved');
  insert into professional_private (professional_id, license_number, ins_carrier, ins_policy_number, ins_limits, ins_expires)
    values (pro_id, 'MH1', 'ACME', 'P1', '1M/3M', current_date + 200);
  select status::text into v_status from professionals where id = pro_id;
  if v_status <> 'pending' then raise exception 'FAIL self-approval gave status %', v_status; end if;
  select count(*) into v_n from email_outbox;
  if v_n <> 0 then raise exception 'FAIL presenter can read % outbox rows', v_n; end if;
  reset role;

  -- signed-out visitor: pending profile is hidden, private table is refused
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into v_n from professionals;
  if v_n <> 0 then raise exception 'FAIL anon sees % pending profiles', v_n; end if;
  begin
    perform 1 from professional_private limit 1; v_denied := false;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL anon could read private details'; end if;
  reset role;

  -- admin approves and can see the private half
  perform set_config('request.jwt.claim.sub', adm_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update professionals set status = 'approved' where id = pro_id;
  v_j := admin_overview();
  if v_j -> 'professionals' -> 0 -> 'private' ->> 'license_number' <> 'MH1' then raise exception 'FAIL admin overview'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into v_n from professionals;
  if v_n <> 1 then raise exception 'FAIL anon sees % approved profiles', v_n; end if;
  reset role;

  -- organization signs up, requests that presenter, and cannot set its own status
  perform set_config('request.jwt.claim.sub', org_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', org_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into organizations (owner_id, name, org_type, lead_name, lead_email, cc_emails, prior_contact)
    values (org_user, 'Smoke School', 'School (K-12)', 'Smoke Lead', 'smoke-org@example.test', '{cc@example.test}', false) returning id into v_org;
  insert into requests (organization_id, requested_professional_id, event_type, topics, audiences, window_start, window_end, description, status, tracking_id)
    values (v_org, pro_id, 'Workshop', '{Anxiety & Stress}', '{K-12 Students}', current_date + 60, current_date + 90, 'smoke', 'confirmed', 'HACK')
    returning id, tracking_id, status::text into v_req, v_track, v_status;
  if v_status <> 'awaiting_presenter' or v_track !~ '^C4C-[A-HJKMNP-Z2-9]{6}$' then raise exception 'FAIL request insert: % %', v_status, v_track; end if;
  begin
    update requests set status = 'confirmed' where id = v_req; v_denied := false;
  exception when raise_exception then v_denied := true;
  end;
  if not v_denied then raise exception 'FAIL organization changed its own status'; end if;
  select count(*) into v_n from profiles where id = pro_id;
  if v_n <> 0 then raise exception 'FAIL organization sees presenter email before connecting'; end if;
  reset role;

  -- presenter accepts
  perform set_config('request.jwt.claim.sub', pro_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select respond_to_request(v_req, true)::text into v_status;
  if v_status <> 'connected' then raise exception 'FAIL accept gave %', v_status; end if;
  reset role;

  -- organization sets the date and now sees its presenter's email
  perform set_config('request.jwt.claim.sub', org_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', org_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform schedule_event(v_req, now() + interval '40 days', 60, 'Gym');
  v_j := my_requests();
  if v_j -> 0 ->> 'status' <> 'confirmed' or v_j -> 0 -> 'matched' ->> 'email' <> 'smoke-pro@example.test' or v_j -> 0 -> 'event' ->> 'location' <> 'Gym'
    then raise exception 'FAIL my_requests: %', v_j -> 0; end if;
  reset role;

  -- signed-out status lookup by a CC contact
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  if track_request(lower(v_track), 'CC@example.test') ->> 'status' <> 'confirmed' then raise exception 'FAIL tracking lookup'; end if;
  reset role;

  select count(*), string_agg(distinct template, ', ' order by template) into v_n, v_templates from email_outbox;
  raise exception 'SMOKE OK (rolled back): roles=%, tracking=%, % emails queued [%]', v_roles, v_track, v_n, v_templates;
end
$smoke$;
