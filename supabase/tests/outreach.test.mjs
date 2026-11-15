// Outreach campaigns: who can use them, and the rules every send must follow.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers.mjs';

let db, ids, q, one, as, signUp;
const ref = {};
const ROWS = JSON.stringify([
  { email: 'Dana@Practice.example', full_name: 'Dana Cole, LMFT', organization: 'Cole Counseling', city_state: 'Melbourne, FL' },
  { email: 'lee@practice.example', full_name: 'Lee Park, LCSW' },
  { email: 'member@example.test', full_name: 'Already A Member' },
  { email: 'not-an-email', full_name: 'Typo' },
  { email: 'dana@practice.example', full_name: 'Duplicate Dana' }
]);

before(async () => {
  ({ db, ids, q, one, as, signUp } = await createDb());
  await signUp('admin', { full_name: 'Ada Admin' });
  await db.exec(`update profiles set role = 'admin' where id = '${ids.admin}'`);
  await signUp('member', { role: 'professional', full_name: 'Already A Member' }, { email: 'member@example.test' });
  await signUp('org', { role: 'organization', full_name: 'Org Lead' });
});

test('only admins can see or use outreach', async () => {
  for (const t of ['outreach_contacts', 'outreach_campaigns', 'outreach_messages', 'app_settings']) {
    await assert.rejects(as(null, () => q(`select * from ${t}`)), /permission denied/, `anon read of ${t}`);
    assert.equal((await as('member', () => q(`select * from ${t}`))).length, 0, `member read of ${t}`);
  }
  await assert.rejects(as('member', () => q(`select import_outreach_contacts('[]'::jsonb, 'professional', 'x')`)), /Admins only/);
  await assert.rejects(as('org', () => q(`select outreach_overview()`)), /Admins only/);
  await assert.rejects(as('member', () => q(`insert into outreach_contacts (email, source) values ('a@b.co', 'x')`)), /row-level security/);
  await assert.rejects(as(null, () => q(`select outreach_overview()`)), /permission denied/);
});

test('importing records where contacts came from and sorts out duplicates, typos and members', async () => {
  await assert.rejects(as('admin', () => q(`select import_outreach_contacts($1::jsonb, 'professional', '  ')`, [ROWS])), /where these contacts came from/);
  const r = (await as('admin', () => one(`select import_outreach_contacts($1::jsonb, 'professional', 'Florida DOH public license list') as j`, [ROWS]))).j;
  assert.deepEqual(r, { added: 2, already_listed: 1, already_members: 1, invalid: 1 });
  const rows = await q(`select email, status, source, added_by from outreach_contacts order by email`);
  assert.deepEqual(rows.map(c => [c.email, c.status]), [['dana@practice.example', 'active'], ['lee@practice.example', 'active'], ['member@example.test', 'joined']]);
  assert.ok(rows.every(c => c.source === 'Florida DOH public license list' && c.added_by === ids.admin));
  const again = (await as('admin', () => one(`select import_outreach_contacts($1::jsonb, 'professional', 'second pass') as j`, [ROWS]))).j;
  assert.deepEqual(again, { added: 0, already_listed: 4, already_members: 0, invalid: 1 });
});

test('a campaign cannot go out without the C4C mailing address', async () => {
  ref.campaign = (await as('admin', () => one(`
    insert into outreach_campaigns (name, subject, heading, body, button_label, created_by)
    values ('Fall presenter invitation', 'An invitation from Counselors for Change', 'Share your expertise', E'First paragraph.\\n\\nSecond paragraph.', 'Create my profile', '${ids.admin}')
    returning id`))).id;
  await assert.rejects(as('admin', () => q(`select queue_outreach_campaign('${ref.campaign}', true)`)), /mailing address/);
  await assert.rejects(as('admin', () => q(`select queue_outreach_campaign('${ref.campaign}')`)), /mailing address/);
  await as('admin', () => q(`update app_settings set value = '123 Example St, Melbourne, FL 32901' where key = 'mailing_address'`));
});

