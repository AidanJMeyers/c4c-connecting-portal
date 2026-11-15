# Roadmap

This roadmap draws on the features the board raised in past minutes, which are compiled in an internal board document (`docs/proposed-features-from-minutes.md`, kept out of this public repo); IDs such as `M2` refer to that file. It will be refined once the voice-memo transcript from the 11/15/26 work session is added.

## Phase 0: Draft prototype ✅ (this commit)
- Two-sided speaker matching: counselor sign-up and directory, plus school/org requests (`M1`, `M2`, `S1`, `C1`, `C2`).
- Availability, lead time and session formats on profiles (`C2`, `M3`).
- Topic interest chips on requests (partly covers `S2`).
- Leveled donation tiers. These record intent only; no payment is taken (`D1`).
- License verified before listing, using an admin approve/reject queue (`P3`).
- Counselor confirm link, plus Google Calendar and `.ics` invites.
- Admin dashboard with CSV export (partly covers `A7`).

## Phase 1: Shared backend (needed before real data goes in)
- [ ] Choose the system of record (`A1`). Candidates are Supabase, Firebase or Airtable. The board also needs to settle how this relates to the CRM decision (`A3`) and the Constant Contact migration (`A4`).
- [ ] Swap `js/storage.js` for API calls, and protect private fields server-side.
- [ ] Real admin login for board members, replacing the client-side passcode (`A5`).
- [ ] Email notifications: new sign-up, new request, confirmed booking, request acknowledged within 5 business days (`S5`, `M4`).
- [ ] Host on GitHub Pages or Netlify and link it from counselorsforchange.org (`O1`).

## Phase 2: Profile upkeep and intake
- [ ] Counselors log in to view and correct their own profiles (`C4`).
- [ ] Periodic "is your profile still current?" emails (`C5`).
- [ ] Expand the sign-up to match the Clinical Member Application F-05: insurance, references, capacity per year (`C6`).
- [ ] Annual presenting commitment checkbox (`C3`). The board must first decide who it applies to.
- [ ] A prepared presentation-topic dropdown on requests (`S2`).
- [ ] Organization accounts and profiles (`S3`), plus yearly PTA and principal check-ins (`S4`).
- [ ] Score requests against the board's three priorities in the admin view (`S6`).

## Phase 3: Donations and reporting
- [ ] Real donation links with automatic tax-deductible receipts (`D2`), after confirming charitable solicitation registration.
- [ ] Organization memberships (`D3`), if the board adopts them.
- [ ] Attendee feedback form F-02 and event debrief form F-03, both feeding a metrics dashboard (`A7`–`A9`).
- [ ] Partner register (`A12`).

## Phase 4: Resources and content
- [ ] "How to Get Help" resources page with external directories and free or low-cost options labeled (`R1`, `R5`).
- [ ] Talks and lessons repository linked to past events (`R6`).
- [ ] Member headshots with the workshops each member has presented (`C9`).

## Held: needs a board decision first
- **Client-facing therapist directory** (`M6`, `C7`, `C8`). This is paused under decision D-07 until a written feasibility and liability review is done (`P1`). Publishing a vetted list also requires a board vote (`P2`). The current build is speaker matching only.
- **Hold-harmless paperwork for matches** (`P4`) needs attorney review.
