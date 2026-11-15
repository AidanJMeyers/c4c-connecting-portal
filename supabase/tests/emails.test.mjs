// Branded email templates: every message the database can queue has a template, and each
// one renders safely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderEmail, authEmails, TEMPLATE_NAMES } from '../functions/_shared/emails.js';
import { SAMPLE } from './sample-payload.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPTS = { siteUrl: 'https://portal.example/', contactEmail: 'info@counselorsforchange.org' };

test('every template the database queues has a branded email', () => {
  const sql = readdirSync(path.join(here, '..', 'migrations')).map(f => readFileSync(path.join(here, '..', 'migrations', f), 'utf8')).join('\n');
  const queued = new Set([...sql.matchAll(/enqueue_email\('([a-z_]+)'/g)].map(m => m[1]));
  assert.ok(queued.size >= 20, `found ${queued.size} queued templates`);
  for (const name of queued) assert.ok(TEMPLATE_NAMES.includes(name), `missing template: ${name}`);
  for (const name of TEMPLATE_NAMES) assert.ok(queued.has(name), `template is never queued: ${name}`);
});

test('each email renders with a subject, the logo, a working button and no leftovers', () => {
  for (const name of TEMPLATE_NAMES) {
    const { subject, html, text } = renderEmail(name, SAMPLE, OPTS);
    assert.ok(subject.length > 5 && subject.length < 110, `${name}: subject length`);
    for (const out of [subject, html, text]) {
      assert.ok(!/undefined|null|NaN|\[object/.test(out), `${name}: leftover value in output`);
      assert.ok(!out.includes('—'), `${name}: contains an em dash`);
    }
    assert.ok(html.includes('cropped-c4clogo1.png') && html.includes('width="260"') && html.includes('height="98"'), `${name}: logo`);
    assert.match(html, /href="https:\/\/portal\.example\/#(account|admin|request)"/, `${name}: button link`);
    assert.ok(html.includes('CONNECTIONS 4 CHANGE') && html.includes('counselorsforchange.org'), `${name}: branding`);
    assert.ok(!/<style[^>]*>(?![^<]*mso)/.test(html.replace(/<!--\[if mso\]>.*?<!\[endif\]-->/s, '')), `${name}: inline styles only`);
    assert.ok(text.includes('Counselors for Change'), `${name}: plain-text version`);
  }
});

test('session emails show the date in the request’s own timezone', () => {
  const { html } = renderEmail('event_confirmed', SAMPLE, OPTS);
  assert.ok(html.includes('Tuesday, March 16, 2027'), 'weekday and date');
  assert.ok(/9:30\sAM EDT/.test(html), 'local time with zone');
});

test('whatever people type is escaped, never run', () => {
  const evil = { ...SAMPLE, org_name: '<script>alert(1)</script>', lead_name: '"><img src=x onerror=alert(1)>', lead_email: 'a@b.c"><b>' };
  for (const name of TEMPLATE_NAMES) {
    const { html } = renderEmail(name, evil, OPTS);
    assert.ok(!html.includes('<script>') && !html.includes('<img src=x'), `${name}: unescaped input`);
  }
});

test('missing details are left out rather than shown blank', () => {
  const { html, text } = renderEmail('request_received', { tracking_id: 'C4C-AAAAAA', org_name: 'Org', lead_name: 'Sam', event_type: 'Panel Discussion' }, OPTS);
  assert.ok(!html.includes('Topics') && !html.includes('Preferred window'));
  assert.ok(text.includes('Tracking number: C4C-AAAAAA'));
  assert.throws(() => renderEmail('nope', {}), /Unknown email template/);
});

test('sign-in emails keep Supabase’s link placeholder intact', () => {
  const a = authEmails(OPTS);
  assert.deepEqual(Object.keys(a).sort(), ['confirmation', 'email_change', 'invite', 'recovery']);
  for (const [name, e] of Object.entries(a)) {
    assert.ok(e.html.includes('href="{{ .ConfirmationURL }}"'), `${name}: confirmation link`);
    assert.ok(!e.html.includes('—') && e.subject.length > 10, name);
  }
});
