-- Fingerprint of everything the migrations create: one row per section with a count and a hash.
-- Run it on the live database (SQL editor) and locally (node fingerprint.mjs); if every row
-- matches, the live database is the same one the tests ran against.
with fn as (
  select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
         md5(p.prosrc) || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') as v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
), pol as (
  select tablename::text || '.' || policyname::text as k,
         cmd::text || '|' || array_to_string(roles, ',') || '|' || regexp_replace(coalesce(qual, ''), '\s+', '', 'g')
             || '|' || regexp_replace(coalesce(with_check, ''), '\s+', '', 'g') as v
  from pg_policies where schemaname = 'public'
), col as (
  select table_name::text || '.' || column_name::text as k,
         data_type::text || ':' || is_nullable::text || ':' || coalesce(column_default::text, '') as v
  from information_schema.columns c
  where table_schema = 'public'
    and exists (select 1 from information_schema.tables t
                where t.table_schema = 'public' and t.table_name = c.table_name and t.table_type = 'BASE TABLE')
), tg as (
  select grantee::text || ':' || table_name::text as k, string_agg(privilege_type::text, ',' order by privilege_type) as v
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by 1
), cg as (
  select grantee::text || ':' || table_name::text || '.' || column_name::text as k, string_agg(privilege_type::text, ',' order by privilege_type) as v
  from information_schema.column_privileges
  where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE' and table_name = 'profiles'
  group by 1
), fg as (
  select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
         concat_ws(',', case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
                        case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end) as v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
), trg as (
  select n.nspname::text || '.' || c.relname::text || ':' || t.tgname::text as k,
         p.proname::text || ':' || t.tgtype::text as v
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal and pn.nspname = 'public'
), rls as (
  select c.relname::text as k, c.relrowsecurity::text as v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
), enum as (
  select t.typname::text as k, string_agg(e.enumlabel::text, ',' order by e.enumsortorder) as v
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by 1
)
select section, count(*)::int as items, md5(string_agg(k || '=' || v, ';' order by k)) as hash
from (
  select '1 functions' as section, * from fn union all
  select '2 policies', * from pol union all
  select '3 columns', * from col union all
  select '4 table grants', * from tg union all
  select '5 column grants', * from cg union all
  select '6 function grants', * from fg union all
  select '7 triggers', * from trg union all
  select '8 row security', * from rls union all
  select '9 enums', * from enum
) s
group by section order by section;
