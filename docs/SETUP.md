# Setup: what is done and what is left

Last updated 2026-11-15.

## Done

- **Supabase project** `connections-4-change` in the "Counselors for Change" organization, free plan, US East. Address: `https://znzmqrrocikuxoesvaxc.supabase.co`.
- **Database loaded:** migrations `core`, `admin_allowlist`, `harden_api_surface` and `outreach`. The live database matches the tested one (fingerprint check in the README).
- **Admin list:** kept in the database only (table `admin_allowlist`), never in this public repository. Anyone on it becomes an admin automatically after signing up and confirming their email. To see who is on it, run `select email from admin_allowlist;` in the Supabase SQL editor.
- **Sign-up requires email confirmation.** This is on by default and the admin list depends on it. Leave it on.
- **Portal wired to the project,** with the public switch off. Visitors get demo mode; `?live=1` uses the real database.

## Left to do, in order

### 1. Email sending through info@counselorsforchange.org

Until this is done, Supabase's built-in mailer delivers only to the email addresses of the Supabase organization's own team members, with a low hourly limit. Supabase's documentation says it is not meant for production use. Real presenters and schools would never get their confirmation email.

This step assumes C4C's mail is Google Workspace.

1. Sign in to Google as `info@counselorsforchange.org`.
2. Turn on 2-Step Verification if it is off (Google Account, Security).
3. Create an **app password** (Google Account, Security, App passwords). Name it "Connections 4 Change portal". Google shows a 16-character password once.
4. In Supabase: Authentication, Emails, SMTP Settings. Turn on "Enable custom SMTP" and enter:
   - Sender email: `info@counselorsforchange.org`
   - Sender name: `Counselors for Change`
   - Host: `smtp.gmail.com`
   - Port: `587` (if that fails, try `465`)
   - Username: `info@counselorsforchange.org`
   - Password: the app password from step 3
5. Keep the app password out of chat, email and this repository. If it is ever exposed, delete it in Google and create a new one.
6. Once custom SMTP is saved, Supabase starts the project at 30 emails an hour. That is plenty for now; it can be raised under Authentication, Rate Limits.

That covers the sign-in emails. The portal's own emails (request received, invitations, connections and so on) wait in a queue until the mail sender is built; see step 4.

### 2. Branded sign-in emails

In Supabase: Authentication, Emails, Templates. For each of the four templates, paste the subject and HTML from the matching file in `supabase/templates/`:

| Supabase template | File |
|---|---|
| Confirm signup | `confirmation.html` |
| Reset password | `recovery.html` |
| Change email address | `email_change.html` |
| Invite user | `invite.html` |

The subject is on the first line of each file.

### 2b. Where email links should land (required)

Supabase starts every project with the site address set to `http://localhost:3000`. Until this is changed, the link in a confirmation or password-reset email sends people to a page that does not exist.

In Supabase: Authentication, URL Configuration.

- **Site URL:** `https://aidanjmeyers.github.io/c4c-connecting-portal/`
- **Redirect URLs**, add both:
  - `https://aidanjmeyers.github.io/c4c-connecting-portal/**` (covers the address with `?live=1` on the end)
  - `http://localhost:8791/**` (for testing on your own computer)

When the portal moves to its final address, update both.

### 3. First sign-in and a live test

1. Open the portal with `?live=1`, go to Sign in, and open "C4C board or staff? Create your sign-in". Use an address on the admin list.
2. Confirm the email. You land on your account page and the Admin tab appears.
3. Create a second account as a presenter and a third as an organization (any addresses you control), and run one request through: approve the presenter, request them, accept, set a date.
4. In the Admin tab, check the Emails list. Each step should have queued the right messages.

### 4. Mail sender for the portal's own emails

To build next. A small scheduled function reads the queue (`email_outbox`), renders each message with the branded templates (`supabase/functions/_shared/emails.js`), sends it through the same info@ mailbox, and marks it sent. It will need the app password stored as a Supabase secret, and a sending limit that stays well under Google's daily cap.

### 5. Outreach

1. In the Admin tab, Outreach, enter C4C's mailing address. Campaigns cannot be queued without it.
2. Add contacts, noting where each batch came from.
3. Draft a campaign (there is starter text), preview it, and send yourself a test.
4. Queue it. Emails go out once step 4 is done.

Decide the contact source before importing anyone. Public state licensing data is the safer choice; copying listings from directory websites may break their terms of use.

### 6. Go live

1. Attorney review of the Privacy & Terms page and the presenter acknowledgment.
2. In `js/config.js`, set `live: true` and push. The public site then uses the real database for everyone.
3. Link the portal from counselorsforchange.org.

## Everyday admin tasks

**Add an admin** (Supabase SQL editor):

```sql
insert into admin_allowlist (email) values ('someone@counselorsforchange.org');
```

They become an admin as soon as they have a confirmed account.

**Remove an admin:**

```sql
delete from admin_allowlist where email = 'someone@counselorsforchange.org';
update profiles set role = 'professional' where email = 'someone@counselorsforchange.org';
```

**Delete someone's account entirely:** Supabase, Authentication, Users, delete the user. Their profile and private details are removed with it. A presenter who has sessions on record cannot be deleted this way; pause the profile instead so impact numbers stay intact.

## What Supabase's security advisor will still list

The advisor warns about functions that signed-in users can call with elevated rights. Those are the portal's actions (accept a request, choose a presenter, cancel, set a date, and so on). Each one checks who is calling before it does anything, and the automated tests cover those checks. Signed-out visitors can call only two: the tracking lookup and unsubscribe.
