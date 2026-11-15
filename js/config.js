/* Site configuration — edit before publishing. */
window.C4C_CONFIG = {
  // SHA-256 hash of the admin passcode (draft passcode: "c4c-draft").
  // Generate a new one in the browser console:
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('NEW_PASS')).then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
  // NOTE: a client-side passcode is a curtain, not a lock. Real admin auth needs the backend (see ROADMAP.md).
  adminPasscodeHash: "15acd5bd59c08c23cc3a9015e9e81e2f31786187352164e683a4fac612825116",

  // New counselor profiles stay hidden from the public directory until an admin approves them.
  requireApproval: true,

  // Show the "draft preview" banner and sample-data button.
  draftMode: true,

  contactEmail: "hello@counselorsforchange.org",

  // Email notifications via EmailJS (https://www.emailjs.com). Off until filled in.
  emailjs: {
    enabled: false,
    publicKey: "",
    serviceId: "",
    templateNewSignup: "",
    templateNewRequest: "",
    templateConfirmed: "",
    adminEmail: "hello@counselorsforchange.org"
  }
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
  FORMATS: ["Virtual","In-person"],
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
  DONATION_TIERS: [["0-150","$0 – $150","Community Supporter"],["150-350","$150 – $350","Advocate"],
    ["350-750","$350 – $750","Champion"],["750+","$750+","Partner"]],
  REQUEST_STATUSES: ["New","Matching","Awaiting counselor","Connected","Confirmed","Completed","Declined","Cancelled"],
  // Statuses shown to organizations on the tracking lookup
  STATUS_HELP: {
    "New": "Received. C4C is reviewing your request.",
    "Matching": "C4C is reaching out to best-fit presenters.",
    "Awaiting counselor": "A presenter has been invited and we're waiting for their reply.",
    "Connected": "You're connected with a presenter. Settle the exact date with them directly.",
    "Confirmed": "Your session is confirmed.",
    "Completed": "Your session is complete. Thank you!",
    "Declined": "The invited presenter couldn't take this one. C4C will follow up.",
    "Cancelled": "This request was cancelled."
  }
};
