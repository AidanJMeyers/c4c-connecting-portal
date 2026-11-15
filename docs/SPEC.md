# Connections 4 Change: Product Spec (v0.2)

Connections 4 Change is a platform by Counselors for Change (C4C). It connects licensed mental health professionals with schools, and later other organizations, for panels, workshops and psychoeducation sessions.

This spec is based on the board work session of 11/15/26. Items marked **[Decide]** still need a board decision.

## 1. Principles

- **C4C connects; it does not gatekeep.** Think of it like a dating app: organizations browse verified professionals and choose. C4C verifies licenses and insurance, then steps back. C4C still gets visibility, so it can reach out and support people.
- **Automate the follow-up.** Reminders, resource sharing, surveys and status checks are sent by the system, not chased by a board member.
- **Therapist autonomy.** C4C provides a template, branding and a resource bank. Presenters own the content of their talk.
- **Same brand.** This is a separate app linked from counselorsforchange.org (for example a "Get involved" button, and a URL path under the C4C site). It gets no new logo.

## 2. Users and accounts

| Role | How they get an account | What they can do |
|---|---|---|
| **Professional** (therapist, counselor, psychologist, supervised intern) | Fills out the sign-up form. The system creates the account and emails a link to set a password. | Edit their own profile; see requests and events; upload or choose slides and resources; see their feedback |
| **Organization lead contact** (school first) | Self sign-up: organization, lead contact and optional CC emails. One login per organization for now; multi-member organizations come later. | Submit and track requests; browse the directory; see event pages, materials and feedback |
| **CC contacts** | No login. Added by the lead contact. | Copied on all request and event emails |
| **C4C admin** (board) | Invited by an admin | Verify, moderate, match-assist, view all emails, analytics |

**On organization sign-up:** ask "Have you worked with or talked to anyone at C4C?" If the answer is no, the system automatically emails an offer of a 30-minute intro call with C4C.

## 3. Professional onboarding and verification

1. **Sign-up form**, about 5 minutes:
   - Name, contact, license type, state and number
   - Expertise, audiences, formats (panel, workshop, psychoeducation)
   - General availability windows. Minimum notice defaults to **30 days**.
   - Short bio
2. **Liability insurance (required, private):** carrier, policy number, per-occurrence and aggregate limits, and expiration date. **[Decide]** the minimum limits; a $3M aggregate was mentioned but needs confirming.
3. **Acknowledgments** (wording needs legal review):
   - C4C's liability insurance does not cover the presenter.
   - The presenter carries their own professional liability coverage.
   - C4C verifies licenses but does not otherwise vet or supervise.
   - The presenter will give at least one presentation a year if called. **[Decide]** whether this applies to everyone.
4. **Automated license check:**
   - Match the license number against the state licensing board's public data. In Florida that is the DOH MQA license lookup and data download, refreshed monthly.
   - Optionally confirm the Psychology Today verified badge.
   - Admins are **emailed only if the check fails or is ambiguous**.
   - Licenses are re-checked monthly, and lapsed licenses are hidden automatically.
5. **Approved:** the profile goes public in the directory.
6. **Profile:** grows over time like a social profile. It can include a headshot, a CV link, a practice website, workshops presented on the platform (filled in automatically) and resources contributed.
7. **Upkeep:** every 2 months, an email says "anything changed?" with a one-click update link. No reply means nothing changed.

## 4. Requests and connection

1. The organization creates a request with:
   - Topic or content
   - Audience (students, parents, teachers or staff)
   - Age or grade range
   - Group size
   - Event type
   - A preferred date **window**. Exact dates are not required.
   - Format, location, and an optional support level
   - Optionally, a specific professional chosen from the directory
