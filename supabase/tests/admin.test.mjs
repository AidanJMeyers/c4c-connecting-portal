// Who becomes a C4C admin, and when. Uses made-up addresses; the real list lives only in the database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers.mjs';

let db, ids, q, one, as, signUp, confirmEmail;
const role = async name => (await one(`select role from profiles where id = $1`, [ids[name]])).role;

before(async () => {
  ({ db, ids, q, one, as, signUp, confirmEmail } = await createDb());
  await db.exec(`insert into admin_allowlist (email) values ('chair@c4c.example'), ('secretary@c4c.example')`);
});

test('a listed address becomes an admin only after confirming the email', async () => {
  await signUp('chair', { role: 'professional', full_name: 'Chair' }, { email: 'chair@c4c.example' });
  assert.equal(await role('chair'), 'professional', 'signing up with the address is not enough');
  await confirmEmail('chair');
  assert.equal(await role('chair'), 'admin');
});

test('matching ignores letter case, and works when the account is created already confirmed', async () => {
  await signUp('secretary', { role: 'organization', full_name: 'Secretary' }, { email: 'Secretary@C4C.Example', confirmed: true });
  assert.equal(await role('secretary'), 'admin');
});

test('unlisted addresses never become admins, confirmed or not', async () => {
  await signUp('stranger', { role: 'admin', full_name: 'Stranger' }, { email: 'stranger@example.test', confirmed: true });
  await signUp('lookalike', {}, { email: 'chair@c4c.example.evil.test', confirmed: true });
  assert.equal(await role('stranger'), 'professional');
  assert.equal(await role('lookalike'), 'professional');
});

test('only admins can see or change the list', async () => {
  await assert.rejects(as(null, () => q(`select * from admin_allowlist`)), /permission denied/);
  assert.equal((await as('stranger', () => q(`select * from admin_allowlist`))).length, 0);
  await assert.rejects(as('stranger', () => q(`insert into admin_allowlist (email) values ('stranger@example.test')`)), /row-level security/);
  assert.equal((await as('chair', () => q(`select * from admin_allowlist`))).length, 2);
});

test('adding a confirmed user to the list promotes them right away', async () => {
  await as('chair', () => q(`insert into admin_allowlist (email) values ('stranger@example.test')`));
  assert.equal(await role('stranger'), 'admin');
  await assert.rejects(as('chair', () => q(`insert into admin_allowlist (email) values ('Mixed@Case.test')`)), /check constraint/);
});

test('the migrations ship with an empty list, so no addresses are published', async () => {
  const fresh = await createDb();
  assert.equal((await fresh.q(`select * from admin_allowlist`)).length, 0);
});