test('a test send goes only to the admin who asked for it', async () => {
  assert.equal((await as('admin', () => one(`select queue_outreach_campaign('${ref.campaign}', true) as n`))).n, 1);
  const mail = await q(`select * from email_outbox where template = 'outreach_campaign'`);
  assert.equal(mail.length, 1);
  assert.deepEqual(mail[0].to_emails, ['admin@example.test']);
  assert.equal(mail[0].payload.subject, '[Test] An invitation from Counselors for Change');
  assert.equal((await one(`select status from outreach_campaigns where id = $1`, [ref.campaign])).status, 'draft');
  assert.equal((await q(`select 1 from outreach_messages`)).length, 0);
});

test('unsubscribing works from the email link without signing in, and sticks', async () => {
  const token = (await one(`select unsubscribe_token from outreach_contacts where email = 'lee@practice.example'`)).unsubscribe_token;
  assert.equal((await as(null, () => one(`select unsubscribe_outreach('nope') as ok`))).ok, false);
  assert.equal((await as(null, () => one(`select unsubscribe_outreach('') as ok`))).ok, false);
  assert.equal((await as(null, () => one(`select unsubscribe_outreach($1) as ok`, [token]))).ok, true);
  assert.equal((await as(null, () => one(`select unsubscribe_outreach($1) as ok`, [token]))).ok, true, 'clicking twice is fine');
  assert.equal((await one(`select status from outreach_contacts where email = 'lee@practice.example'`)).status, 'unsubscribed');
});

test('queueing reaches only eligible contacts, once, with an unsubscribe link and the address', async () => {
  await assert.rejects(as('member', () => q(`select queue_outreach_campaign('${ref.campaign}')`)), /Admins only/);
  assert.equal((await as('admin', () => one(`select queue_outreach_campaign('${ref.campaign}') as n`))).n, 1);
  const mail = await q(`select * from email_outbox where template = 'outreach_campaign' and not payload ->> 'subject' like '[Test]%'`);
  assert.deepEqual(mail.map(m => m.to_emails[0]), ['dana@practice.example'], 'not the unsubscribed contact, not the existing member');
  const p = mail[0].payload;
  assert.equal(p.mailing_address, '123 Example St, Melbourne, FL 32901');
  assert.equal(p.source, 'Florida DOH public license list');
  assert.match(p.unsubscribe_token, /^[0-9a-f]{32}$/);
  assert.equal(p.contact_name, 'Dana Cole, LMFT');

  await assert.rejects(as('admin', () => q(`select queue_outreach_campaign('${ref.campaign}')`)), /already been queued/);
  await assert.rejects(as('admin', () => q(`update outreach_campaigns set body = 'changed after sending' where id = '${ref.campaign}'`)), /can no longer change/);
  assert.equal((await q(`select 1 from outreach_messages where campaign_id = $1`, [ref.campaign])).length, 1);
});

test('someone who joins after being imported is skipped next time', async () => {
  await as('admin', () => q(`select import_outreach_contacts('[{"email":"newbie@example.test"},{"email":"other@example.test"}]'::jsonb, 'professional', 'referral')`));
  await signUp('newbie', { role: 'professional', full_name: 'Newbie' }, { email: 'newbie@example.test' });
  const c2 = (await as('admin', () => one(`insert into outreach_campaigns (name, subject, heading, body) values ('Second', 'Second invitation', 'Hello again', 'Body') returning id`))).id;
  assert.equal((await as('admin', () => one(`select queue_outreach_campaign('${c2}') as n`))).n, 2);     // dana and other
  assert.equal((await one(`select status from outreach_contacts where email = 'newbie@example.test'`)).status, 'joined');
});

test('the overview gives admins contacts, campaigns and counts, without unsubscribe tokens', async () => {
  const o = (await as('admin', () => one(`select outreach_overview() as j`))).j;
  assert.equal(o.settings.mailing_address, '123 Example St, Melbourne, FL 32901');
  assert.equal(o.contacts.length, 5);
  assert.ok(o.contacts.every(c => !('unsubscribe_token' in c)));
  const first = o.campaigns.find(c => c.name === 'Fall presenter invitation');
  assert.deepEqual([first.status, first.recipients, first.sent, first.eligible], ['queued', 1, 0, 1]);   // "other" joined the list later
});
