// Writes docs/email-preview.html (every email with sample data) and supabase/templates/*.html
// (the four sign-in emails, ready to paste into Supabase > Authentication > Email Templates).
// Usage: node build-email-preview.mjs   (inside supabase/tests)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { emailContent, bodyHtml, authEmails, TEMPLATE_NAMES, esc } from '../functions/_shared/emails.js';
import { SAMPLE } from './sample-payload.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPTS = { siteUrl: 'https://aidanjmeyers.github.io/c4c-connecting-portal/', contactEmail: 'info@counselorsforchange.org' };
const WHO = {
  application_received: 'Presenter', profile_approved: 'Presenter', presenter_invited: 'Presenter', connected_presenter: 'Presenter',
  request_cancelled: 'Presenter', intro_call_offer: 'Organization', request_received: 'Organization (lead and CC contacts)',
  presenter_interested: 'Organization', connected_organization: 'Organization', event_confirmed: 'Organization and presenter',
  event_rescheduled: 'Organization and presenter'
};
const GROUPS = [
  ['Presenters', n => WHO[n] === 'Presenter'],
  ['Schools and organizations', n => (WHO[n] || '').startsWith('Organization')],
  ['C4C admins', n => n.startsWith('admin_')],
  ['Outreach invitation (written by an admin in the Outreach tab)', n => n === 'outreach_campaign']
];

function card(name, theme) {
  const c = emailContent(name, SAMPLE, OPTS);
  return `<section class="mail"><div class="meta"><b>${esc(c.subject)}</b><span>To: ${esc(WHO[name] || (name === 'outreach_campaign' ? 'People not yet on the portal' : 'C4C admins'))} · template <code>${esc(name)}</code></span></div>
    <div class="frame">${bodyHtml(c, theme)}</div></section>`;
}

// The sign-in emails are full documents; keep only the inner table for the preview page.
function innerTable(html) {
  const start = html.indexOf('<table role="presentation" width="600"');
  const end = html.lastIndexOf('</td></tr></table></body></html>');
  return html.slice(start, end).replaceAll('{{ .ConfirmationURL }}', '#');
}

const auth = authEmails(OPTS);
const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connections 4 Change email preview</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#eef2f6;color:#1a2a34}
  header{background:#1b3a5c;color:#fff;padding:22px 16px}
  header h1{margin:0 0 6px;font-size:1.4rem} header p{margin:0;font-size:.92rem;opacity:.9;max-width:70ch}
  main{max-width:680px;margin:0 auto;padding:8px 16px 60px}
  h2{font-size:1.15rem;margin:34px 0 6px;color:#1b3a5c;border-bottom:2px solid #c9d6e3;padding-bottom:6px}
  .mail{margin:18px 0 30px}
  .meta{font-size:.86rem;margin:0 0 8px} .meta b{display:block;font-size:.98rem} .meta span{color:#5b6573}
  .meta code{background:#dde6ee;padding:1px 5px;border-radius:3px;font-size:.78rem}
  .frame{overflow-x:auto}
  .note{background:#fff;border-left:4px solid #3a6ea5;padding:12px 14px;font-size:.9rem;margin:14px 0}
</style></head><body>
<header><h1>Connections 4 Change: email preview</h1>
<p>Every automated email, shown with made-up sample data. The look follows C4C's board recap emails: Times New Roman, navy and blue, the C4C logo, and a layout that holds up in Outlook and Gmail. Nothing here has been sent.</p></header>
<main>
<div class="note"><b>${TEMPLATE_NAMES.length + Object.keys(auth).length} emails in total.</b> ${TEMPLATE_NAMES.length} are sent by the portal as things happen, and ${Object.keys(auth).length} are the sign-in emails (confirm your address, reset your password). At the bottom is one email in an alternative teal palette that matches the portal site, in case you prefer it.</div>
${GROUPS.map(([title, pick]) => `<h2>${title}</h2>${TEMPLATE_NAMES.filter(pick).map(n => card(n, 'house')).join('')}`).join('')}
<h2>Sign-in emails</h2>
${Object.entries(auth).map(([name, e]) => `<section class="mail"><div class="meta"><b>${esc(e.subject)}</b><span>Sent by the sign-in system · <code>${esc(name)}</code></span></div>
  <div class="frame">${innerTable(e.html)}</div></section>`).join('')}
<h2>Alternative palette: portal teal</h2>
${card('connected_organization', 'portal')}
</main></body></html>`;

mkdirSync(path.join(root, 'docs'), { recursive: true });
writeFileSync(path.join(root, 'docs', 'email-preview.html'), page);
mkdirSync(path.join(root, 'supabase', 'templates'), { recursive: true });
for (const [name, e] of Object.entries(auth)) {
  writeFileSync(path.join(root, 'supabase', 'templates', `${name}.html`), `<!-- Subject: ${e.subject} -->\n${e.html}\n`);
}
console.log(`wrote docs/email-preview.html (${TEMPLATE_NAMES.length} portal emails) and ${Object.keys(auth).length} sign-in templates`);
