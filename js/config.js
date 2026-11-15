/* Connections 4 Change: site configuration. Edit before publishing. */
window.C4C_CONFIG = {
  // Backend. Leave both empty to run in demo mode (data stays in this browser).
  // Both values are safe to publish: the database's own rules decide who can see what.
  supabaseUrl: "",
  supabaseKey: "",     // the project's "publishable" (anon) key, never the secret/service key

  contactEmail: "info@counselorsforchange.org",
  minPasswordLength: 8,

  // Demo mode only: SHA-256 hash of the passcode that opens the demo admin view ("c4c-draft").
  // This is a curtain for demos, not security. With a real backend, admins sign in instead.
  demoAdminPasscodeHash: "15acd5bd59c08c23cc3a9015e9e81e2f31786187352164e683a4fac612825116"
};

window.C4C_OPTIONS = {
  EXPERTISE: ["Anxiety & Stress","Depression & Mood","Grief & Loss","Trauma & PTSD","Substance Use & Recovery",
    "Relationships & Family","LGBTQ+ Affirming Care","Youth & Adolescent Mental Health","Suicide Prevention",
    "Burnout & Workplace Stress","Identity & Self-Esteem","Parenting Support","Body Image & Eating Concerns",
    "Neurodivergence (ADHD/Autism)","Crisis Response","Bullying & Social Media"],
  AUDIENCES: ["K-12 Students","College / University Students","Parents & Caregivers","Educators & School Staff",
    "Corporate / Workplace Groups","Faith Communities","Community Organizations","First Responders",
    "Healthcare Workers","General Public"],
  EVENT_TYPES: ["Panel Discussion","Workshop","Psychoeducation Session","Assembly / Keynote","Staff Training",
    "Support Group Facilitation","Other"],
  DELIVERY: ["Virtual","In-person"],
  AVAILABILITY: ["Weekday mornings","Weekday afternoons","Weekday evenings","Saturday mornings","Saturday afternoons",
    "Saturday evenings","Sunday mornings","Sunday afternoons","Sunday evenings"],
  LICENSE_TYPES: ["LPC — Licensed Professional Counselor","LCSW — Licensed Clinical Social Worker",
    "LMFT — Licensed Marriage & Family Therapist","LMHC — Licensed Mental Health Counselor",
    "Psychologist (PhD / PsyD)","Psychiatrist (MD / DO)","Registered Intern (supervised)",
    "Certified Peer Support Specialist","Other"],
  ORG_TYPES: ["School (K-12)","College / University","Nonprofit","Corporate / Workplace","Faith Community",
    "Healthcare Organization","Government / Public Agency","Other"],
  TIMEZONES: [["America/New_York","Eastern (ET)"],["America/Chicago","Central (CT)"],["America/Denver","Mountain (MT)"],
    ["America/Phoenix","Arizona (MST)"],["America/Los_Angeles","Pacific (PT)"],["America/Anchorage","Alaska (AKT)"],
    ["Pacific/Honolulu","Hawaii (HT)"]],
  SUPPORT_TIERS: [["$0 – $150","Community Supporter"],["$150 – $350","Advocate"],["$350 – $750","Champion"],["$750+","Partner"]],

  // Request statuses, in the order an admin would move through them.
  STATUS: {
    new:                { label: "Received",            help: "C4C is reviewing this request." },
    matching:           { label: "Finding presenters",  help: "C4C has invited best-fit presenters to respond." },
    awaiting_presenter: { label: "Presenter invited",   help: "Waiting for the requested presenter to reply." },
    connected:          { label: "Connected",           help: "Organization and presenter are in touch and settling a date." },
    confirmed:          { label: "Date confirmed",      help: "The session is on the calendar." },
    completed:          { label: "Completed",           help: "The session took place." },
    declined:           { label: "Not filled",          help: "C4C could not fill this request." },
    cancelled:          { label: "Cancelled",           help: "This request was cancelled." }
  },
  PRO_STATUS: {
    pending:   { label: "In review",   help: "C4C is verifying your license and insurance. You'll get an email when your profile is live." },
    approved:  { label: "Live",        help: "Your profile is public in the directory." },
    rejected:  { label: "Not approved", help: "C4C could not verify this profile. Update your details or contact us." },
    suspended: { label: "Paused",      help: "Your profile is hidden from the directory. Contact C4C to restore it." }
  }
};

// Editable columns, shared by both backends so they send exactly what the database accepts.
window.C4C_COLS = {
  professional: ["display_name","city_state","license_type","license_state","bio","website","expertise","audiences",
    "event_types","delivery","availability"],
  professionalPrivate: ["phone","license_number","years_practicing","timezone","min_notice_days","ins_carrier",
    "ins_policy_number","ins_limits","ins_expires","commit_annual"],
  organization: ["name","org_type","lead_name","lead_email","cc_emails","prior_contact"],
  request: ["requested_professional_id","event_type","topics","audiences","age_range","attendees_expected","delivery",
    "location","duration_min","timezone","window_start","window_end","description","support_level"]
};
