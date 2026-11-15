// Shared test harness: an in-process Postgres (PGlite) with just enough of Supabase stubbed in.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlIn = dir => readdirSync(path.join(here, '..', dir)).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(path.join(here, '..', dir, f), 'utf8'));

// The parts of Supabase the migrations rely on, including its permissive default grants,
// so the tests prove that the migrations' own REVOKEs and policies do the protecting.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createDb({ drafts = false } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const sql of [...sqlIn('migrations'), ...(drafts ? sqlIn('drafts') : [])]) await db.exec(sql);

  const ids = {};                                   // user name -> auth uid
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0];

  // Run fn as a signed-in user (by name) or as an anonymous visitor (null).
  async function as(who, fn) {
    await db.exec(`set role ${who ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${who ? ids[who] : ''}', false);`);
    try { return await fn(); }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  }

  // What Supabase Auth does on sign-up: insert a row into auth.users with the form's metadata.
  async function signUp(name, meta = {}, { email = `${name}@example.test`, confirmed = false } = {}) {
    const u = await one(
      `insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, $2::jsonb, ${confirmed ? 'now()' : 'null'}) returning id`,
      [email, JSON.stringify(meta)]);
    ids[name] = u.id;
    return u.id;
  }
  const confirmEmail = name => db.exec(`update auth.users set email_confirmed_at = now() where id = '${ids[name]}'`);

  return { db, ids, q, one, as, signUp, confirmEmail };
}
