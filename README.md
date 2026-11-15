# Connections 4 Change

A Counselors for Change (C4C) initiative. The portal connects verified, licensed mental health professionals with schools and community organizations for panels, workshops and psychoeducation sessions.

- **Live site (demo mode):** https://aidanjmeyers.github.io/c4c-connecting-portal/
- **Same site on the real database, for testing:** add `?live=1` to the address
- **What it should do and why:** [docs/SPEC.md](docs/SPEC.md)
- **What's left to switch on:** [docs/SETUP.md](docs/SETUP.md)
- **Plan:** [ROADMAP.md](ROADMAP.md)

## Where things stand

| Piece | State |
|---|---|
| Portal screens | Built and tested in the browser: sign-in, presenter profiles, organization accounts, requests, dashboards for each side, admin, outreach. |
| Database | Live on Supabase (project `connections-4-change`). Matches the locally tested version exactly; see "Checking the live database" below. |
| Public site | Runs in **demo mode** (data stays in each visitor's browser) until email sending is set up. `?live=1` uses the real database. |
| Email sending | **Not set up yet.** Emails are written to a queue that admins can see; nothing is delivered. Templates are done: [docs/email-preview.html](docs/email-preview.html). |
| Legal wording | Draft. The Privacy & Terms page and the presenter acknowledgment need attorney review before launch. |

## How it works

**Presenters** create an account and profile. License and insurance details are private. C4C admins verify them and approve the profile, which then appears in the public directory. Changing license details sends a live profile back for a re-check.

**Organizations** create one account with a lead contact and optional CC emails. They request a presenter by name from the directory, or describe what they need. Each request gets a tracking number.

**Connecting.** A presenter requested by name accepts or passes. Otherwise an admin invites the best-fit presenters (ranked suggestions), those who are interested say so, and the organization chooses. Once connected, the two settle the date directly, record it, and get calendar links. After the session the presenter records turnout.

**Admins** review presenters, follow every request, see every queued email, and run outreach campaigns to people who are not on the portal yet.

## Project layout

```
index.html                      all views
css/styles.css                  C4C brand styles
js/config.js                    settings, option lists, Supabase address, live/demo switch
js/app.js                       views and interactions
js/backend-demo.js              demo data layer (browser storage, no passwords)
js/backend-supabase.js          real data layer (same contract as the demo one)
supabase/migrations/            the database, in order; each file is applied to Supabase
supabase/drafts/                later-phase tables, tested to load but not deployed
supabase/functions/_shared/     branded email templates
supabase/templates/             sign-in emails for Supabase Auth
supabase/tests/                 automated tests and live-database checks
docs/                           spec, setup guide, email preview
```

There is no build step. The site is plain HTML, CSS and JavaScript, served by GitHub Pages from the `main` branch.

**When you change any script or the stylesheet,** bump the `?v=` number on the five asset tags in `index.html`. Browsers cache those files for a few minutes, and the number keeps a new page from running old code.

## Run it locally

```bash
python -m http.server 8791
```

Then open http://localhost:8791/. In demo mode, choose "Load sample data" in the yellow banner; the demo admin passcode is `c4c-draft`.

## Tests

The database rules are tested on a real Postgres engine that runs inside Node (PGlite), so no server is needed.

```bash
cd supabase/tests
```

```bash
npm install
```

```bash
npm test
```

The 48 tests cover who can see and change what (for example, that only the owner and admins can read a license number), the request and matching flow, the admin list, outreach rules, and every email template.

## Checking the live database

Two checks confirm that Supabase holds exactly what the tests ran against.

1. **Fingerprint.** Run `node fingerprint.mjs` in `supabase/tests`, then paste `fingerprint.sql` into the Supabase SQL editor. Every row (count and hash) should match.
2. **Walkthrough.** Paste `live-smoke.sql` into the SQL editor. It signs up test accounts, runs a request through to a confirmed date, checks the privacy rules, and rolls everything back. Success is a message that starts with `SMOKE OK (rolled back)`.

## Changing the database

1. Add a new file to `supabase/migrations/` (never edit one that has been applied).
2. Add or update tests, and run `npm test`.
3. Apply the file to Supabase (SQL editor or CLI), then repeat the two checks above.

## Security notes

- `js/config.js` holds the Supabase address and **publishable** key. Both are meant to be public. The secret key and the database password must never go in this repository.
- Signed-out visitors can do exactly two things with the database: read approved presenter profiles, and look up a request by tracking number plus email.
- Admin access comes from an allowlist in the database. A listed address becomes an admin only after confirming its email.
- Internal board material is kept out of this public repository (see `.gitignore`).

## Credits

Original concept and design by Stephanie Byrd, MS, LMFT (founder, C4C). Built by Aidan Meyers (Secretary).
