// Runs every migration on an in-process Postgres (PGlite) and checks who can see and do what.
// Usage: npm install && npm test   (inside supabase/tests)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers.mjs';

let db, ids, q, one, as, signUp;
const ref = {};      // ids captured along the way

const insertPro = (name, extraCols = '', extraVals = '') => q(`
  insert into professionals (id, display_name, city_state, license_type, license_state, bio, expertise, audiences, event_types, delivery ${extraCols})
  values ('${ids[name]}', '${name}', 'Melbourne, FL', 'LMHC', 'FL', 'bio', '{Anxiety & Stress,Grief & Loss}', '{K-12 Students}', '{Workshop}', '{In-person}' ${extraVals})
  returning *`);
const insertPriv = name => q(`
  insert into professional_private (professional_id, license_number, ins_carrier, ins_policy_number, ins_limits, ins_expires)
  values ('${ids[name]}', 'MH-${name}', 'ACME', 'POL-1', '1M / 3M', '2027-12-31') returning *`);
const insertRequest = (orgId, extraCols = '', extraVals = '') => one(`
  insert into requests (organization_id, event_type, topics, audiences, window_start, window_end, description ${extraCols})
  values ('${orgId}', 'Workshop', '{Anxiety & Stress}', '{K-12 Students}', current_date + 60, current_date + 90, 'Parent night' ${extraVals})
  returning *`);
const outbox = template => q(`select * from email_outbox where template = $1 order by id`, [template]);

before(async () => {
  ({ db, ids, q, one, as, signUp } = await createDb());
  await signUp('admin', { role: 'professional', full_name: 'Ada Admin' });
  await db.exec(`update profiles set role = 'admin' where id = '${ids.admin}'`);
  for (const p of ['p1', 'p2', 'p3']) await signUp(p, { role: 'professional', full_name: p });
  for (const o of ['o1', 'o2']) await signUp(o, { role: 'organization', full_name: o });
});

test('sign-up creates a profile, and nobody can sign up as an admin', async () => {
  await signUp('sneaky', { role: 'admin', full_name: 'Sneaky' });
  assert.equal((await one(`select role from profiles where id = $1`, [ids.sneaky])).role, 'professional');
  assert.equal((await one(`select role from profiles where id = $1`, [ids.o1])).role, 'organization');
  await signUp('noname', {});
  assert.equal((await one(`select full_name from profiles where id = $1`, [ids.noname])).full_name, 'noname');
});

test('a presenter creates their own profile but cannot approve themselves', async () => {
  const [row] = await as('p1', () => insertPro('p1', ', status, approved_at', `, 'approved', now()`));
  assert.equal(row.status, 'pending');
  assert.equal(row.approved_at, null);
  await as('p1', () => insertPriv('p1'));
  for (const p of ['p2', 'p3']) { await as(p, () => insertPro(p)); await as(p, () => insertPriv(p)); }

  await as('p1', () => q(`update professionals set status = 'approved' where id = '${ids.p1}'`));
  assert.equal((await one(`select status from professionals where id = $1`, [ids.p1])).status, 'pending');

  // cannot create a profile for someone else, and organizations cannot create presenter profiles
  await assert.rejects(as('sneaky', () => q(`insert into professionals (id, display_name, license_type, license_state, bio) values ('${ids.noname}', 'x', 'LPC', 'FL', 'b')`)), /row-level security/);
  await assert.rejects(as('o1', () => insertPro('o1')), /row-level security/);
  // a presenter cannot delete rows either (only admins can remove profiles)
  await as('p1', () => q(`delete from professionals where id = '${ids.p1}'`));
  assert.ok(await one(`select 1 as ok from professionals where id = $1`, [ids.p1]));

  assert.equal((await outbox('application_received')).length, 3);
  assert.deepEqual((await outbox('admin_new_presenter'))[0].to_emails, ['admin@example.test']);
});

test('an admin approves a profile, and the presenter is told', async () => {
  await as('admin', () => q(`update professionals set status = 'approved' where id in ('${ids.p1}', '${ids.p3}')`));
  const p1 = await one(`select status, approved_at from professionals where id = $1`, [ids.p1]);
  assert.equal(p1.status, 'approved');
  assert.ok(p1.approved_at);
  assert.deepEqual((await outbox('profile_approved')).map(m => m.to_emails[0]).sort(), ['p1@example.test', 'p3@example.test']);
});

