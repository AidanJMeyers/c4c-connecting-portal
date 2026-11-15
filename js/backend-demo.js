/* Connections 4 Change: demo backend.
   Emulates the Supabase backend in this browser so the portal can be clicked through
   without a server. It mirrors supabase/migrations: same row shapes, same rules, same
   messages. There are no passwords in demo mode; "signing in" just picks an account. */
(function () {
  "use strict";
  const CFG = window.C4C_CONFIG, COLS = window.C4C_COLS;
  const P = "c4c2:";
  let ls = null;
  try { ls = window.localStorage; ls.setItem(P + "probe", "1"); ls.removeItem(P + "probe"); } catch (e) { ls = null; }
  const mem = new Map();
  const read = k => { try { const v = ls ? ls.getItem(P + k) : mem.get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  const write = (k, v) => { const s = JSON.stringify(v); if (ls) ls.setItem(P + k, s); else mem.set(k, s); };

  const TABLES = ["profiles", "professionals", "professional_private", "organizations", "requests",
    "request_candidates", "request_history", "events", "email_outbox"];
  const db = {};
  const loadAll = () => TABLES.forEach(t => { db[t] = read(t) || []; });
  const persist = () => { TABLES.forEach(t => write(t, db[t])); write("session", sessionId); };
  let sessionId = read("session");
  loadAll();

  /* ---------- small helpers ---------- */
  const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  const now = () => new Date().toISOString();
  const fail = msg => { throw new Error(msg); };
  const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj && obj[k] !== undefined).map(k => [k, obj[k]]));
  const nextId = t => db[t].reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;

  const me = () => db.profiles.find(p => p.id === sessionId) || null;
  const mustBeSignedIn = () => me() || fail("Please sign in first");
  const isAdmin = () => !!me() && me().role === "admin";
  const mustBeAdmin = () => isAdmin() || fail("Admins only");
  const myOrg = () => { const u = me(); return (u && db.organizations.find(o => o.owner_id === u.id)) || null; };
  const emailOf = id => (db.profiles.find(p => p.id === id) || {}).email || null;
  const adminEmails = () => db.profiles.filter(p => p.role === "admin").map(p => p.email);
  const pro = id => db.professionals.find(p => p.id === id) || null;
  const req = id => db.requests.find(r => r.id === id) || fail("Request not found");
  const orgOf = r => db.organizations.find(o => o.id === r.organization_id);
  const eventOf = r => db.events.find(e => e.request_id === r.id) || null;

  const listeners = [];
  const emit = event => listeners.forEach(cb => { try { cb(event); } catch (e) { console.error(e); } });

  /* ---------- what the database triggers do ---------- */
  function enqueue(template, to, cc, payload, requestId) {
    const toEmails = (to || []).filter(Boolean);
    if (!toEmails.length) return;
    db.email_outbox.push({ id: nextId("email_outbox"), created_at: now(), template, to_emails: toEmails,
      cc_emails: (cc || []).filter(Boolean), payload: payload || {}, request_id: requestId || null,
      status: "queued", sent_at: null });
  }
  function requestPayload(r) {
    const o = orgOf(r), m = pro(r.matched_professional_id), e = eventOf(r);
    return { tracking_id: r.tracking_id, status: r.status, event_type: r.event_type, window_start: r.window_start,
      window_end: r.window_end, audiences: r.audiences, topics: r.topics, delivery: r.delivery, timezone: r.timezone,
      org_name: o.name, lead_name: o.lead_name, lead_email: o.lead_email,
      presenter_name: m ? m.display_name : null, presenter_email: m ? emailOf(m.id) : null,
      event_starts_at: e ? e.starts_at : null, event_location: (e && e.location) || r.location || null };
  }
  const history = (r, what) => db.request_history.push({ id: nextId("request_history"), request_id: r.id, at: now(), actor_id: sessionId, what });

  function setStatus(r, status) {
    if (r.status === status) return;
    const old = r.status, o = orgOf(r);
    r.status = status; r.updated_at = now();
    const payload = requestPayload(r);
    const presEmail = emailOf(r.matched_professional_id || r.requested_professional_id);
    history(r, {
      new: "Request reopened", matching: "C4C is finding presenters for this request",
      awaiting_presenter: "Waiting for the requested presenter to reply",
      connected: "Connected with " + (payload.presenter_name || "a presenter"),
      confirmed: "Date confirmed", completed: "Session completed",
      declined: "C4C could not fill this request", cancelled: "Request cancelled"
    }[status]);
    if (status === "connected") {
      enqueue("connected_organization", [o.lead_email], o.cc_emails, payload, r.id);
      enqueue("connected_presenter", [presEmail], [], payload, r.id);
      enqueue("admin_connection", adminEmails(), [], payload, r.id);
    } else if (status === "confirmed") {
      enqueue("event_confirmed", [o.lead_email, presEmail], o.cc_emails, payload, r.id);
      enqueue("admin_event_confirmed", adminEmails(), [], payload, r.id);
    } else if (status === "matching" && old === "awaiting_presenter") {
      enqueue("admin_needs_matching", adminEmails(), [], payload, r.id);
    } else if (status === "cancelled") {
      enqueue("request_cancelled", [presEmail], [], payload, r.id);
      enqueue("admin_request_cancelled", adminEmails(), [], payload, r.id);
    }
  }

  function genTrackingId() {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (;;) {
      const a = crypto.getRandomValues(new Uint8Array(6));
      const id = "C4C-" + Array.from(a, b => abc[b % abc.length]).join("");
      if (!db.requests.some(r => r.tracking_id === id)) return id;
    }
  }

  function scoreFor(p, r) {
    const priv = db.professional_private.find(x => x.professional_id === p.id);
    const hits = (a, b) => (a || []).filter(x => (b || []).includes(x)).length;
    const days = (new Date(r.window_end) - new Date(new Date().toISOString().slice(0, 10))) / 86400000;
    return 3 * hits(r.topics, p.expertise) + 2 * hits(r.audiences, p.audiences)
      + ((p.event_types || []).includes(r.event_type) ? 1 : 0)
      + (!(p.delivery || []).length || p.delivery.includes(r.delivery) ? 1 : 0)
      - (days < ((priv && priv.min_notice_days) || 30) ? 2 : 0);
  }
  const suggestFor = r => db.professionals.filter(p => p.status === "approved")
    .map(p => ({ professional_id: p.id, display_name: p.display_name, score: scoreFor(p, r) }))
    .sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name));

  /* ---------- what row-level security does ---------- */
  function visible(r) {
    const u = me(); if (!u) return false;
    const o = myOrg();
    return isAdmin() || (o && o.id === r.organization_id) || r.requested_professional_id === u.id
      || r.matched_professional_id === u.id
      || db.request_candidates.some(c => c.request_id === r.id && c.professional_id === u.id);
  }
  function view(r) {
    const u = me(), admin = isAdmin(), o = orgOf(r), mo = myOrg();
    const mine = !!mo && mo.id === r.organization_id, matchedMe = r.matched_professional_id === u.id;
    const connected = ["connected", "confirmed", "completed"].includes(r.status);
    const name = id => (pro(id) || {}).display_name || null;
    const orgView = Object.assign({}, o); delete orgView.owner_id;
    const ev = eventOf(r), evView = ev ? Object.assign({}, ev) : null;
    if (evView) { delete evView.share_token; delete evView.feedback_token; }
    return Object.assign({}, r, {
      organization: orgView,
      requested: r.requested_professional_id ? { id: r.requested_professional_id, display_name: name(r.requested_professional_id) } : null,
      matched: r.matched_professional_id ? { id: r.matched_professional_id, display_name: name(r.matched_professional_id),
        email: (admin || matchedMe || (mine && connected)) ? emailOf(r.matched_professional_id) : null } : null,
      event: evView,
      history: (admin || mine || matchedMe)
        ? db.request_history.filter(h => h.request_id === r.id).map(h => ({ at: h.at, what: h.what })) : [],
      candidates: db.request_candidates.filter(c => c.request_id === r.id)
        .filter(c => admin || c.professional_id === u.id || (mine && c.response === "interested"))
        .map(c => ({ professional_id: c.professional_id, display_name: name(c.professional_id),
          score: admin ? c.score : null, invited_at: c.invited_at, response: c.response }))
        .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.display_name).localeCompare(String(b.display_name)))
    });
  }
  const myRequests = () => db.requests.filter(visible)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(view);

  /* ---------- public API (same contract as backend-supabase.js) ---------- */
  const get = fn => async (...a) => clone(fn(...a));
  const mut = fn => async (...a) => { const out = fn(...a); persist(); return clone(out); };

  async function sha256(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
  }

  const api = {
    mode: "demo",
    storage: ls ? "this browser" : "memory only (clears on reload)",
    init: async () => {},
    onAuth: cb => listeners.push(cb),
    user: () => clone(me()),

    signUp: mut(({ email, role, full_name }) => {
      email = String(email).trim().toLowerCase();
      if (db.profiles.some(p => p.email === email)) fail("An account with this email already exists. Sign in instead.");
      const u = { id: uuid(), role: role === "organization" ? "organization" : "professional", email,
        full_name: String(full_name || "").trim() || email.split("@")[0], created_at: now() };
      db.profiles.push(u); sessionId = u.id; emit("SIGNED_IN");
      return { needsConfirm: false };
    }),
    signIn: mut(({ email }) => {
      const u = db.profiles.find(p => p.email === String(email).trim().toLowerCase())
        || fail("No demo account uses that email. Create one first, or load the sample data.");
      sessionId = u.id; emit("SIGNED_IN");
    }),
    signOut: mut(() => { sessionId = null; emit("SIGNED_OUT"); }),
    resetPassword: async () => fail("Demo mode has no passwords."),
    updatePassword: async () => fail("Demo mode has no passwords."),

    directory: get(() => db.professionals.filter(p => p.status === "approved")
      .sort((a, b) => String(b.approved_at).localeCompare(String(a.approved_at)))),

    myProfessional: get(() => {
      const u = me(), p = u && pro(u.id);
      return p ? { pro: p, priv: db.professional_private.find(x => x.professional_id === u.id) || null } : null;
    }),
    saveProfessional: mut((proIn, privIn) => {
      const u = mustBeSignedIn();
      const p = pick(proIn, COLS.professional), pv = pick(privIn, COLS.professionalPrivate);
      p.license_state = String(p.license_state || "").toUpperCase();
      let row = pro(u.id);
      if (!row) {
        if (u.role === "organization") fail("This account is set up for an organization. Use a different email for a presenter profile.");
        row = Object.assign({ id: u.id, headshot_path: null }, p, { status: "pending", approved_at: null,
          profile_confirmed_at: null, created_at: now(), updated_at: now() });
        db.professionals.push(row);
        db.professional_private.push(Object.assign({ professional_id: u.id }, pv,
          { ins_verified_at: null, ack_independent_at: now(), terms_version: "draft-2026-11" }));
        const payload = { presenter_name: row.display_name, presenter_email: u.email, license_type: row.license_type, license_state: row.license_state };
        enqueue("application_received", [u.email], [], payload);
        enqueue("admin_new_presenter", adminEmails(), [], payload);
      } else {
        const old = db.professional_private.find(x => x.professional_id === u.id) || {};
        const licenseChanged = p.license_type !== row.license_type || p.license_state !== row.license_state
          || pv.license_number !== old.license_number;
        const insChanged = ["ins_carrier", "ins_policy_number", "ins_limits", "ins_expires"].some(k => pv[k] !== old[k]);
        Object.assign(row, p, { updated_at: now() });
        Object.assign(old, pv);
        if (!isAdmin()) {
          if (insChanged) old.ins_verified_at = null;
          if (licenseChanged && ["approved", "rejected"].includes(row.status)) {
            if (row.status === "approved") enqueue("admin_reverify_presenter", adminEmails(), [], { presenter_name: row.display_name, presenter_email: u.email });
            row.status = "pending"; row.approved_at = null;
          }
        }
      }
      return row;
    }),

    myOrganization: get(() => myOrg()),
    saveOrganization: mut(orgIn => {
      const u = mustBeSignedIn(), o = pick(orgIn, COLS.organization);
      let row = myOrg();
      if (!row) {
        if (u.role === "professional") fail("This account is set up for a presenter. Use a different email for an organization.");
        row = Object.assign({ id: uuid(), owner_id: u.id }, o, { intro_call_offered_at: null, created_at: now() });
        db.organizations.push(row);
        const payload = { org_name: row.name, org_type: row.org_type, lead_name: row.lead_name, lead_email: row.lead_email, prior_contact: row.prior_contact };
        enqueue("admin_new_organization", adminEmails(), [], payload);
        if (row.prior_contact === false) {
          enqueue("intro_call_offer", [row.lead_email], row.cc_emails, payload);
          row.intro_call_offered_at = now();
        }
      } else Object.assign(row, o);
      return row;
    }),

    createRequest: mut(fields => {
      const o = myOrg() || fail("Set up your organization before making a request.");
      const f = pick(fields, COLS.request);
      if (f.requested_professional_id) {
        const p = pro(f.requested_professional_id);
        if (!p || p.status !== "approved") fail("That presenter is not available for requests");
      }
      if (!(f.window_end >= f.window_start)) fail("The window must end on or after its start date.");
      const r = Object.assign({ id: uuid(), tracking_id: genTrackingId(), organization_id: o.id,
        requested_professional_id: null, matched_professional_id: null }, f,
        { status: f.requested_professional_id ? "awaiting_presenter" : "new", created_at: now(), updated_at: now() });
      db.requests.push(r);
      history(r, "Request submitted");
      const payload = requestPayload(r);
      enqueue("request_received", [o.lead_email], o.cc_emails, payload, r.id);
      enqueue("admin_new_request", adminEmails(), [], payload, r.id);
      if (r.requested_professional_id) enqueue("presenter_invited", [emailOf(r.requested_professional_id)], [], payload, r.id);
      return r;
    }),
    myRequests: get(myRequests),

    respond: mut((id, accept) => {
      const u = mustBeSignedIn(), r = req(id);
      const p = pro(u.id);
      if (!p || p.status !== "approved") fail("Only approved presenters can respond to requests");
      const cand = db.request_candidates.find(c => c.request_id === r.id && c.professional_id === u.id);
      if (r.requested_professional_id === u.id && r.status === "awaiting_presenter") {
        if (accept) { r.matched_professional_id = u.id; setStatus(r, "connected"); }
        else { history(r, "The requested presenter was unavailable"); setStatus(r, "matching"); }
      } else if (r.status === "matching" && cand) {
        cand.response = accept ? "interested" : "declined"; cand.responded_at = now();
        if (accept) {
          const o = orgOf(r);
          history(r, "A presenter is interested");
          enqueue("presenter_interested", [o.lead_email], o.cc_emails, requestPayload(r), r.id);
          enqueue("admin_presenter_interested", adminEmails(), [], requestPayload(r), r.id);
        }
      } else fail("You do not have an open invitation for this request");
      return r.status;
    }),
    choosePresenter: mut((id, professionalId) => {
      mustBeSignedIn(); const r = req(id), o = myOrg();
      if (!((o && o.id === r.organization_id) || isAdmin())) fail("Only the requesting organization can choose a presenter");
      if (r.status !== "matching") fail("This request is not open for choosing a presenter");
      if (!db.request_candidates.some(c => c.request_id === r.id && c.professional_id === professionalId && c.response === "interested")) fail("That presenter has not said they are interested");
      if (!pro(professionalId) || pro(professionalId).status !== "approved") fail("That presenter is no longer available");
      r.matched_professional_id = professionalId; setStatus(r, "connected");
    }),
    cancelRequest: mut(id => {
      mustBeSignedIn(); const r = req(id), o = myOrg();
      if (!((o && o.id === r.organization_id) || isAdmin())) fail("Only the requesting organization can cancel a request");
      if (["completed", "cancelled"].includes(r.status)) fail("This request is already closed");
      setStatus(r, "cancelled");
    }),
    scheduleEvent: mut((id, startsAt, durationMin, location) => {
      const u = mustBeSignedIn(), r = req(id), o = orgOf(r), mo = myOrg();
      if (!((mo && mo.id === r.organization_id) || r.matched_professional_id === u.id || isAdmin())) fail("Only the organization or its presenter can set the date");
      if (!r.matched_professional_id || !["connected", "confirmed"].includes(r.status)) fail("Connect with a presenter before setting a date");
      if (!(new Date(startsAt) > new Date())) fail("Choose a date in the future");
      let ev = eventOf(r);
      const loc = String(location || "").trim() || r.location || null;
      if (!ev) {
        ev = { id: uuid(), request_id: r.id, organization_id: r.organization_id, professional_id: r.matched_professional_id,
          title: r.event_type + " · " + o.name, starts_at: new Date(startsAt).toISOString(), duration_min: durationMin || r.duration_min,
          location: loc, share_token: uuid().replace(/-/g, ""), feedback_token: uuid().replace(/-/g, "").slice(0, 16),
          attendance_actual: null, presenter_hours: null, created_at: now(), updated_at: now() };
        db.events.push(ev);
      } else Object.assign(ev, { starts_at: new Date(startsAt).toISOString(), duration_min: durationMin || r.duration_min, location: loc, updated_at: now() });
      if (r.status === "connected") setStatus(r, "confirmed");
      else {
        history(r, "Date changed");
        enqueue("event_rescheduled", [o.lead_email, emailOf(r.matched_professional_id)], o.cc_emails, requestPayload(r), r.id);
        enqueue("admin_event_rescheduled", adminEmails(), [], requestPayload(r), r.id);
      }
      return ev.id;
    }),
    recordOutcome: mut((eventId, attendance, hours) => {
      const u = mustBeSignedIn(), ev = db.events.find(e => e.id === eventId) || fail("Session not found");
      if (!(ev.professional_id === u.id || isAdmin())) fail("Only the presenter can record the outcome");
      if (new Date(ev.starts_at) > new Date()) fail("This session has not happened yet");
      Object.assign(ev, { attendance_actual: attendance, presenter_hours: hours, updated_at: now() });
      const r = req(ev.request_id);
      if (r.status === "confirmed") setStatus(r, "completed");
    }),
    track: get((trackingId, email) => {
      const r = db.requests.find(x => x.tracking_id === String(trackingId).trim().toUpperCase());
      if (!r) return null;
      const o = orgOf(r), em = String(email).trim().toLowerCase();
      if (o.lead_email.toLowerCase() !== em && !(o.cc_emails || []).some(c => c.toLowerCase() === em)) return null;
      const connected = ["connected", "confirmed", "completed"].includes(r.status), ev = eventOf(r), m = pro(r.matched_professional_id);
      return { tracking_id: r.tracking_id, org_name: o.name, event_type: r.event_type, status: r.status,
        window_start: r.window_start, window_end: r.window_end, presenter_name: connected && m ? m.display_name : null,
        event_starts_at: ev ? ev.starts_at : null,
        history: db.request_history.filter(h => h.request_id === r.id).map(h => ({ at: h.at, what: h.what })) };
    }),

    admin: {
      overview: get(() => {
        mustBeAdmin();
        return {
          professionals: db.professionals.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(p => {
            const pv = Object.assign({}, db.professional_private.find(x => x.professional_id === p.id)); delete pv.professional_id;
            return Object.assign({}, p, { email: emailOf(p.id), private: pv });
          }),
          organizations: db.organizations.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
          requests: myRequests(),
          outbox: db.email_outbox.slice(-200).reverse()
        };
      }),
      setProfessionalStatus: mut((id, status) => {
        mustBeAdmin(); const p = pro(id) || fail("Presenter not found"), old = p.status;
        p.status = status; p.updated_at = now();
        if (status === "approved") {
          p.approved_at = p.approved_at || now();
          if (old !== "approved") enqueue("profile_approved", [emailOf(id)], [], { presenter_name: p.display_name, presenter_email: emailOf(id) });
        }
      }),
      setInsuranceVerified: mut((id, verified) => {
        mustBeAdmin(); const pv = db.professional_private.find(x => x.professional_id === id) || fail("Presenter not found");
        pv.ins_verified_at = verified ? now() : null;
      }),
      removeProfessional: mut(id => {
        mustBeAdmin();
        if (db.events.some(e => e.professional_id === id)) fail("This presenter has sessions on record and can't be removed. Pause the profile instead.");
        db.professionals = db.professionals.filter(p => p.id !== id);
        db.professional_private = db.professional_private.filter(p => p.professional_id !== id);
        db.request_candidates = db.request_candidates.filter(c => c.professional_id !== id);
        db.requests.forEach(r => {
          if (r.requested_professional_id === id) r.requested_professional_id = null;
          if (r.matched_professional_id === id) r.matched_professional_id = null;
        });
      }),
      suggest: get(id => { mustBeAdmin(); return suggestFor(req(id)); }),
      invite: mut((id, ids) => {
        mustBeAdmin(); const r = req(id);
        if (!["new", "matching", "declined"].includes(r.status)) fail("This request is not open for invitations");
        let n = 0;
        suggestFor(r).filter(s => ids.includes(s.professional_id)).forEach(s => {
          if (db.request_candidates.some(c => c.request_id === r.id && c.professional_id === s.professional_id)) return;
          db.request_candidates.push({ request_id: r.id, professional_id: s.professional_id, score: s.score, invited_at: now(), response: null, responded_at: null });
          enqueue("presenter_invited", [emailOf(s.professional_id)], [], requestPayload(r), r.id);
          n++;
        });
        if (r.status !== "matching") setStatus(r, "matching");
        if (n > 0) history(r, "C4C invited " + n + (n === 1 ? " presenter" : " presenters"));
        return n;
      }),
      assign: mut((id, professionalId) => { mustBeAdmin(); const r = req(id); r.matched_professional_id = professionalId; r.updated_at = now(); setStatus(r, "connected"); }),
      setRequestStatus: mut((id, status) => { mustBeAdmin(); setStatus(req(id), status); }),
      removeRequest: mut(id => {
        mustBeAdmin();
        db.requests = db.requests.filter(r => r.id !== id);
        ["request_candidates", "request_history", "events"].forEach(t => { db[t] = db[t].filter(x => x.request_id !== id); });
      })
    },

    /* ---------- demo-only tools ---------- */
    demo: {
      accounts: get(() => db.profiles.filter(p => p.id !== "demo-admin").map(p => ({ email: p.email, role: p.role, full_name: p.full_name }))),
      unlockAdmin: async passcode => {
        if ((await sha256(passcode)) !== CFG.demoAdminPasscodeHash) fail("Incorrect passcode.");
        if (!db.profiles.some(p => p.id === "demo-admin")) {
          db.profiles.push({ id: "demo-admin", role: "admin", email: "admin@demo.invalid", full_name: "Demo Admin", created_at: now() });
        }
        sessionId = "demo-admin"; persist(); emit("SIGNED_IN");
      },
      reset: async () => { TABLES.forEach(t => { db[t] = []; }); sessionId = null; persist(); emit("SIGNED_OUT"); },
      seed: mut(() => {
        if (db.profiles.some(p => p.email.endsWith("@sample.invalid"))) fail("Sample data is already loaded.");
        const L = window.C4C_OPTIONS.LICENSE_TYPES, t0 = Date.now();
        const mk = (i, name, city, lic, status, extra) => {
          const id = uuid(), created = new Date(t0 - (6 - i) * 86400000).toISOString();
          db.profiles.push({ id, role: "professional", email: "presenter" + i + "@sample.invalid", full_name: name, created_at: created });
          db.professionals.push(Object.assign({ id, display_name: name, city_state: city, license_type: lic, license_state: "FL",
            website: "", headshot_path: null, status, approved_at: status === "approved" ? created : null,
            profile_confirmed_at: null, created_at: created, updated_at: created }, extra));
          db.professional_private.push({ professional_id: id, phone: "", license_number: "SAMPLE-" + i, years_practicing: 5 + i,
            timezone: "America/New_York", min_notice_days: 30, ins_carrier: "Sample Carrier", ins_policy_number: "SAMPLE",
            ins_limits: "$1M / $3M", ins_expires: "2027-12-31", ins_verified_at: status === "approved" ? created : null,
            commit_annual: true, ack_independent_at: created, terms_version: "draft-2026-11" });
          return id;
        };
        mk(1, "Sample Presenter A, LMFT", "Melbourne, FL", L[2], "approved", { expertise: ["Relationships & Family", "Parenting Support", "Youth & Adolescent Mental Health"], audiences: ["Parents & Caregivers", "Educators & School Staff"], event_types: ["Workshop", "Panel Discussion"], delivery: ["Virtual", "In-person"], availability: ["Weekday evenings", "Saturday mornings"], bio: "Example profile for demo purposes. Family therapist who leads parent workshops on supporting teens through stress and big transitions." });
        mk(2, "Sample Presenter B, LMHC", "Viera, FL", L[3], "approved", { expertise: ["Anxiety & Stress", "Suicide Prevention", "Bullying & Social Media"], audiences: ["K-12 Students", "Educators & School Staff"], event_types: ["Assembly / Keynote", "Psychoeducation Session", "Workshop"], delivery: ["In-person"], availability: ["Weekday mornings", "Weekday afternoons"], bio: "Example profile for demo purposes. School-focused counselor offering age-appropriate sessions on anxiety, coping skills and asking for help." });
        mk(3, "Sample Presenter C, PsyD", "Palm Bay, FL", L[4], "approved", { expertise: ["Trauma & PTSD", "Burnout & Workplace Stress", "Crisis Response"], audiences: ["First Responders", "Healthcare Workers", "Educators & School Staff"], event_types: ["Staff Training", "Workshop"], delivery: ["Virtual"], availability: ["Weekday afternoons", "Weekday evenings"], bio: "Example profile for demo purposes. Psychologist who trains school staff and first responders on trauma-informed practice and burnout prevention." });
        mk(4, "Sample Presenter D, LCSW", "Titusville, FL", L[1], "pending", { expertise: ["Grief & Loss", "Depression & Mood"], audiences: ["General Public", "Faith Communities"], event_types: ["Panel Discussion"], delivery: ["In-person"], availability: ["Sunday afternoons"], bio: "Example profile for demo purposes. This one is still waiting for review, so it appears only in the admin queue." });

        const ownerId = uuid(), created = new Date(t0 - 86400000).toISOString();
        db.profiles.push({ id: ownerId, role: "organization", email: "school@sample.invalid", full_name: "Sample Lead", created_at: created });
        const org = { id: uuid(), owner_id: ownerId, name: "Sample Middle School", org_type: "School (K-12)", lead_name: "Sample Lead",
          lead_email: "school@sample.invalid", cc_emails: ["principal@sample.invalid"], prior_contact: false, intro_call_offered_at: created, created_at: created };
        db.organizations.push(org);
        const plus = d => new Date(t0 + d * 86400000).toISOString().slice(0, 10);
        const r = { id: uuid(), tracking_id: genTrackingId(), organization_id: org.id, requested_professional_id: null, matched_professional_id: null,
          event_type: "Workshop", topics: ["Anxiety & Stress", "Bullying & Social Media"], audiences: ["K-12 Students"], age_range: "Grades 6–8",
          attendees_expected: 120, delivery: "In-person", location: "School auditorium", duration_min: 60, timezone: "America/New_York",
          window_start: plus(45), window_end: plus(90), description: "Example request for demo purposes. A session for our middle schoolers on handling stress and social media pressure.",
          support_level: "$150 – $350 (Advocate)", status: "new", created_at: created, updated_at: created };
        db.requests.push(r);
        db.request_history.push({ id: nextId("request_history"), request_id: r.id, at: created, actor_id: ownerId, what: "Request submitted" });
      })
    }
  };

  window.C4CDemoBackend = api;
})();