2. Every request gets a **tracking number**. The organization sees its status in its account.
3. If no professional was chosen, the system **suggests up to 5 candidates** ranked by topic, audience, format and notice period. An admin reviews them, and with one click the system emails all five: "a school wants X in month Y; are you interested?"
4. When a professional accepts, both sides are **introduced** and work out the exact date directly. Professionals list availability *windows*, not fixed days, because they usually rearrange clients for a confirmed event.
5. **C4C is alerted** at each step (new connection, date confirmed, cancelled). Every system email is logged, and admins can read them.

Expected volume is low at first, around 5 connections a year. Admin-assisted matching is fine.

## 5. Event page and materials

When a date is confirmed, an **event page** is created and shared with the organization (lead and CCs) and the presenter. It shows:
- Topic, date, time and location
- Slides and handouts (view and download)
- Resources
- The attendee feedback QR code

**Materials:**
- **Template deck:** C4C opening slide (who C4C is) and closing slide (resources plus feedback QR). The presenter fills in the middle.
- **Branding guide:** written to be uploaded to an AI tool, so presenters can brand their slides automatically.
- **Resource bank:** C4C's existing workshop decks and handouts, curated. When presenters upload their own, they are asked whether to add them to the shared bank.
- **Generated handouts:** each workshop in the bank gets a companion handout.

**Reminders:** if no slides are attached by the deadline, the presenter gets an automatic reminder. **[Decide]** the deadline and reminder schedule; 24 hours before was suggested as the final cutoff.

## 6. Feedback and impact

- **Attendee feedback:** each event gets its own QR code and short form. Results appear on the presenter's and C4C's dashboards.
- **Post-event surveys:**
  - Organization about the presenter and session.
  - Presenter about the organization: how accommodating it was, suggestions, challenges and needs.
- **Analytics:**
  - People reached (by audience and age)
  - Events
  - Presenter hours and top contributors
  - Engaged organizations
  - Feedback scores and repeat requests
- **Annual one-page impact statement** generated from the analytics.

## 7. Outreach and community

- **Recruiting campaign:** a professional email inviting local licensed professionals to join. It explains:
  - What C4C is and the formats offered
  - What members get: visibility and free marketing, a way to give back, access to schools (valuable for newer clinicians and interns), and a ready-made resource bank
  - The commitment involved
  - That the form takes 5 minutes
  - The future vision, including workplaces
- **Lead source [Decide]:** public licensing-board data is preferred. Scraping directory sites may break their terms of service.
- **Optional community features:**
  - A "What C4C has been up to" news feed
  - Board meeting update summaries
  - Invitations for members to join C4C meetings

## 8. Money

- Organizations choose a support level. No payment happens in the app yet.
- Presenters are currently unpaid volunteers. Paying them is a future goal once the work is sustainable.
- **Future:** workplace and corporate sessions are a paid tier. This will be mentioned as part of the vision but not built now.

## 9. Open decisions for the board

1. **Mission scope:** schools only, or community, college and workplace audiences too? This affects the site wording.
2. **Legal review:**
   - Terms of use and liability acknowledgment
   - Privacy policy
   - Whether C4C needs hold-harmless agreements with schools
3. **Minimum liability insurance** limits.
4. **Annual presentation commitment:** required, or encouraged?
5. **Slide deadline** and reminder timing.
6. **Admin access to messages:** CC'd on everything, or alerts plus a log?
7. **Hosting and backend:** see `ROADMAP.md`.

## 10. Technical needs

| Need | Proposed |
|---|---|
| Accounts and sign-in (email + password and magic link) | Supabase Auth |
| Database with per-role access rules | Supabase Postgres with row-level security (`db/schema.sql`) |
| File storage (slides, handouts, headshots, CVs) | Supabase Storage (private buckets with signed links) |
| Automated email, logged | Resend or Postmark, called from Supabase Edge Functions |
| Scheduled jobs (reminders, bi-monthly updates, monthly license checks, surveys) | Supabase cron (pg_cron) and Edge Functions |
| QR codes | Generated per event from the feedback URL |
| Hosting | GitHub Pages now; a custom domain or subpath under counselorsforchange.org later |
