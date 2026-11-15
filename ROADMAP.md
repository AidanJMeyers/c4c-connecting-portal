# Roadmap

What the portal should do is described in [docs/SPEC.md](docs/SPEC.md), written from the 11/15/26 board work session. Step-by-step setup is in [docs/SETUP.md](docs/SETUP.md). Earlier board-minutes ideas are tracked in an internal document kept out of this public repo.

## Done

### Accounts and shared database
- [x] Supabase project created and the database loaded, with 48 automated tests and a check that the live database matches the tested one.
- [x] Presenter accounts and profiles. License and insurance details are private; changing license details triggers a re-check.
- [x] Organization accounts: one lead contact, optional CC emails, and an intro-call flag for first-timers.
- [x] Admin access by allowlist, granted only after email confirmation.
- [x] Requests with tracking numbers and a public status lookup.
- [x] Matching: request a presenter by name, or admin-ranked suggestions, invitations, "I'm interested", and the organization chooses.
- [x] Either side records the agreed date; both get calendar links. The presenter records turnout afterwards.
- [x] Admin dashboard: review queue, insurance verification, requests, organizations, and a log of every queued email.
- [x] Demo mode, so the public site can be clicked through safely before launch.

### Email
- [x] Branded templates for all 22 portal emails and 4 sign-in emails ([preview](docs/email-preview.html)).
- [x] Every email is written to a queue the admins can see.

### Outreach (scaffold)
- [x] Contact list that records where each address came from.
- [x] Campaign drafts with starter text, a preview in the real layout, and a test send.
- [x] Queueing that skips unsubscribed contacts and existing members, and never emails the same campaign twice.
- [x] Unsubscribe link and mailing address on every outreach email.

## Next: switch it on
See [docs/SETUP.md](docs/SETUP.md) for the steps.

- [ ] **Board:** app password for the info@ mailbox, entered in Supabase (sign-in emails start working).
- [ ] Paste the branded sign-in email templates into Supabase.
- [ ] First admin sign-in and a live run-through with real accounts.
- [ ] Mail sender: a scheduled function that delivers the queue through the info@ mailbox.
- [ ] **Board:** attorney review of Privacy & Terms and the presenter acknowledgment.
- [ ] Set `live: true` and link the portal from counselorsforchange.org.

## Then

### Verification and upkeep
- [ ] Automated license check against state licensing data, with a monthly recheck. Admins hear about it only when something fails.
- [ ] Insurance expiry reminders by email (the dashboard already flags expired and soon-to-expire policies).
- [ ] "Anything changed?" profile check-in email every two months.
- [ ] Richer profiles: headshot, CV, sessions presented.

### Events and materials
The tables are drafted in `supabase/drafts/` and load cleanly; the screens are not built.
- [ ] Event page per confirmed session, shared with the organization.
- [ ] File uploads, a C4C template deck (opening and closing slides) and a branding guide.
- [ ] Shared resource bank with opt-in sharing.
- [ ] Automatic "please attach your slides" reminders.

### Feedback and impact
- [ ] A QR code per event for attendee feedback.
- [ ] Post-event surveys for the organization and the presenter.
- [ ] Impact dashboard and a one-page annual impact statement.

### Growth
- [ ] Outreach: choose the contact source, then run the first presenter invitation.
- [ ] News feed and board update summaries.
- [ ] Paid workplace and corporate sessions.

## Needs a board decision or outside review
See section 9 of the spec. The most pressing:
- Legal review of the terms and liability acknowledgment.
- Minimum insurance limits. The form collects limits but enforces no minimum.
- Whether the yearly presenting commitment is required. It is optional today.
- Where outreach contacts come from.
- Mission scope: schools only, or the wider community.
- The client-facing therapist directory remains paused under the board's July decision. This build covers speaker matching only.