test('anonymous visitors see approved public profiles and nothing else', async () => {
  const names = (await as(null, () => q(`select display_name from professionals order by 1`))).map(r => r.display_name);
  assert.deepEqual(names, ['p1', 'p3']);
  for (const t of ['professional_private', 'profiles', 'organizations', 'requests', 'request_candidates', 'request_history', 'events', 'email_outbox', 'license_checks']) {
    await assert.rejects(as(null, () => q(`select * from ${t}`)), /permission denied/, `anon read of ${t}`);
  }
  await assert.rejects(as(null, () => q(`insert into professionals (id, display_name, license_type, license_state, bio) values (gen_random_uuid(), 'x', 'LPC', 'FL', 'b')`)), /permission denied/);
  await assert.rejects(as(null, () => q(`select my_requests()`)), /permission denied/);
  await assert.rejects(as(null, () => q(`select admin_overview()`)), /permission denied/);
});

test('license and insurance details are visible only to their owner and admins', async () => {
  assert.equal((await as('p1', () => q(`select * from professional_private`))).length, 1);
  assert.equal((await as('p3', () => q(`select * from professional_private where professional_id = '${ids.p1}'`))).length, 0);
  assert.equal((await as('o1', () => q(`select * from professional_private`))).length, 0);
  assert.equal((await as('admin', () => q(`select * from professional_private`))).length, 3);
  // a pending profile is visible to its owner and admins only
  assert.equal((await as('p3', () => q(`select 1 from professionals where id = '${ids.p2}'`))).length, 0);
  assert.equal((await as('p2', () => q(`select 1 from professionals where id = '${ids.p2}'`))).length, 1);
  // another presenter cannot edit it
  await as('p3', () => q(`update professional_private set license_number = 'HACKED' where professional_id = '${ids.p1}'`));
  await as('p3', () => q(`update professionals set bio = 'HACKED' where id = '${ids.p1}'`));
  assert.equal((await one(`select license_number from professional_private where professional_id = $1`, [ids.p1])).license_number, 'MH-p1');
  assert.equal((await one(`select bio from professionals where id = $1`, [ids.p1])).bio, 'bio');
});

test('users cannot change their own role, only their name', async () => {
  await assert.rejects(as('p1', () => q(`update profiles set role = 'admin' where id = '${ids.p1}'`)), /permission denied/);
  await as('p1', () => q(`update profiles set full_name = 'Pat One' where id = '${ids.p1}'`));
  await as('p1', () => q(`update profiles set full_name = 'HACKED' where id = '${ids.p3}'`));
  assert.equal((await one(`select full_name from profiles where id = $1`, [ids.p1])).full_name, 'Pat One');
  assert.equal((await one(`select full_name from profiles where id = $1`, [ids.p3])).full_name, 'p3');
  assert.equal((await as('p1', () => q(`select * from profiles`))).length, 1);
});

test('editing license details sends an approved profile back to review; other edits do not', async () => {
  await as('p1', () => q(`update professionals set bio = 'new bio' where id = '${ids.p1}'`));
  assert.equal((await one(`select status from professionals where id = $1`, [ids.p1])).status, 'approved');

  await as('p1', () => q(`update professionals set license_state = 'GA' where id = '${ids.p1}'`));
  assert.equal((await one(`select status from professionals where id = $1`, [ids.p1])).status, 'pending');
  assert.equal((await outbox('admin_reverify_presenter')).length, 1);
  await as('admin', () => q(`update professionals set status = 'approved', license_state = 'FL' where id = '${ids.p1}'`));

  await as('p1', () => q(`update professional_private set license_number = 'MH-NEW' where professional_id = '${ids.p1}'`));
  assert.equal((await one(`select status from professionals where id = $1`, [ids.p1])).status, 'pending');
  await as('admin', () => q(`update professionals set status = 'approved' where id = '${ids.p1}'`));

  await as('admin', () => q(`update professional_private set ins_verified_at = now() where professional_id = '${ids.p1}'`));
  await as('p1', () => q(`update professional_private set phone = '555-0100' where professional_id = '${ids.p1}'`));
  assert.ok((await one(`select ins_verified_at from professional_private where professional_id = $1`, [ids.p1])).ins_verified_at);
  await as('p1', () => q(`update professional_private set ins_policy_number = 'POL-2', ins_verified_at = now() where professional_id = '${ids.p1}'`));
  assert.equal((await one(`select ins_verified_at from professional_private where professional_id = $1`, [ids.p1])).ins_verified_at, null);
  assert.equal((await one(`select status from professionals where id = $1`, [ids.p1])).status, 'approved');
});

