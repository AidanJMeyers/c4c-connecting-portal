# Roadmap

The full feature description is in [docs/SPEC.md](docs/SPEC.md), written from the 11/15/26 board work session. Earlier board-minutes ideas are tracked in an internal document that is kept out of this public repo.

## Phase 0: Clickable prototype ✅
Data stays in each visitor's browser. It is good for demos and feedback, and not for real sign-ups.

- Presenter sign-up with public and private fields, admin approval, and a searchable directory
- Organization request form and a board admin dashboard with CSV export
- **Added after the 11/15 session:**
  - Renamed to Connections 4 Change
  - Private liability insurance fields and a "C4C does not insure presenters" acknowledgment
  - Optional once-a-year commitment
  - 30-day default notice
  - Preferred date *window*, with exact times optional
  - CC emails
  - "New to C4C?" question that flags an intro call
  - Request tracking numbers with a status lookup
  - Top-5 suggested presenters in the admin view
  - "Connect us" acceptance, so both sides settle the date directly

## Phase 1: Accounts and shared database
This is the step that makes the portal real. The database design is drafted in [db/schema.sql](db/schema.sql).

- [ ] **Board:** create the backend project (Supabase is proposed; the free tier covers this scale) and choose an email-sending service.
- [ ] Presenter accounts: the sign-up form creates the account and emails a set-your-password link; presenters edit their own profile.
- [ ] Organization accounts: one lead-contact login per organization, plus CC emails.
- [ ] Board admin accounts, replacing the shared passcode.
- [ ] Move directory, requests and admin onto the shared database.
- [ ] Automatic emails, all logged for admins:
  - Request received (with tracking number)
  - Intro-call offer for new organizations
  - Presenter invitations
  - Connection alerts to C4C

## Phase 2: Verification and upkeep
- [ ] Automated license check against state licensing-board data, with a monthly recheck. Admins are emailed only when something fails.
- [ ] Insurance expiry reminders.
- [ ] "Anything changed?" profile check-in email every two months.
- [ ] Richer profiles: headshot, CV, workshops presented.

## Phase 3: Events and materials
- [ ] Event page per confirmed session (topic, date, slides, handouts), shared automatically with the organization.
- [ ] File uploads, a C4C template deck (opening and closing slides) and a branding guide.
- [ ] Shared resource bank: C4C's existing workshops, plus presenter uploads with opt-in sharing.
- [ ] Automatic "please attach your slides" reminders.

## Phase 4: Feedback and impact
- [ ] A QR code per event for attendee feedback.
- [ ] Automatic post-event surveys to the organization and the presenter.
- [ ] Dashboards for presenters and C4C: people reached, hours, top contributors, engaged organizations.
- [ ] One-page annual impact statement.

## Phase 5: Growth
- [ ] Recruiting email campaign to local licensed professionals.
- [ ] News feed ("What C4C has been up to") and board update summaries.
- [ ] Paid workplace and corporate sessions.
- [ ] Link from counselorsforchange.org and a custom URL.

## Needs a board decision or outside review
See section 9 of the spec. The most pressing items:
- Legal review of the terms and liability acknowledgment.
- Minimum insurance limits.
- Whether the annual commitment is required.
- Mission scope (schools only, or the wider community).
- The client-facing therapist directory remains paused under the board's July decision. This build covers speaker matching only.
