# Counselors for Change: Connecting Portal (draft)

This portal connects licensed therapists, counselors and psychologists with schools and community organizations. Through Counselors for Change (C4C) they can arrange panels, workshops, psychoeducation sessions and staff trainings.

> **Status: draft / prototype.** Submissions are saved **only in the browser that submitted them** (localStorage). Visitors on other devices won't see each other's data yet. A shared backend is the next milestone; see [ROADMAP.md](ROADMAP.md).

## What it does today

| Area | Features |
|---|---|
| **Counselors** | Sign-up form with public and private fields, license info, expertise, audiences, session formats, delivery, availability windows and notice period. New profiles wait for admin approval before going public. |
| **Directory** | Text search, expertise and audience filters, virtual/in-person filter, a "Verified" badge, and a "Request this speaker" button on each profile. |
| **Schools / orgs** | Request form with 2–3 proposed times (timezone-aware), audience, topics, attendee count and an optional support/donation tier. No payment is taken. |
| **Scheduling** | The counselor gets a private confirm link, picks a time or declines, and both sides get Google Calendar and `.ics` links. Times are converted correctly across timezones. |
| **Admin (board)** | Passcode gate, KPI tiles, approve/reject/unlist counselors, assign counselors to unmatched requests, request status pipeline, copy confirm links, CSV exports, JSON backup and sample data for demos. |
| **Privacy** | A draft Privacy & Terms page with a public/private field table. Needs attorney review before launch. |

## Run it locally

No build step is needed. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

The draft admin passcode is `c4c-draft`. Change it in `js/config.js`; instructions are in the file.

## Project layout

```
index.html          page markup (all views)
css/styles.css      C4C brand styles
js/config.js        site settings + dropdown/chip option lists (edit these)
js/storage.js       storage adapter: swap this for a real backend
js/app.js           app logic
ROADMAP.md          phased feature plan
```

## Known limits of the draft

- **No shared database.** Data is per-browser, so confirm links only work in the browser that holds the request.
- **The admin passcode is client-side.** It keeps casual visitors out, but it is not real security. Don't put real license numbers or contact details into a public deployment until the backend and real auth exist.
- **Email notifications** (EmailJS) are wired in but switched off. To turn them on, fill in `emailjs` in `js/config.js`.

## Credits

The original design and concept come from Stephanie Byrd, MS, LMFT (founder, C4C). Aidan Meyers (Secretary) restructured it for the repo.