test('an admin can also hold a presenter profile', async () => {
  await as('admin', () => insertPro('admin'));
  assert.equal((await one(`select count(*)::int as n from professionals where id = $1`, [ids.admin])).n, 1);
  await db.exec(`delete from professionals where id = '${ids.admin}'`);
});

test('organizations: one per account, private to its owner, intro call offered to first-timers', async () => {
  const [o1] = await as('o1', () => q(`
    insert into organizations (owner_id, name, org_type, lead_name, lead_email, cc_emails, prior_contact, intro_call_offered_at)
    values ('${ids.o1}', 'Riverside Middle', 'School (K-12)', 'Lee Lead', 'lead@o1.test', '{principal@o1.test}', false, '2000-01-01') returning *`));
  ref.org1 = o1.id;
  const [o2] = await as('o2', () => q(`
    insert into organizations (owner_id, name, org_type, lead_name, lead_email, prior_contact)
    values ('${ids.o2}', 'Harbor Nonprofit', 'Nonprofit', 'Sam', 'sam@o2.test', true) returning *`));
  ref.org2 = o2.id;

  const intro = await outbox('intro_call_offer');
  assert.equal(intro.length, 1);
  assert.deepEqual(intro[0].to_emails, ['lead@o1.test']);
  assert.deepEqual(intro[0].cc_emails, ['principal@o1.test']);
  const offered = (await one(`select intro_call_offered_at from organizations where id = $1`, [ref.org1])).intro_call_offered_at;
  assert.ok(new Date(offered).getFullYear() > 2020, 'offer time is set by the system, not the client');
  assert.equal((await outbox('admin_new_organization')).length, 2);

  assert.equal((await as('o2', () => q(`select * from organizations`))).length, 1);
  assert.equal((await as('p1', () => q(`select * from organizations`))).length, 0);
  await assert.rejects(as('p1', () => q(`insert into organizations (owner_id, name, org_type, lead_name, lead_email) values ('${ids.p1}', 'x', 'y', 'z', 'a@b.c')`)), /row-level security/);
  await assert.rejects(as('o1', () => q(`insert into organizations (owner_id, name, org_type, lead_name, lead_email) values ('${ids.o2}', 'x', 'y', 'z', 'a@b.c')`)), /row-level security|duplicate key/);
  await assert.rejects(as('o1', () => q(`insert into organizations (owner_id, name, org_type, lead_name, lead_email) values ('${ids.o1}', 'Second', 'y', 'z', 'a@b.c')`)), /duplicate key/);
  // owner cannot hand the organization to someone else
  await as('o1', () => q(`update organizations set owner_id = '${ids.o2}', name = 'Riverside Middle School' where id = '${ref.org1}'`));
  const after = await one(`select owner_id, name from organizations where id = $1`, [ref.org1]);
  assert.equal(after.owner_id, ids.o1);
  assert.equal(after.name, 'Riverside Middle School');
});

