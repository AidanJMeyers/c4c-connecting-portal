// Connections 4 Change: branded email templates.
// Pure functions with no platform APIs, so the same file runs in the mail sender
// (Supabase Edge Function) and in the Node tests and preview builder.
//
//   renderEmail(template, payload, { siteUrl, contactEmail, theme }) -> { subject, html, text }
//
// `template` is the name stored in the email_outbox table; `payload` is that row's payload.
// Build rules (shared with C4C's board recap emails): table layout at 600px, inline styles
// only, colors set with bgcolor on cells, buttons as colored cells holding plain links,
// bullets as &#8226;, <b> instead of headings, explicit logo size, no hidden preheader,
// an Outlook font fallback, and no em dashes.

export const THEMES = {
  house:  { ink: "#1b3a5c", accent: "#3a6ea5", gray: "#5b6573", light: "#f3f6fa" },   // C4C email house style
  portal: { ink: "#2c6489", accent: "#2b7f83", gray: "#55686f", light: "#f3f7f8" }    // matches the portal's teal
};
const FONT = "'Times New Roman', Times, serif";
const LOGO = {
  src: "https://i0.wp.com/counselorsforchange.org/wp-content/uploads/2018/07/cropped-c4clogo1.png?fit=1536%2C579&ssl=1",
  width: 260, height: 98
};
const DEFAULTS = { siteUrl: "https://counselorsforchange.org/", contactEmail: "info@counselorsforchange.org", theme: "house" };

/* ---------------- formatting helpers ---------------- */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const list = a => (Array.isArray(a) ? a.filter(Boolean).join(", ") : "");
const firstName = n => String(n || "").split(",")[0].trim().split(/\s+/)[0] || "there";
function day(d) {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}
const windowText = p => (p.window_start ? `${day(p.window_start)} to ${day(p.window_end)}` : "");
function when(iso, tz) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: tz || "America/New_York", weekday: "long", month: "long", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
const requestFacts = p => [
  ["Tracking number", p.tracking_id], ["Session", p.event_type], ["Preferred window", windowText(p)],
  ["Audience", list(p.audiences)], ["Topics", list(p.topics)], ["Delivery", p.delivery]
];
const eventFacts = p => [
  ["When", when(p.event_starts_at, p.timezone)], ["Where", p.event_location], ["Session", p.event_type],
  ["Organization", p.org_name], ["Presenter", p.presenter_name], ["Tracking number", p.tracking_id]
];
const contact = (name, email) => (email ? { text: name ? `${name} (${email})` : email, href: `mailto:${email}` } : name);

/* ---------------- the templates ----------------
   Each returns { subject, heading, paragraphs, facts?, bullets?, button?, note? }.
   Everything is plain text; the layout escapes it. */
