// Smoke test for supabase/drafts: the Phase 3–4 SQL loads on top of the core migration and
// its main rules hold. Not as thorough as core.test.mjs; expand before deploying the draft.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers.mjs';

let db, ids, q, one, as, signUp;
const ref = {};

before(async () => {
  ({ db, ids, q, one, as, signUp } = await createDb({ drafts: true }));
  for (const [name, role] of [['admin', 'professional'], ['p1', 'professional'], ['p2', 'professional'], ['o1', 'organization'], ['o2', 'organization']]) {
    await signUp(name, { role, full_name: name });
  }
  await db.exec(`update profiles set role = 'admin' where id = '${ids.admin}'`);
  // seed as the database owner: two approved presenters, two organizations, one past event for o1 with p1
  for (const p of ['p1', 'p2']) {
    await db.exec(`insert into professionals (id, display_name, license_type, license_state, bio, status)
                   values ('${ids[p]}', '${p}', 'LMHC', 'FL', 'bio', 'approved')`);
  }
  for (const o of ['o1', 'o2']) {
    ref[o] = (await one(`insert into organizations (owner_id, name, org_type, lead_name, lead_email)
                         values ('${ids[o]}', '${o}', 'School (K-12)', 'Lead', '${o}@example.test') returning id`)).id;
  }
  ref.req = (await one(`insert into requests (organization_id, matched_professional_id, event_type, window_start, window_end, description, status)
                        values ('${ref.o1}', '${ids.p1}', 'Workshop', current_date, current_date + 30, 'd', 'confirmed') returning id`)).id;
  const ev = await one(`insert into events (request_id, organization_id, professional_id, title, starts_at, attendance_actual, presenter_hours)
                        values ('${ref.req}', '${ref.o1}', '${ids.p1}', 'Workshop', now() - interval '2 days', 35, 1.5) returning id, feedback_token`);
  ref.event = ev.id; ref.token = ev.feedback_token;
});

test('presenters manage their own materials; only admins can mark one as official', async () => {
  const m = await as('p1', () => one(`insert into materials (owner_id, title, kind, storage_path, is_c4c_official)
                                      values ('${ids.p1}', 'Teen anxiety deck', 'slides', 'p1/deck.pptx', true) returning *`));
  ref.mine = m.id;
  assert.equal(m.is_c4c_official, false);
  await assert.rejects(as('o1', () => q(`insert into materials (owner_id, title, kind, storage_path) values ('${ids.o1}', 'x', 'slides', 'x')`)), /row-level security/);
  assert.equal((await as('p2', () => q(`select id from materials`))).length, 0, 'private until shared');
  await as('p1', () => q(`update materials set in_shared_bank = true where id = '${ref.mine}'`));
  assert.equal((await as('p2', () => q(`select id from materials`))).length, 1, 'visible in the shared bank');
  assert.equal((await as('o2', () => q(`select id from materials`))).length, 0, 'the bank is for presenters, not organizations');
});

test('a presenter attaches materials to their own event, and the organization can then see them', async () => {
  await assert.rejects(as('p2', () => q(`insert into event_materials (event_id, material_id) values ('${ref.event}', '${ref.mine}')`)), /row-level security/);
  await as('p1', () => q(`insert into event_materials (event_id, material_id) values ('${ref.event}', '${ref.mine}')`));
  assert.equal((await as('o1', () => q(`select id from materials`))).length, 1);
  assert.equal((await as('o2', () => q(`select id from materials`))).length, 0);
});

test('attendee feedback needs a valid event token and is read only by the two parties and admins', async () => {
  await as(null, () => q(`select submit_attendee_feedback($1, 'parent', 2, 4, 5, 'The coping skills', 'Sleep')`, [ref.token]));
  await assert.rejects(as(null, () => q(`select submit_attendee_feedback('nope', 'parent', 2, 4, 5, '', '')`)), /not valid/);
  await assert.rejects(as(null, () => q(`select * from attendee_feedback`)), /permission denied/);
  await assert.rejects(as('p1', () => q(`insert into attendee_feedback (event_id, would_recommend) values ('${ref.event}', 5)`)), /permission denied/);
  for (const [who, n] of [['p1', 1], ['o1', 1], ['admin', 1], ['p2', 0], ['o2', 0]]) {
    assert.equal((await as(who, () => q(`select id from attendee_feedback`))).length, n, who);
  }
});

test('each side files its own survey and cannot read the other side’s', async () => {
  await as('o1', () => q(`insert into event_surveys (event_id, respondent_id, answers) values ('${ref.event}', '${ids.o1}', '{"rating": 5}')`));
  await as('p1', () => q(`insert into event_surveys (event_id, respondent_id, answers) values ('${ref.event}', '${ids.p1}', '{"accommodating": 4}')`));
  await assert.rejects(as('o2', () => q(`insert into event_surveys (event_id, respondent_id, answers) values ('${ref.event}', '${ids.o2}', '{}')`)), /row-level security/);
  assert.equal((await as('o1', () => q(`select id from event_surveys`))).length, 1);
  assert.equal((await as('p1', () => q(`select id from event_surveys`))).length, 1);
  assert.equal((await as('admin', () => q(`select id from event_surveys`))).length, 2);
});

test('impact views count past sessions, and news is public once published', async () => {
  const y = (await as('admin', () => q(`select * from impact_by_year`)))[0];
  assert.deepEqual([y.sessions, y.people_reached, y.organizations_served], [1, 35, 1]);
  assert.equal((await as('admin', () => q(`select * from top_contributors`)))[0].display_name, 'p1');
  assert.equal((await as('o2', () => q(`select * from impact_by_year`))).length, 0, 'non-admins only aggregate what they can see');
  await as('admin', () => q(`insert into news_posts (title, body, published_at, author_id) values ('Walk recap', 'Thanks!', now(), '${ids.admin}'), ('Draft', 'tbd', null, '${ids.admin}')`));
  assert.deepEqual((await as(null, () => q(`select title from news_posts`))).map(n => n.title), ['Walk recap']);
});