test('requests: the system sets tracking number, status and match; clients cannot', async () => {
  const a = await as('o1', () => insertRequest(ref.org1, ', status, matched_professional_id, tracking_id', `, 'confirmed', '${ids.p1}', 'HACK'`));
  ref.reqA = a.id;
  assert.equal(a.status, 'new');
  assert.equal(a.matched_professional_id, null);
  assert.match(a.tracking_id, /^C4C-[A-HJKMNP-Z2-9]{6}$/);

  await assert.rejects(as('o1', () => insertRequest(ref.org1, ', requested_professional_id', `, '${ids.p2}'`)), /not available/);
  const b = await as('o1', () => insertRequest(ref.org1, ', requested_professional_id', `, '${ids.p1}'`));
  ref.reqB = b.id; ref.trackB = b.tracking_id;
  assert.equal(b.status, 'awaiting_presenter');
  assert.deepEqual((await outbox('presenter_invited')).map(m => m.to_emails[0]), ['p1@example.test']);
  const received = await outbox('request_received');
  assert.equal(received.length, 2);
  assert.deepEqual(received[0].cc_emails, ['principal@o1.test']);
  assert.equal(received[0].payload.tracking_id, a.tracking_id);
  assert.equal(received[0].payload.org_name, 'Riverside Middle School');

  await assert.rejects(as('o2', () => insertRequest(ref.org1)), /row-level security/);
  await assert.rejects(as('p1', () => insertRequest(ref.org1)), /row-level security/);

  await assert.rejects(as('o1', () => q(`update requests set status = 'confirmed' where id = '${ref.reqA}'`)), /made by C4C/);
  await assert.rejects(as('o1', () => q(`update requests set matched_professional_id = '${ids.p3}' where id = '${ref.reqA}'`)), /made by C4C/);
  await as('o1', () => q(`update requests set description = 'Parent night on teen anxiety' where id = '${ref.reqA}'`));
  assert.equal((await one(`select description from requests where id = $1`, [ref.reqA])).description, 'Parent night on teen anxiety');
});

test('requests are visible to their organization, involved presenters and admins only', async () => {
  assert.equal((await as('o1', () => q(`select id from requests`))).length, 2);
  assert.equal((await as('o2', () => q(`select id from requests`))).length, 0);
  assert.equal((await as('p3', () => q(`select id from requests`))).length, 0);
  assert.deepEqual((await as('p1', () => q(`select id from requests`))).map(r => r.id), [ref.reqB]);
  assert.equal((await as('admin', () => q(`select id from requests`))).length, 2);
  // the requested presenter can see who is asking; the organization cannot yet see the presenter's email
  assert.equal((await as('p1', () => q(`select name from organizations`)))[0].name, 'Riverside Middle School');
  assert.equal((await as('o1', () => q(`select email from profiles where id = '${ids.p1}'`))).length, 0);
});

test('the requested presenter accepts: both sides are connected and introduced', async () => {
  await assert.rejects(as('p3', () => q(`select respond_to_request('${ref.reqB}', true)`)), /open invitation/);
  await assert.rejects(as('p2', () => q(`select respond_to_request('${ref.reqB}', true)`)), /approved presenters/);
  await assert.rejects(as('o1', () => q(`select respond_to_request('${ref.reqB}', true)`)), /approved presenters/);

  const res = await as('p1', () => one(`select respond_to_request('${ref.reqB}', true) as s`));
  assert.equal(res.s, 'connected');
  const r = await one(`select status, matched_professional_id from requests where id = $1`, [ref.reqB]);
  assert.equal(r.matched_professional_id, ids.p1);

  const toOrg = (await outbox('connected_organization'))[0];
  assert.deepEqual(toOrg.to_emails, ['lead@o1.test']);
  assert.equal(toOrg.payload.presenter_email, 'p1@example.test');
  assert.deepEqual((await outbox('connected_presenter'))[0].to_emails, ['p1@example.test']);
  assert.deepEqual((await outbox('admin_connection'))[0].to_emails, ['admin@example.test']);

  // now the organization can see its presenter's email; other organizations still cannot
  assert.equal((await as('o1', () => q(`select email from profiles where id = '${ids.p1}'`)))[0].email, 'p1@example.test');
  assert.equal((await as('o2', () => q(`select email from profiles where id = '${ids.p1}'`))).length, 0);
  await assert.rejects(as('p1', () => q(`select respond_to_request('${ref.reqB}', false)`)), /open invitation/);
});