const TEMPLATES = {
  /* ----- presenters ----- */
  application_received: (p, x) => ({
    subject: "We received your presenter profile",
    heading: "Thank you for joining Connections 4 Change",
    paragraphs: [
      `Hi ${firstName(p.presenter_name)},`,
      "Your presenter profile is in. Counselors for Change will now verify your license and liability insurance. Most reviews take a few days.",
      "You'll get another email as soon as your profile is live in the directory. Until then you can sign in at any time to update your details."
    ],
    button: { label: "View my account", url: x.account }
  }),
  profile_approved: (p, x) => ({
    subject: "Your Connections 4 Change profile is live",
    heading: "You're in the directory",
    paragraphs: [
      `Hi ${firstName(p.presenter_name)},`,
      "Good news: your license and insurance are verified, and your profile is now public. Schools and community organizations can find you and request you by name.",
      "When a request comes in, or when Counselors for Change thinks you'd be a good fit for one, you'll get an email and it will appear in your account."
    ],
    bullets: ["Keep your availability and topics current.", "Update your insurance details when your policy renews.", "You only ever say yes to what fits your schedule."],
    button: { label: "See my profile", url: x.account }
  }),
  presenter_invited: (p, x) => ({
    subject: `A presenting opportunity: ${p.event_type || "session"} for ${p.org_name || "a local organization"}`,
    heading: "You're invited to present",
    paragraphs: [
      `${p.org_name || "A local organization"} is looking for a presenter, and you've been invited to respond.`,
      "Take a look at the details and let us know whether you're interested. Nothing is booked until you and the organization agree on a date."
    ],
    facts: requestFacts(p).slice(1),
    button: { label: "Respond in my account", url: x.account }
  }),
  connected_presenter: (p, x) => ({
    subject: `You're connected with ${p.org_name}`,
    heading: "You're connected",
    paragraphs: [
      `Thank you for saying yes. You're now connected with ${p.org_name} for their ${String(p.event_type || "session").toLowerCase()}.`,
      "Please reach out to the lead contact below to settle the exact date and time. Once you've agreed, either of you can record the date in your account, and you'll both get calendar links."
    ],
    facts: [["Lead contact", contact(p.lead_name, p.lead_email)], ["Preferred window", windowText(p)], ["Audience", list(p.audiences)], ["Tracking number", p.tracking_id]],
    button: { label: "Open the request", url: x.account },
    note: "As a reminder, presenters are independent professionals and present under their own professional liability insurance."
  }),
  /* ----- organizations ----- */
  intro_call_offer: (p, x) => ({
    subject: "Welcome to Connections 4 Change",
    heading: "Welcome, and let's say hello",
    paragraphs: [
      `Hi ${firstName(p.lead_name)},`,
      `Thank you for creating an account for ${p.org_name}. Since this is your first time working with Counselors for Change, we'd love to set up a quick 30 minute call to introduce ourselves, explain how presenters are verified, and hear what your community needs.`,
      "If you'd like that, just reply to this email with a few times that work for you. If you'd rather jump straight in, you can request a presenter right now."
    ],
    button: { label: "Request a presenter", url: x.site + "#request" }
  }),
  request_received: (p, x) => ({
    subject: `We received your request (${p.tracking_id})`,
    heading: "Your request is in",
    paragraphs: [
      `Hi ${firstName(p.lead_name)},`,
      `Thank you for your request on behalf of ${p.org_name}. Here is what we have.`
    ],
    facts: requestFacts(p),
    bullets: [
      "If you chose a presenter, they have been invited to accept.",
      "If not, Counselors for Change will invite the best-fit presenters, and you'll choose among those who are interested.",
      "Once you're connected, you and your presenter settle the exact date together."
    ],
    button: { label: "Follow my request", url: x.account },
    note: "Anyone copied on this email can check the status at any time with the tracking number and their email address."
  }),
  presenter_interested: (p, x) => ({
    subject: `A presenter is interested in your request (${p.tracking_id})`,
    heading: "A presenter is interested",
    paragraphs: [
      `Good news for ${p.org_name}: a verified presenter has said they're interested in your ${String(p.event_type || "session").toLowerCase()}.`,
      "Sign in to see their profile. When you choose a presenter, you'll be introduced by email so you can settle the date."
    ],
    button: { label: "Choose a presenter", url: x.account }
  }),
  connected_organization: (p, x) => ({
    subject: `You're connected with ${p.presenter_name}`,
    heading: "You're connected with your presenter",
    paragraphs: [
      `Hi ${firstName(p.lead_name)},`,
      `${p.presenter_name} will present your ${String(p.event_type || "session").toLowerCase()}. Please reach out to settle the exact date and time inside your preferred window.`,
      "Once you've agreed, either of you can record the date in your account, and you'll both get calendar links."
    ],
    facts: [["Presenter", contact(p.presenter_name, p.presenter_email)], ["Preferred window", windowText(p)], ["Tracking number", p.tracking_id]],
    button: { label: "Open my request", url: x.account },
    note: "Counselors for Change verifies each presenter's license and insurance. Your organization remains responsible for its own vetting, especially for events involving minors."
  }),
  /* ----- both sides ----- */
  event_confirmed: (p, x) => ({
    subject: `Date confirmed: ${p.event_type} for ${p.org_name}`,
    heading: "Your session is on the calendar",
    paragraphs: ["The date is set. The details are below, and calendar links are waiting in your account."],
    facts: eventFacts(p),
    button: { label: "Get calendar links", url: x.account }
  }),
  event_rescheduled: (p, x) => ({
    subject: `New date: ${p.event_type} for ${p.org_name}`,
    heading: "Your session has a new date",
    paragraphs: ["The date for this session was changed. Please update your calendar with the details below."],
    facts: eventFacts(p),
    button: { label: "Get calendar links", url: x.account }
  }),
  request_cancelled: (p, x) => ({
    subject: `Request cancelled: ${p.event_type} for ${p.org_name}`,
    heading: "This request was cancelled",
    paragraphs: [
      `${p.org_name} has cancelled their request for a ${String(p.event_type || "session").toLowerCase()}. No further action is needed.`,
      "Thank you for being willing to help. Other opportunities will appear in your account as they come in."
    ],
    facts: [["Tracking number", p.tracking_id]],
    button: { label: "View my account", url: x.account }
  }),
  /* ----- C4C admins ----- */
  admin_new_presenter: (p, x) => ({
    subject: `New presenter to review: ${p.presenter_name}`,
    heading: "A presenter is waiting for review",
    paragraphs: ["A new presenter profile was submitted. Please verify the license and insurance, then approve it so it appears in the directory."],
    facts: [["Presenter", contact(p.presenter_name, p.presenter_email)], ["License", [p.license_type, p.license_state].filter(Boolean).join(", ")]],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_reverify_presenter: (p, x) => ({
    subject: `Re-check needed: ${p.presenter_name} changed license details`,
    heading: "A live profile needs a re-check",
    paragraphs: ["This presenter changed their license details, so the profile was taken out of the directory until it is approved again."],
    facts: [["Presenter", contact(p.presenter_name, p.presenter_email)]],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_new_organization: (p, x) => ({
    subject: `New organization: ${p.org_name}`,
    heading: "A new organization joined",
    paragraphs: [p.prior_contact === false
      ? "This organization is new to Counselors for Change. They were automatically offered a 30 minute intro call, so watch for a reply."
      : "A school or organization created an account."],
    facts: [["Organization", p.org_name], ["Type", p.org_type], ["Lead contact", contact(p.lead_name, p.lead_email)]],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_new_request: (p, x) => ({
    subject: `New request (${p.tracking_id}): ${p.event_type} for ${p.org_name}`,
    heading: "A new request came in",
    paragraphs: ["If the organization chose a presenter, that presenter has been invited. Otherwise, open the dashboard to see suggested presenters and send invitations."],
    facts: [["Organization", p.org_name], ["Lead contact", contact(p.lead_name, p.lead_email)], ...requestFacts(p)],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_needs_matching: (p, x) => ({
    subject: `Needs matching (${p.tracking_id}): ${p.org_name}`,
    heading: "A request needs a presenter",
    paragraphs: ["The presenter this organization asked for was not available. Please open the dashboard to invite other presenters."],
    facts: [["Organization", p.org_name], ...requestFacts(p)],
    button: { label: "Suggest presenters", url: x.admin }
  }),
  admin_presenter_interested: (p, x) => ({
    subject: `Presenter interested (${p.tracking_id}): ${p.org_name}`,
    heading: "A presenter said yes",
    paragraphs: ["An invited presenter is interested. The organization has been told and can now choose."],
    facts: [["Organization", p.org_name], ["Tracking number", p.tracking_id]],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_connection: (p, x) => ({
    subject: `New connection: ${p.presenter_name} and ${p.org_name}`,
    heading: "A new connection was made",
    paragraphs: ["These two have been introduced and will settle the date directly. This is a good moment for a personal note if you'd like to send one."],
    facts: [["Presenter", contact(p.presenter_name, p.presenter_email)], ["Organization", p.org_name], ["Lead contact", contact(p.lead_name, p.lead_email)],
      ["Session", p.event_type], ["Tracking number", p.tracking_id]],
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_event_confirmed: (p, x) => ({
    subject: `Date confirmed (${p.tracking_id}): ${p.org_name}`,
    heading: "A session date was confirmed",
    paragraphs: ["The organization and presenter agreed on a date."],
    facts: eventFacts(p),
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_event_rescheduled: (p, x) => ({
    subject: `Date changed (${p.tracking_id}): ${p.org_name}`,
    heading: "A session date was changed",
    paragraphs: ["The date for this session was updated."],
    facts: eventFacts(p),
    button: { label: "Open the dashboard", url: x.admin }
  }),
  admin_request_cancelled: (p, x) => ({
    subject: `Request cancelled (${p.tracking_id}): ${p.org_name}`,
    heading: "A request was cancelled",
    paragraphs: ["The organization cancelled this request. Any presenter involved has been told."],
    facts: [["Organization", p.org_name], ["Session", p.event_type], ["Presenter", p.presenter_name], ["Tracking number", p.tracking_id]],
    button: { label: "Open the dashboard", url: x.admin }
  })
};
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/* ---------------- layout ---------------- */
const cleanFacts = facts => (facts || []).filter(f => f && f[1] !== undefined && f[1] !== null && f[1] !== "" && !(f[1] && f[1].text === ""));

// The email body as one table (used directly by the preview page).
export function bodyHtml(c, themeName = "house") {
  const t = THEMES[themeName] || THEMES.house;
  const td = (pad, extra, inner) => `<tr><td style="padding:${pad};font-family:${FONT};${extra}">${inner}</td></tr>`;
  const facts = cleanFacts(c.facts);
  const rows = [];
  rows.push(`<tr><td align="center" bgcolor="#ffffff" style="padding:26px 32px 18px;"><img src="${LOGO.src}" width="${LOGO.width}" height="${LOGO.height}" alt="Counselors for Change" style="display:block;border:0;"></td></tr>`);
  rows.push(`<tr><td bgcolor="${t.ink}" style="padding:10px 32px;font-family:${FONT};font-size:13px;letter-spacing:2px;color:#ffffff;">CONNECTIONS 4 CHANGE</td></tr>`);
  rows.push(td("28px 32px 6px", `font-size:24px;line-height:30px;color:${t.ink};`, `<b>${esc(c.heading)}</b>`));
  (c.paragraphs || []).forEach(p => rows.push(td("8px 32px", "font-size:16px;line-height:24px;color:#222222;", esc(p))));
  if (facts.length) {
    rows.push(`<tr><td style="padding:14px 32px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.light}">` +
      facts.map(([k, v]) => `<tr><td width="150" valign="top" style="padding:9px 12px 9px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:${t.gray};">${esc(k)}</td>` +
        `<td valign="top" style="padding:9px 16px 9px 0;font-family:${FONT};font-size:15px;line-height:20px;color:#222222;">` +
        (v && v.href ? `<a href="${esc(v.href)}" style="color:${t.accent};">${esc(v.text)}</a>` : `<b>${esc(v)}</b>`) + `</td></tr>`).join("") +
      `</table></td></tr>`);
  }
  if ((c.bullets || []).length) {
    rows.push(`<tr><td style="padding:10px 32px 2px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      c.bullets.map(b => `<tr><td width="18" valign="top" style="font-family:${FONT};font-size:16px;line-height:24px;color:${t.accent};">&#8226;</td>` +
        `<td valign="top" style="padding-bottom:6px;font-family:${FONT};font-size:16px;line-height:24px;color:#222222;">${esc(b)}</td></tr>`).join("") +
      `</table></td></tr>`);
  }
  if (c.button) {
    rows.push(`<tr><td style="padding:18px 32px 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td bgcolor="${t.accent}" style="padding:12px 26px;"><a href="${esc(c.button.url)}" style="font-family:${FONT};font-size:16px;color:#ffffff;text-decoration:none;"><b>${esc(c.button.label)}</b></a></td>` +
      `</tr></table></td></tr>`);
  }
  if (c.note) rows.push(td("12px 32px 4px", `font-size:14px;line-height:20px;color:${t.gray};`, esc(c.note)));
  rows.push(td("20px 32px 26px", "font-size:16px;line-height:24px;color:#222222;", "With gratitude,<br><b>Counselors for Change</b>"));
  rows.push(`<tr><td bgcolor="${t.light}" style="padding:18px 32px;font-family:${FONT};font-size:13px;line-height:19px;color:${t.gray};">` +
    `Counselors for Change, Inc. &#183; <a href="https://counselorsforchange.org" style="color:${t.gray};">counselorsforchange.org</a><br>` +
    `Questions? Just reply to this email${c.contactEmail ? ` or write to <a href="mailto:${esc(c.contactEmail)}" style="color:${t.gray};">${esc(c.contactEmail)}</a>` : ""}.</td></tr>`);
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;border:1px solid #dfe5ec;">${rows.join("")}</table>`;
}

function documentHtml(c, themeName) {
  const t = THEMES[themeName] || THEMES.house;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(c.subject)}</title><!--[if mso]><style>td,p,a,b,span{font-family:'Times New Roman',Times,serif !important;}</style><![endif]--></head>` +
    `<body style="margin:0;padding:0;background-color:${t.light};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.light}"><tr><td align="center" style="padding:24px 12px;">` +
    bodyHtml(c, themeName) + `</td></tr></table></body></html>`;
}

function plainText(c) {
  const facts = cleanFacts(c.facts).map(([k, v]) => `${k}: ${v && v.text ? v.text : v}`);
  return [c.heading, "", ...(c.paragraphs || []).flatMap(p => [p, ""]), ...facts, facts.length ? "" : null,
    ...(c.bullets || []).map(b => `- ${b}`), (c.bullets || []).length ? "" : null,
    c.button ? `${c.button.label}: ${c.button.url}` : null, c.button ? "" : null, c.note || null, c.note ? "" : null,
    "With gratitude,", "Counselors for Change", "counselorsforchange.org"].filter(x => x !== null).join("\n");
}

export function emailContent(template, payload = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, make = TEMPLATES[template];
  if (!make) throw new Error(`Unknown email template: ${template}`);
  const site = o.siteUrl.replace(/#.*$/, "");
  return { ...make(payload || {}, { site, account: site + "#account", admin: site + "#admin" }), contactEmail: o.contactEmail };
}

export function renderEmail(template, payload = {}, opts = {}) {
  const theme = opts.theme || DEFAULTS.theme, c = emailContent(template, payload, opts);
  return { subject: c.subject, html: documentHtml(c, theme), text: plainText(c) };
}

/* ---------------- sign-in emails ----------------
   Supabase sends these itself (confirm sign-up, reset password, change email). They use the
   same layout; {{ .ConfirmationURL }} is filled in by Supabase. Paste each into
   Authentication > Email Templates, or load them with the setup script. */
export function authEmails(opts = {}) {
  const o = { ...DEFAULTS, ...opts }, link = "{{ .ConfirmationURL }}";
  const make = c => ({ subject: c.subject, html: documentHtml({ ...c, contactEmail: o.contactEmail }, o.theme) });
  return {
    confirmation: make({
      subject: "Confirm your email for Connections 4 Change",
      heading: "One quick step: confirm your email",
      paragraphs: ["Thanks for creating an account with Connections 4 Change, a Counselors for Change initiative.",
        "Please confirm that this is your email address. Open the link on the same device you signed up on, and we'll finish setting up your account."],
      button: { label: "Confirm my email", url: link },
      note: "If you didn't create this account, you can ignore this email."
    }),
    recovery: make({
      subject: "Reset your Connections 4 Change password",
      heading: "Reset your password",
      paragraphs: ["We received a request to reset the password for your Connections 4 Change account. Choose a new one with the button below."],
      button: { label: "Choose a new password", url: link },
      note: "If you didn't ask for this, you can ignore this email and your password will stay the same."
    }),
    email_change: make({
      subject: "Confirm your new email for Connections 4 Change",
      heading: "Confirm your new email address",
      paragraphs: ["You asked to change the email on your Connections 4 Change account. Please confirm the new address."],
      button: { label: "Confirm new email", url: link },
      note: "If you didn't ask for this, please reply to let us know."
    }),
    invite: make({
      subject: "You're invited to Connections 4 Change",
      heading: "You're invited",
      paragraphs: ["Counselors for Change has invited you to Connections 4 Change, where licensed mental health professionals connect with schools and community organizations.",
        "Use the button below to set up your account."],
      button: { label: "Accept the invitation", url: link }
    })
  };
}
