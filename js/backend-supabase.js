/* Connections 4 Change: Supabase backend.
   Active only when js/config.js has supabaseUrl and supabaseKey. Same contract as
   backend-demo.js. Almost every rule lives in the database (supabase/migrations), so this
   file stays thin: sign-in, a few table reads and writes, and calls to database functions. */
(function () {
  "use strict";
  const CFG = window.C4C_CONFIG, COLS = window.C4C_COLS;
  const forcedDemo = /[?&]demo=1\b/.test(location.search), forcedLive = /[?&]live=1\b/.test(location.search);
  if (!CFG.supabaseUrl || !CFG.supabaseKey || forcedDemo || !(CFG.live || forcedLive)) return;      // demo mode

  // Pinned build of the official client, with an integrity hash so a tampered file will not run.
  const LIB = {
    src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js",
    integrity: "sha384-rwykjmWNwVxboyFmvK9OXN0wj9hnMHA2aAHtits54DuACyCq0M2PrSNxhRb+hvXT"
  };

  let sb = null, profile = null;
  const listeners = [];
  const emit = event => listeners.forEach(cb => { try { cb(event); } catch (e) { console.error(e); } });
  const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj && obj[k] !== undefined).map(k => [k, obj[k]]));
  const here = () => location.origin + location.pathname + location.search;   // keeps ?live=1 on links in emails

  function loadLibrary() {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) return resolve();
      const s = document.createElement("script");
      s.src = LIB.src; s.integrity = LIB.integrity; s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the sign-in service. Check your connection and reload."));
      document.head.appendChild(s);
    });
  }

  // Turn database and auth errors into something a person can act on.
  function friendly(error) {
    const m = String((error && error.message) || error || "Something went wrong");
    if (/row-level security|permission denied/i.test(m)) return new Error("You don't have permission to do that.");
    if (/Invalid login credentials/i.test(m)) return new Error("That email and password don't match. Try again or reset your password.");
    if (/Email not confirmed/i.test(m)) return new Error("Please confirm your email first. Check your inbox for the link we sent.");
    if (/User already registered/i.test(m)) return new Error("An account with this email already exists. Sign in instead.");
    if (/duplicate key/i.test(m)) return new Error("That already exists.");
    if (/violates foreign key/i.test(m)) return new Error("This record is linked to sessions on file and can't be removed. Pause it instead.");
    if (/Failed to fetch|NetworkError/i.test(m)) return new Error("Can't reach the server. Check your connection and try again.");
    return new Error(m);
  }
  const must = ({ data, error }) => { if (error) throw friendly(error); return data; };
  const uid = () => (profile && profile.id) || (() => { throw new Error("Please sign in first"); })();

  async function loadProfile(session) {
    if (!session) { profile = null; return; }
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    // The profile row is created by a database trigger at sign-up; fall back to the token if it is not readable yet.
    profile = data || { id: session.user.id, email: session.user.email, role: (session.user.user_metadata || {}).role || "professional",
      full_name: (session.user.user_metadata || {}).full_name || session.user.email };
  }

  const api = {
    mode: "supabase",
    preview: !CFG.live,              // reached with ?live=1 before the public switch is on
    storage: "the C4C database",

    async init() {
      await loadLibrary();
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      const { data } = await sb.auth.getSession();
      await loadProfile(data.session);
      // Never await Supabase calls inside this callback (it can deadlock the client); defer instead.
      sb.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
        // Returning to the tab re-announces the same session; ignore it so open forms are not redrawn.
        if (event === "SIGNED_IN" && profile && session && profile.id === session.user.id) return;
        setTimeout(async () => { await loadProfile(session); emit(event); }, 0);
      });
    },
    onAuth: cb => listeners.push(cb),
    user: () => (profile ? Object.assign({}, profile) : null),

    async signUp({ email, password, role, full_name }) {
      const { data, error } = await sb.auth.signUp({ email, password,
        options: { data: { role, full_name }, emailRedirectTo: here() } });
      if (error) throw friendly(error);
      // With email confirmation on, an already-registered address comes back with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error("An account with this email already exists. Sign in instead.");
      }
      if (data.session) { await loadProfile(data.session); return { needsConfirm: false }; }
      return { needsConfirm: true };
    },
    async signIn({ email, password }) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw friendly(error);
      await loadProfile(data.session);
    },
    async signOut() { const { error } = await sb.auth.signOut(); if (error) throw friendly(error); profile = null; },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: here() })); },
    async updatePassword(password) { must(await sb.auth.updateUser({ password })); },

    async directory() {
      return must(await sb.from("professionals").select("*").eq("status", "approved").order("approved_at", { ascending: false }));
    },

    async myProfessional() {
      if (!profile) return null;
      const pro = must(await sb.from("professionals").select("*").eq("id", uid()).maybeSingle());
      if (!pro) return null;
      const priv = must(await sb.from("professional_private").select("*").eq("professional_id", uid()).maybeSingle());
      return { pro, priv };
    },
    async saveProfessional(proIn, privIn) {
      const pro = pick(proIn, COLS.professional), priv = pick(privIn, COLS.professionalPrivate);
      pro.license_state = String(pro.license_state || "").toUpperCase();
      const existing = await api.myProfessional();
      if (!existing) must(await sb.from("professionals").insert(Object.assign({ id: uid() }, pro)));
      else must(await sb.from("professionals").update(pro).eq("id", uid()));
      if (!existing || !existing.priv) must(await sb.from("professional_private").insert(Object.assign({ professional_id: uid() }, priv)));
      else must(await sb.from("professional_private").update(priv).eq("professional_id", uid()));
    },

    async myOrganization() {
      if (!profile) return null;
      return must(await sb.from("organizations").select("*").eq("owner_id", uid()).maybeSingle());
    },
    async saveOrganization(orgIn) {
      const org = pick(orgIn, COLS.organization);
      const existing = await api.myOrganization();
      if (!existing) return must(await sb.from("organizations").insert(Object.assign({ owner_id: uid() }, org)).select().single());
      return must(await sb.from("organizations").update(org).eq("id", existing.id).select().single());
    },

    async createRequest(fields) {
      const org = await api.myOrganization();
      if (!org) throw new Error("Set up your organization before making a request.");
      return must(await sb.from("requests").insert(Object.assign({ organization_id: org.id }, pick(fields, COLS.request))).select().single());
    },
    async myRequests() { return must(await sb.rpc("my_requests")) || []; },

    async respond(id, accept) { return must(await sb.rpc("respond_to_request", { p_request_id: id, p_accept: accept })); },
    async choosePresenter(id, professionalId) { must(await sb.rpc("choose_presenter", { p_request_id: id, p_professional_id: professionalId })); },
    async cancelRequest(id) { must(await sb.rpc("cancel_request", { p_request_id: id })); },
    async scheduleEvent(id, startsAt, durationMin, location) {
      return must(await sb.rpc("schedule_event", { p_request_id: id, p_starts_at: startsAt, p_duration_min: durationMin, p_location: location || "" }));
    },
    async recordOutcome(eventId, attendance, hours) {
      must(await sb.rpc("record_event_outcome", { p_event_id: eventId, p_attendance: attendance, p_hours: hours }));
    },
    async track(trackingId, email) { return must(await sb.rpc("track_request", { p_tracking_id: trackingId, p_email: email })); },

    admin: {
      async overview() { return must(await sb.rpc("admin_overview")); },
      async setProfessionalStatus(id, status) { must(await sb.from("professionals").update({ status }).eq("id", id)); },
      async setInsuranceVerified(id, verified) {
        must(await sb.from("professional_private").update({ ins_verified_at: verified ? new Date().toISOString() : null }).eq("professional_id", id));
      },
      async removeProfessional(id) { must(await sb.from("professionals").delete().eq("id", id)); },
      async suggest(id) { return must(await sb.rpc("suggest_presenters", { p_request_id: id })) || []; },
      async invite(id, ids) { return must(await sb.rpc("invite_presenters", { p_request_id: id, p_professional_ids: ids })); },
      async assign(id, professionalId) {
        must(await sb.from("requests").update({ matched_professional_id: professionalId, status: "connected" }).eq("id", id));
      },
      async setRequestStatus(id, status) { must(await sb.from("requests").update({ status }).eq("id", id)); },
      async removeRequest(id) { must(await sb.from("requests").delete().eq("id", id)); },

      outreach: {
        async overview() { return must(await sb.rpc("outreach_overview")); },
        async importContacts(rows, audience, source) {
          return must(await sb.rpc("import_outreach_contacts", { p_rows: rows, p_audience: audience, p_source: source }));
        },
        async removeContact(id) { must(await sb.from("outreach_contacts").delete().eq("id", id)); },
        async saveCampaign(c) {
          const row = pick(c, COLS.campaign);
          if (c.id) return must(await sb.from("outreach_campaigns").update(row).eq("id", c.id).select().single());
          return must(await sb.from("outreach_campaigns").insert(Object.assign({ created_by: uid() }, row)).select().single());
        },
        async removeCampaign(id) { must(await sb.from("outreach_campaigns").delete().eq("id", id)); },
        async saveSetting(key, value) {
          must(await sb.from("app_settings").upsert({ key, value: String(value), updated_at: new Date().toISOString() }));
        },
        async queue(id, testOnly) { return must(await sb.rpc("queue_outreach_campaign", { p_campaign_id: id, p_test_only: !!testOnly })); }
      }
    },

    // The unsubscribe link in outreach emails. No sign-in needed; the token is the key.
    async unsubscribe(token) { return must(await sb.rpc("unsubscribe_outreach", { p_token: token })); }
  };

  window.C4CSupabaseBackend = api;
})();