test('C4C suggests and invites presenters; the organization chooses among those interested', async () => {
  await assert.rejects(as('o1', () => q(`select * from suggest_presenters('${ref.reqA}')`)), /Admins only/);
  await assert.rejects(as('p1', () => q(`select invite_presenters('${ref.reqA}', array['${ids.p1}']::uuid[])`)), /Admins only/);

  const ranked = await as('admin', () => q(`select * from suggest_presenters('${ref.reqA}')`));
  assert.deepEqual(ranked.map(x => x.display_name).sort(), ['p1', 'p3']);     // pending p2 is never suggested
  assert.equal(ranked[0].score, 3 + 2 + 1 + 1);                              // topic + audience + type + delivery

  const n = await as('admin', () => one(`select invite_presenters('${ref.reqA}', array['${ids.p1}', '${ids.p3}', '${ids.p2}']::uuid[]) as n`));
  assert.equal(n.n, 2);
  assert.equal((await one(`select status from requests where id = $1`, [ref.reqA])).status, 'matching');
  assert.equal((await outbox('presenter_invited')).length, 3);

  // invited presenters can now see the request; each sees only their own invitation
  assert.equal((await as('p3', () => q(`select id from requests where id = '${ref.reqA}'`))).length, 1);
  assert.deepEqual((await as('p3', () => q(`select professional_id from request_candidates`))).map(c => c.professional_id), [ids.p3]);
  assert.equal((await as('o1', () => q(`select * from request_candidates`))).length, 0);          // nobody interested yet

  assert.equal((await as('p3', () => one(`select respond_to_request('${ref.reqA}', true) as s`))).s, 'matching');
  await as('p1', () => q(`select respond_to_request('${ref.reqA}', false)`));
  assert.deepEqual((await as('o1', () => q(`select professional_id from request_candidates`))).map(c => c.professional_id), [ids.p3]);
  assert.deepEqual((await outbox('presenter_interested'))[0].to_emails, ['lead@o1.test']);

  await assert.rejects(as('o1', () => q(`select choose_presenter('${ref.reqA}', '${ids.p1}')`)), /not said they are interested/);
  await assert.rejects(as('o2', () => q(`select choose_presenter('${ref.reqA}', '${ids.p3}')`)), /Only the requesting organization/);
  await assert.rejects(as('p3', () => q(`select choose_presenter('${ref.reqA}', '${ids.p3}')`)), /Only the requesting organization/);
  await as('o1', () => q(`select choose_presenter('${ref.reqA}', '${ids.p3}')`));
  const a = await one(`select status, matched_professional_id from requests where id = $1`, [ref.reqA]);
  assert.deepEqual([a.status, a.matched_professional_id], ['connected', ids.p3]);
});

test('if the requested presenter declines, the request goes to C4C for matching', async () => {
  const c = await as('o2', () => insertRequest(ref.org2, ', requested_professional_id', `, '${ids.p3}'`));
  ref.reqC = c.id;
  assert.equal((await as('p3', () => one(`select respond_to_request('${ref.reqC}', false) as s`))).s, 'matching');
  assert.equal((await outbox('admin_needs_matching')).length, 1);
  await assert.rejects(as('o2', () => q(`select schedule_event('${ref.reqC}', now() + interval '40 days', 60, null)`)), /Connect with a presenter/);
});

test('either side sets the date; outsiders cannot', async () => {
  await assert.rejects(as('p3', () => q(`select schedule_event('${ref.reqB}', now() + interval '40 days', 60, 'Gym')`)), /Only the organization or its presenter/);
  await assert.rejects(as('o2', () => q(`select schedule_event('${ref.reqB}', now() + interval '40 days', 60, 'Gym')`)), /Only the organization or its presenter/);
  await assert.rejects(as('o1', () => q(`select schedule_event('${ref.reqB}', now() - interval '1 day', 60, 'Gym')`)), /in the future/);

  const ev = await as('o1', () => one(`select schedule_event('${ref.reqB}', now() + interval '40 days', 90, 'Gym') as id`));
  ref.eventB = ev.id;
  assert.equal((await one(`select status from requests where id = $1`, [ref.reqB])).status, 'confirmed');
  const mail = (await outbox('event_confirmed'))[0];
  assert.deepEqual(mail.to_emails, ['lead@o1.test', 'p1@example.test']);
  assert.ok(mail.payload.event_starts_at);

  await as('p1', () => q(`select schedule_event('${ref.reqB}', now() + interval '45 days', 60, '')`));
  assert.equal((await one(`select count(*)::int as n from events where request_id = $1`, [ref.reqB])).n, 1);
  assert.equal((await outbox('event_rescheduled')).length, 1);

  assert.equal((await as('o1', () => q(`select id from events`))).length, 1);
  assert.equal((await as('p1', () => q(`select id from events`))).length, 1);
  assert.equal((await as('p3', () => q(`select id from events`))).length, 0);
  assert.equal((await as('o2', () => q(`select id from events`))).length, 0);
  // the presenter cannot edit the event row directly; outcomes go through record_event_outcome()
  await as('p1', () => q(`update events set attendance_actual = 9999 where id = '${ref.eventB}'`));
  assert.equal((await one(`select attendance_actual from events where id = $1`, [ref.eventB])).attendance_actual, null);
});

