-- =====================================================================
-- Connections 4 Change · admin allowlist
-- People on this list become C4C admins automatically, but only once they have
-- confirmed that they control the mailbox. Signing up with a listed address is not
-- enough; clicking the confirmation link sent to it is.
--
-- To add an admin later (SQL editor):
--   insert into admin_allowlist (email) values ('someone@counselorsforchange.org');
-- To remove one:
--   delete from admin_allowlist where email = '...';
--   update profiles set role = 'professional' where email = '...';
-- =====================================================================

create table admin_allowlist (
  email    text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

alter table admin_allowlist enable row level security;
create policy allowlist_admin on admin_allowlist for all using (is_admin()) with check (is_admin());
revoke all on admin_allowlist from anon, authenticated;
grant select, insert, delete on admin_allowlist to authenticated;      -- admins only, by RLS

-- The list itself is data, not structure. It is kept in the database only and never written
-- into this public repository. Add or remove addresses in the Supabase SQL editor (see above).

-- Promote on confirmation. Fires when a new user is created already confirmed, and when
-- an existing user's email_confirmed_at is first set.
create or replace function promote_allowlisted_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from admin_allowlist where email = lower(new.email)) then
    update profiles set role = 'admin' where id = new.id and role <> 'admin';
  end if;
  return new;
end $$;

-- Named so it sorts after on_auth_user_created: the profile row must exist first.
create trigger on_auth_user_promote_admin after insert on auth.users
  for each row execute function promote_allowlisted_admin();

create trigger on_auth_user_confirmed_promote_admin after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function promote_allowlisted_admin();

-- Adding someone who already has a confirmed account promotes them right away.
create or replace function promote_on_allowlist_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles p set role = 'admin'
    from auth.users u
   where u.id = p.id and lower(u.email) = new.email and u.email_confirmed_at is not null and p.role <> 'admin';
  return new;
end $$;

create trigger admin_allowlist_promote after insert on admin_allowlist
  for each row execute function promote_on_allowlist_insert();

revoke execute on function promote_allowlisted_admin(), promote_on_allowlist_insert() from public, anon, authenticated;
