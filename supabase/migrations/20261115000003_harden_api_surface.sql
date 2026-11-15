-- =====================================================================
-- Connections 4 Change · tighten what the public API can reach
-- Follows Supabase's security advisor after the first deploy.
--
--   1. Every function pins its search_path (seven did not).
--   2. Signed-out visitors get their own, simpler directory policy, so they no longer
--      need to run any helper function. Their whole reach is now: read approved
--      presenter profiles, and look up a request by tracking number and email.
--
-- The advisor will still list the portal's action functions (accept, choose, cancel,
-- set date, and so on) as callable by signed-in users. That is intended: each one
-- checks who is calling before it does anything, and the tests cover those checks.
-- =====================================================================

alter function is_privileged()             set search_path = public;
alter function professionals_guard()       set search_path = public;
alter function professional_private_guard() set search_path = public;
alter function organizations_guard()       set search_path = public;
alter function requests_guard()            set search_path = public;
alter function my_requests()               set search_path = public;
alter function admin_overview()            set search_path = public;

-- One directory policy per audience.
drop policy professionals_select on professionals;
create policy professionals_public on professionals for select to anon
  using (status = 'approved');
create policy professionals_select on professionals for select to authenticated
  using (status = 'approved' or id = auth.uid() or is_admin() or profile_visible_to_me(id));

-- Every other policy is for signed-in users only. Without this, a policy such as
-- "admins can do anything" is also evaluated for signed-out visitors, who would then
-- need permission to run is_admin().
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname <> 'professionals_public' loop
    execute format('alter policy %I on %I to authenticated', p.policyname, p.tablename);
  end loop;
end $$;

revoke execute on function is_admin(), my_role(), my_org_id(), is_privileged(), request_org_id(uuid),
                           is_request_professional(uuid), is_matched_professional(uuid),
                           org_visible_to_me(uuid), profile_visible_to_me(uuid)
  from anon;