test('after the session the presenter records turnout, which completes the request', async () => {
  await assert.rejects(as('p1', () => q(`select record_event_outcome('${ref.eventB}', 40, 1.5)`)), /not happened yet/);
  await db.exec(`update events set starts_at = now() - interval '1 day' where id = '${ref.eventB}'`);
  await assert.rejects(as('p3', () => q(`select record_event_outcome('${ref.eventB}', 40, 1.5)`)), /Only the presenter/);
  await as('p1', () => q(`select record_event_outcome('${ref.eventB}', 40, 1.5)`));
  assert.equal((await one(`select attendance_actual from events where id = $1`, [ref.eventB])).attendance_actual, 40);
  assert.equal((await one(`select status from requests where id = $1`, [ref.reqB])).status, 'completed');
});

test('only the requesting organization can cancel, and closed requests stay closed', async () => {
  await assert.rejects(as('o2', () => q(`select cancel_request('${ref.reqA}')`)), /Only the requesting organization/);
  await assert.rejects(as('p3', () => q(`select cancel_request('${ref.reqA}')`)), /Only the requesting organization/);
  await as('o1', () => q(`select cancel_request('${ref.reqA}')`));
  assert.equal((await one(`select status from requests where id = $1`, [ref.reqA])).status, 'cancelled');
  assert.deepEqual((await outbox('request_cancelled'))[0].to_emails, ['p3@example.test']);
  await assert.rejects(as('o1', () => q(`select cancel_request('${ref.reqA}')`)), /already closed/);
  await assert.rejects(as('o1', () => q(`update requests set description = 'x' where id = '${ref.reqA}'`)), /closed/);
});

test('status lookup needs the tracking number and a matching email', async () => {
  const hit = (await as(null, () => one(`select track_request($1, $2) as j`, [ref.trackB.toLowerCase(), ' LEAD@o1.test ']))).j;
  assert.equal(hit.status, 'completed');
  assert.equal(hit.presenter_name, 'p1');
  assert.equal(hit.org_name, 'Riverside Middle School');
  assert.ok(hit.history.length >= 4);
  assert.ok((await as(null, () => one(`select track_request($1, $2) as j`, [ref.trackB, 'principal@o1.test']))).j, 'CC contacts can look it up too');
  assert.equal((await as(null, () => one(`select track_request($1, $2) as j`, [ref.trackB, 'sam@o2.test']))).j, null);
  assert.equal((await as(null, () => one(`select track_request($1, $2) as j`, ['C4C-ZZZZZZ', 'lead@o1.test']))).j, null);
});

test('the email log and admin tools are for admins only', async () => {
  assert.equal((await as('o1', () => q(`select * from email_outbox`))).length, 0);
  assert.equal((await as('p1', () => q(`select * from email_outbox`))).length, 0);
  assert.ok((await as('admin', () => q(`select * from email_outbox`))).length > 10);
  await assert.rejects(as('p1', () => q(`select admin_overview()`)), /Admins only/);
  await assert.rejects(as('o1', () => q(`select admin_overview()`)), /Admins only/);
  await assert.rejects(as('p1', () => q(`select enqueue_email('x', array['a@b.c'], null, '{}'::jsonb)`)), /permission denied/);
  await assert.rejects(as('p1', () => q(`insert into request_candidates (request_id, professional_id) values ('${ref.reqC}', '${ids.p1}')`)), /row-level security/);
  await assert.rejects(as('p1', () => q(`insert into request_history (request_id, what) values ('${ref.reqB}', 'fake')`)), /permission denied/);
});

test('the timeline is visible to the organization and its matched presenter only', async () => {
  assert.ok((await as('o1', () => q(`select what from request_history where request_id = '${ref.reqB}'`))).length >= 4);
  assert.ok((await as('p1', () => q(`select what from request_history where request_id = '${ref.reqB}'`))).length >= 4);
  assert.equal((await as('p3', () => q(`select what from request_history where request_id = '${ref.reqB}'`))).length, 0);
  assert.equal((await as('o2', () => q(`select what from request_history where request_id = '${ref.reqB}'`))).length, 0);
  // neutral wording: an invited presenter who declined is never named to the organization
  const lines = (await as('o1', () => q(`select what from request_history where request_id = '${ref.reqA}' order by id`))).map(h => h.what);
  assert.ok(lines.includes('C4C invited 2 presenters'));
  assert.ok(lines.includes('Connected with p3'));
  assert.ok(!lines.some(l => l.includes('p1')));
});

test('my_requests() returns each user their own view of the data', async () => {
  const forOrg = (await as('o1', () => one(`select my_requests() as j`))).j;
  assert.equal(forOrg.length, 2);
  const b = forOrg.find(r => r.id === ref.reqB);
  assert.equal(b.organization.name, 'Riverside Middle School');
  assert.ok(!('owner_id' in b.organization));
  assert.deepEqual(b.matched, { id: ids.p1, display_name: 'p1', email: 'p1@example.test' });
  assert.equal(b.event.attendance_actual, 40);
  assert.ok(!('share_token' in b.event));
  assert.ok(b.history.length >= 4);
  const a = forOrg.find(r => r.id === ref.reqA);
  assert.deepEqual(a.candidates.map(c => [c.display_name, c.response, c.score]), [['p3', 'interested', null]]);

  const forP1 = (await as('p1', () => one(`select my_requests() as j`))).j;
  assert.deepEqual(forP1.map(r => r.id).sort(), [ref.reqA, ref.reqB].sort());
  assert.deepEqual(forP1.find(r => r.id === ref.reqA).candidates.map(c => c.display_name), ['p1']);
  assert.equal(forP1.find(r => r.id === ref.reqA).history.length, 0);          // not the matched presenter there
  assert.equal(forP1.find(r => r.id === ref.reqB).organization.lead_email, 'lead@o1.test');

  assert.equal((await as('p2', () => one(`select my_requests() as j`))).j.length, 0);

  const adm = (await as('admin', () => one(`select admin_overview() as j`))).j;
  assert.equal(adm.requests.length, 3);
  assert.equal(adm.organizations.length, 2);
  const proP1 = adm.professionals.find(p => p.id === ids.p1);
  assert.equal(proP1.email, 'p1@example.test');
  assert.equal(proP1.private.license_number, 'MH-NEW');
  assert.ok(adm.outbox.length > 10);
  assert.equal(typeof adm.requests.find(r => r.id === ref.reqA).candidates[0].score, 'number');
});

test('an admin can assign a presenter directly, and remove records', async () => {
  await as('admin', () => q(`update requests set matched_professional_id = '${ids.p1}', status = 'connected' where id = '${ref.reqC}'`));
  assert.equal((await one(`select status from requests where id = $1`, [ref.reqC])).status, 'connected');
  assert.equal((await as('p1', () => q(`select id from requests where id = '${ref.reqC}'`))).length, 1);
  await as('admin', () => q(`delete from requests where id = '${ref.reqC}'`));
  assert.equal((await q(`select 1 from requests where id = $1`, [ref.reqC])).length, 0);
  // a presenter with recorded sessions cannot be deleted by accident; suspend instead
  await assert.rejects(as('admin', () => q(`delete from professionals where id = '${ids.p1}'`)), /violates foreign key/);
  await as('admin', () => q(`update professionals set status = 'suspended' where id = '${ids.p1}'`));
  assert.deepEqual((await as(null, () => q(`select display_name from professionals`))).map(r => r.display_name), ['p3']);
  // its organization still sees who presented
  assert.equal((await as('o1', () => q(`select display_name from professionals where id = '${ids.p1}'`))).length, 1);
});
