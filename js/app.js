/* Connections 4 Change: views and interactions. Vanilla JS, no build step.
   All data goes through one backend contract: backend-supabase.js when configured,
   otherwise backend-demo.js. Row shapes match the database (supabase/migrations). */
(function () {
  "use strict";
  const CFG = window.C4C_CONFIG, OPT = window.C4C_OPTIONS;
  const B = window.C4CSupabaseBackend || window.C4CDemoBackend;
  const DEMO = B.mode === "demo";

  /* ================= helpers ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  const val = id => $("#" + id).value.trim();
  const pad = n => String(n).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const AVATAR_COLORS = ["#2C6489", "#2B7F83", "#0E7BAE", "#4E6E8A", "#23838B", "#5E7EA3"];

  function toast(msg, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind === "error" ? " error" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "error" ? 8000 : 5000);
  }
  // Run an async action with the button disabled; failures surface as a toast.
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || "Something went wrong. Please try again.", "error"); }
    finally { if (btn) btn.disabled = false; }
  }
  function showError(id, msg) { const el = $("#" + id); el.textContent = msg || ""; el.classList.toggle("show", !!msg); return !msg; }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /* ---- dates and time zones ---- */
  function tzOffset(ms, tz) {           // offset of tz from UTC at a given instant, in ms
    const p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
  }
  function zonedToUtc(date, time, tz) { // wall-clock date + time in tz -> Date
    const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
    const guess = Date.UTC(y, m - 1, d, h, mi);
    let t = guess - tzOffset(guess, tz);
    t = guess - tzOffset(t, tz);
    return new Date(t);
  }
  const fmtDay = d => { if (!d) return ""; const [y, m, dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }); };
  const fmtWindow = r => `${fmtDay(r.window_start)} to ${fmtDay(r.window_end)}`;
  const fmtDate = iso => { try { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; } };
  const fmtInstant = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz || "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const utcStamp = dt => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  /* ---- calendar ---- */
  function eventInfo(r) {
    const start = new Date(r.event.starts_at), end = new Date(start.getTime() + (r.event.duration_min || 60) * 60000);
    const who = r.matched ? r.matched.display_name : "Counselors for Change";
    const details = [`${r.event_type} with ${who}`, `Organization: ${r.organization ? r.organization.name : ""}`,
      `Audience: ${(r.audiences || []).join(", ")}`, "", r.description || "", "", "Arranged through Connections 4 Change (Counselors for Change)"].join("\n");
    return { start, end, title: `${r.event_type}: ${r.organization ? r.organization.name : ""} × ${who}`, location: r.event.location || "", details };
  }
  function googleCalUrl(r) {
    const e = eventInfo(r);
    return "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${utcStamp(e.start)}/${utcStamp(e.end)}`, details: e.details, location: e.location });
  }
  const icsEsc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  function downloadIcs(r) {
    const e = eventInfo(r);
    download(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Counselors for Change//Connections 4 Change//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      `UID:${r.id}@counselorsforchange.org`, `DTSTAMP:${utcStamp(new Date())}`, `DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${icsEsc(e.title)}`, `DESCRIPTION:${icsEsc(e.details)}`, `LOCATION:${icsEsc(e.location)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
      `c4c-session-${r.tracking_id}.ics`, "text/calendar");
  }

  /* ================= state ================= */
  const S = { me: null, pro: null, priv: null, org: null, requests: [], directory: [], admin: null, outreach: null,
    target: null, recovery: false, suggestions: {}, supportTier: null };
  const sel = {};                        // chipset id -> Set of selected values
  const isAdmin = () => !!S.me && S.me.role === "admin";
  const DRAFT_KEY = "c4c2:draft";        // sign-up form held on this device until the email is confirmed
  const draft = {
    load() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } },
    save(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* storage blocked */ } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* storage blocked */ } }
  };

  /* ================= one-time UI setup ================= */
  function fillSelect(el, items, placeholder) {
    el.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") +
      items.map(it => Array.isArray(it) ? `<option value="${esc(it[0])}">${esc(it[1])}</option>` : `<option>${esc(it)}</option>`).join("");
  }
  function buildChipset(el) {
    const set = sel[el.id] = new Set();
    el.innerHTML = "";
    OPT[el.dataset.options].forEach(v => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip-btn"; b.textContent = v; b.dataset.value = v; b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        if (set.has(v)) set.delete(v); else set.add(v);
        b.setAttribute("aria-pressed", String(set.has(v)));
        if (el.id.startsWith("filter")) renderDirectory();
      });
      el.appendChild(b);
    });
  }
  function setChips(id, values) {
    sel[id].clear(); (values || []).forEach(v => sel[id].add(v));
    $$(`#${id} .chip-btn`).forEach(b => b.setAttribute("aria-pressed", String(sel[id].has(b.dataset.value))));
  }

  function initUI() {
    fillSelect($("#proLicenseType"), OPT.LICENSE_TYPES, "Select one");
    fillSelect($("#orgType"), OPT.ORG_TYPES);
    fillSelect($("#reqEventType"), OPT.EVENT_TYPES, "Select one");
    $$(".tz-select").forEach(s => fillSelect(s, OPT.TIMEZONES));
    $$(".chipset[data-options]").forEach(buildChipset);
    fillSelect($("#adminReqFilter"), [["", "All statuses"], ["open", "Open"], ...Object.entries(OPT.STATUS).map(([k, v]) => [k, v.label])]);

    const sc = $("#supportCards");
    sc.innerHTML = OPT.SUPPORT_TIERS.map(t => `<button type="button" class="radio-card" aria-pressed="false" data-tier="${esc(t[0] + " (" + t[1] + ")")}"><div class="amt">${esc(t[0])}</div><div class="lbl">${esc(t[1])}</div></button>`).join("");
    $$(".radio-card", sc).forEach(card => card.addEventListener("click", () => {
      const on = card.getAttribute("aria-pressed") !== "true";
      $$(".radio-card", sc).forEach(c => c.setAttribute("aria-pressed", "false"));
      card.setAttribute("aria-pressed", String(on));
      S.supportTier = on ? card.dataset.tier : null;
      if (on) $("#reqCustomAmount").value = "";
    }));
    $("#reqCustomAmount").addEventListener("input", e => {
      if (e.target.value) { $$(".radio-card", sc).forEach(c => c.setAttribute("aria-pressed", "false")); S.supportTier = null; }
    });
    ["reqWindowStart", "reqWindowEnd", "proInsExpires"].forEach(id => { $("#" + id).min = todayStr(); });

    if (B.preview) $("#liveBanner").hidden = false;
    if (DEMO) {
      $("#demoBanner").hidden = false;
      $$(".pw-field").forEach(el => { el.hidden = true; });
      $("#adminDataTab").hidden = false;
      $("#storageMode").textContent = B.storage;
    }
    $("#dirSearch").addEventListener("input", renderDirectory);
    $("#dirDelivery").addEventListener("change", renderDirectory);
    $("#dirClear").addEventListener("click", () => { $("#dirSearch").value = ""; $("#dirDelivery").value = ""; setChips("filterExpertise", []); setChips("filterAudiences", []); renderDirectory(); });
    $("#targetedClear").addEventListener("click", () => { S.target = null; renderRequestView(); });
    $("#adminProFilter").addEventListener("change", renderAdmin);
    $("#adminReqFilter").addEventListener("change", renderAdmin);
    $$("[data-admin-tab]").forEach(b => b.addEventListener("click", () => {
      $$("[data-admin-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
      $$("[data-admin-panel]").forEach(p => { p.hidden = p.dataset.adminPanel !== b.dataset.adminTab; });
    }));
    window.addEventListener("hashchange", route);
  }

  /* ================= routing ================= */
  let booted = false;
  const VIEWS = ["home", "directory", "presenters", "organizations", "request", "account", "admin", "privacy", "unsubscribe"];
  const currentView = () => {
    const h = location.hash.slice(1);
    if (h.startsWith("unsubscribe=")) return "unsubscribe";      // link from an outreach email
    return VIEWS.includes(h) ? h : "home";
  };
  function go(view) { if (location.hash === "#" + view) route(); else location.hash = view; }
  function route() {
    const view = currentView();
    $$("section.view").forEach(s => s.classList.toggle("active", s.id === view));
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view.split(" ").includes(view)));
    if (view === "presenters") fillProForm();
    if (view === "organizations") fillOrgForm();
    render(view);
    window.scrollTo({ top: 0 });
    // Dashboards show other people's activity, so fetch fresh data whenever one is opened.
    if (booted && S.me && (view === "admin" || view === "account")) refresh();
  }
  function render(view) {
    ({ home: renderHome, directory: renderDirectory, presenters: renderPresenterView, organizations: renderOrgView,
      request: renderRequestView, account: renderAccount, admin: renderAdmin, privacy: () => {}, unsubscribe: renderUnsubscribe })[view]();
  }

  /* ================= data ================= */
  async function refresh() {
    S.me = B.user();
    const guard = p => p.catch(e => { console.error(e); toast(e.message || "Could not load data.", "error"); });
    const jobs = [guard(B.directory().then(d => { S.directory = d || []; }))];
    if (S.me) {
      jobs.push(guard(B.myProfessional().then(x => { S.pro = x ? x.pro : null; S.priv = x ? x.priv : null; })));
      jobs.push(guard(B.myOrganization().then(o => { S.org = o || null; })));
      jobs.push(guard(B.myRequests().then(r => { S.requests = r || []; })));
      if (isAdmin()) {
        jobs.push(guard(B.admin.overview().then(a => { S.admin = a; })));
        jobs.push(guard(B.admin.outreach.overview().then(o => { S.outreach = o; })));
      } else S.admin = S.outreach = null;
    } else { S.pro = S.priv = S.org = S.admin = S.outreach = null; S.requests = []; }
    await Promise.all(jobs);
    $("#navAccount").textContent = S.me ? "My account" : "Sign in";
    $("#navAdmin").hidden = !(DEMO || isAdmin());
    render(currentView());
  }

  // After an email link confirms a new account, finish the sign-up that was started on this device.
  async function submitDraftIfAny() {
    const d = draft.load();
    if (!d || !S.me || d.email !== String(S.me.email).toLowerCase()) return;
    try {
      if (d.kind === "pro" && !S.pro) { await B.saveProfessional(d.pro, d.priv); toast("Email confirmed. Your profile was submitted for review."); }
      if (d.kind === "org" && !S.org) { await B.saveOrganization(d.org); toast("Email confirmed. Your organization account is ready."); }
      draft.clear();
      await refresh();
      go("account");
    } catch (e) { console.error(e); toast(e.message, "error"); }
  }

  /* ================= home ================= */
  function renderHome() {
    $("#statPresenters").textContent = S.directory.length;
    $("#statExpertise").textContent = new Set(S.directory.flatMap(p => p.expertise || [])).size;
    $("#statAudiences").textContent = new Set(S.directory.flatMap(p => p.audiences || [])).size;
  }

  /* ================= directory ================= */
  const shortLicense = t => String(t || "").split(" — ")[0];
  function renderDirectory() {
    const grid = $("#directoryGrid");
    const q = $("#dirSearch").value.trim().toLowerCase(), delivery = $("#dirDelivery").value;
    const fx = sel.filterExpertise, fa = sel.filterAudiences;
    const list = S.directory.filter(p =>
      (!fx.size || (p.expertise || []).some(x => fx.has(x))) &&
      (!fa.size || (p.audiences || []).some(x => fa.has(x))) &&
      (!delivery || !(p.delivery || []).length || p.delivery.includes(delivery)) &&
      (!q || [p.display_name, p.bio, p.city_state, p.license_type, ...(p.expertise || []), ...(p.audiences || [])].join(" ").toLowerCase().includes(q)));
    $("#resultCount").textContent = S.directory.length ? `Showing ${list.length} of ${S.directory.length} presenter${S.directory.length === 1 ? "" : "s"}` : "";
    if (!list.length) {
      grid.innerHTML = `<div class="empty-state"><svg aria-hidden="true"><use href="#four-mark"/></svg><h3>${S.directory.length ? "No matches" : "The directory is just getting started"}</h3>
        <p>${S.directory.length ? "Try clearing a filter to see more presenters." : "No presenters are listed yet. Licensed professionals can join in about five minutes."}</p>
        ${S.directory.length ? "" : '<a class="btn btn-primary" href="#presenters">Join as a presenter</a>'}</div>`;
      return;
    }
    grid.innerHTML = list.map((p, i) => {
      const initials = p.display_name.split(",")[0].split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
      const more = (p.expertise || []).length > 4 ? `<span class="tag">+${p.expertise.length - 4} more</span>` : "";
      const site = p.website && /^https?:\/\//i.test(p.website) ? `<div class="meta-line"><a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">Website</a></div>` : "";
      return `<article class="profile-card">
        <div class="avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}" aria-hidden="true">${esc(initials)}</div>
        <h3>${esc(p.display_name)}</h3>
        <div class="cred">${esc(shortLicense(p.license_type))} · ${esc(p.license_state)}${p.city_state ? " · " + esc(p.city_state) : ""}<span class="verified">✓ Verified</span></div>
        <div class="bio">${esc(p.bio)}</div>
        <div class="tag-row">${(p.expertise || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join("")}${more}</div>
        ${(p.audiences || []).length ? `<div class="meta-line"><strong>Audiences:</strong> ${p.audiences.map(esc).join(" · ")}</div>` : ""}
        ${(p.delivery || []).length ? `<div class="meta-line"><strong>Delivery:</strong> ${p.delivery.map(esc).join(" · ")}</div>` : ""}
        ${(p.availability || []).length ? `<div class="meta-line"><strong>Usually available:</strong> ${p.availability.map(esc).join(" · ")}</div>` : ""}
        ${site}
        <button type="button" class="btn btn-outline btn-block" data-act="request-presenter" data-id="${esc(p.id)}">Request this presenter</button>
      </article>`;
    }).join("");
  }

  /* ================= presenter sign-up and profile ================= */
  // signup: signed out · complete: signed in, no profile yet · edit: has a profile · blocked: organization account
  const proMode = () => !S.me ? "signup" : S.pro ? "edit" : (S.me.role === "organization" ? "blocked" : "complete");
  function fillProForm() {
    const p = S.pro, v = S.priv || {};
    if (!p) { if (S.me && !$("#proName").value) $("#proName").value = S.me.full_name || ""; return; }
    const set = (id, x) => { $("#" + id).value = x ?? ""; };
    set("proName", p.display_name); set("proCity", p.city_state); set("proLicenseType", p.license_type); set("proLicenseState", p.license_state);
    set("proLicenseNum", v.license_number); set("proYears", v.years_practicing); set("proPhone", v.phone);
    set("proTimezone", v.timezone || "America/New_York"); set("proNotice", v.min_notice_days || 30); set("proBio", p.bio); set("proWebsite", p.website);
    set("proInsCarrier", v.ins_carrier); set("proInsPolicy", v.ins_policy_number); set("proInsLimits", v.ins_limits); set("proInsExpires", v.ins_expires);
    $("#proCommit").checked = !!v.commit_annual;
    setChips("proExpertise", p.expertise); setChips("proAudiences", p.audiences); setChips("proEventTypes", p.event_types);
    setChips("proDelivery", p.delivery); setChips("proAvailability", p.availability);
  }
  function proStatusBanner(target) {
    const st = OPT.PRO_STATUS[S.pro.status], kind = { pending: "wait", approved: "good", rejected: "bad", suspended: "bad" }[S.pro.status];
    target.className = "status-banner " + kind; target.hidden = false;
    target.innerHTML = `<span class="pill ${kind}">${esc(st.label)}</span><span>${esc(st.help)}</span>`;
  }
  function renderPresenterView() {
    const mode = proMode();
    $("#proForm").hidden = mode === "blocked";
    $("#proBlocked").hidden = mode !== "blocked";
    if (mode === "blocked") $("#proBlocked").innerHTML = `You're signed in with an organization account (${esc(S.me.email)}). To join as a presenter, sign out and create a presenter account with a different email.`;
    $("#proAccountBlock").hidden = mode !== "signup";
    $("#proHaveAccount").hidden = mode !== "signup";
    $("#proConsents").hidden = mode === "edit";
    $("#proHeading").textContent = mode === "edit" ? "Your presenter profile" : mode === "complete" ? "Finish your presenter profile" : "Join as a presenter";
    $("#proIntro").textContent = mode === "edit"
      ? "Keep your details current. If you change your license type, state or number, your profile goes back to C4C for a quick re-check before it shows in the directory again."
      : "Create your account and profile in about five minutes. After C4C verifies your license and insurance, your profile appears in the public directory so schools and organizations can request you.";
    $("#proSubmit").textContent = mode === "edit" ? "Save changes" : mode === "complete" ? "Submit my profile for review" : "Create my account and submit for review";
    $("#proInsExpires").min = mode === "edit" ? "" : todayStr();
    if (mode === "edit") proStatusBanner($("#proStatus")); else $("#proStatus").hidden = true;
  }

  $("#proForm").addEventListener("submit", async e => {
    e.preventDefault();
    const mode = proMode(), missing = [];
    let website = val("proWebsite");
    if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;
    const pro = { display_name: val("proName"), city_state: val("proCity"), license_type: val("proLicenseType"),
      license_state: val("proLicenseState").toUpperCase(), bio: val("proBio"), website,
      expertise: [...sel.proExpertise], audiences: [...sel.proAudiences], event_types: [...sel.proEventTypes],
      delivery: [...sel.proDelivery], availability: [...sel.proAvailability] };
    const priv = { phone: val("proPhone"), license_number: val("proLicenseNum"),
      years_practicing: val("proYears") === "" ? null : Math.max(0, parseInt(val("proYears"), 10) || 0),
      timezone: val("proTimezone"), min_notice_days: Math.min(365, Math.max(1, parseInt(val("proNotice"), 10) || 30)),
      ins_carrier: val("proInsCarrier"), ins_policy_number: val("proInsPolicy"), ins_limits: val("proInsLimits"),
      ins_expires: val("proInsExpires"), commit_annual: $("#proCommit").checked };
    const email = val("proEmail").toLowerCase(), password = $("#proPassword").value;

    if (mode === "signup") {
      if (!isEmail(email)) missing.push("a valid email");
      if (!DEMO && password.length < CFG.minPasswordLength) missing.push(`a password of at least ${CFG.minPasswordLength} characters`);
    }
    if (!pro.display_name) missing.push("your name and credentials");
    if (!pro.license_type) missing.push("license type");
    if (!/^[A-Z]{2}$/.test(pro.license_state)) missing.push("the 2-letter state you're licensed in");
    if (!priv.license_number) missing.push("license number");
    if (!pro.expertise.length) missing.push("at least one area of expertise");
    if (!pro.audiences.length) missing.push("at least one audience");
    if (!pro.bio) missing.push("a short bio");
    if (!priv.ins_carrier) missing.push("insurance carrier");
    if (!priv.ins_policy_number) missing.push("insurance policy number");
    if (!priv.ins_limits) missing.push("insurance limits");
    if (!priv.ins_expires) missing.push("insurance expiration date");
    if (missing.length) return showError("proError", "Please add: " + missing.join(", ") + ".");
    if (priv.ins_expires < todayStr()) return showError("proError", "The liability insurance you entered has expired. Please enter your current policy.");
    if (mode !== "edit" && !(["proConsentLicensed", "proConsentIndependent", "proConsentPrivacy"].every(id => $("#" + id).checked))) {
      return showError("proError", "Please tick the three confirmation boxes before submitting.");
    }
    showError("proError", "");

    await run($("#proSubmit"), async () => {
      if (mode === "signup") {
        const { needsConfirm } = await B.signUp({ email, password, role: "professional", full_name: pro.display_name });
        if (needsConfirm) {
          draft.save({ kind: "pro", email, pro, priv });
          $("#proForm").hidden = true; $("#proBlocked").hidden = false;
          $("#proBlocked").innerHTML = `<strong>Check your email.</strong> We sent a confirmation link to ${esc(email)}. Open it on this device and your profile will be submitted for review automatically.`;
          window.scrollTo({ top: 0 });
          return;
        }
      }
      await B.saveProfessional(pro, priv);
      $("#proPassword").value = "";
      await refresh();
      if (mode === "edit") { fillProForm(); toast("Profile saved."); window.scrollTo({ top: 0 }); }
      else { toast("Thanks! Your profile was submitted. C4C will verify your license and insurance."); go("account"); }
    });
  });

  /* ================= organization sign-up and details ================= */
  const orgMode = () => !S.me ? "signup" : S.org ? "edit" : (S.me.role === "professional" ? "blocked" : "complete");
  function fillOrgForm() {
    const o = S.org;
    if (!o) {
      if (S.me) { if (!$("#orgLeadName").value) $("#orgLeadName").value = S.me.full_name || ""; if (!$("#orgEmail").value) $("#orgEmail").value = S.me.email || ""; }
      return;
    }
    $("#orgName").value = o.name; $("#orgType").value = o.org_type; $("#orgLeadName").value = o.lead_name; $("#orgEmail").value = o.lead_email;
    $("#orgCc").value = (o.cc_emails || []).join(", ");
    $("#orgPrior").value = o.prior_contact === true ? "yes" : o.prior_contact === false ? "no" : "";
  }
  function renderOrgView() {
    const mode = orgMode();
    $("#orgForm").hidden = mode === "blocked";
    $("#orgBlocked").hidden = mode !== "blocked";
    if (mode === "blocked") $("#orgBlocked").innerHTML = `You're signed in with a presenter account (${esc(S.me.email)}). To request a presenter for a school or organization, sign out and create an organization account with a different email.`;
    $("#orgPasswordField").hidden = DEMO || mode !== "signup";
    $("#orgHaveAccount").hidden = mode !== "signup";
    $("#orgConsents").hidden = mode === "edit";
    $("#orgEmailHint").textContent = mode === "signup" ? "This is how you'll sign in." : "Updates about your requests go to this address.";
    $("#orgHeading").textContent = mode === "edit" ? "Your organization" : mode === "complete" ? "Finish setting up your organization" : "Bring a presenter to your community";
    $("#orgIntro").textContent = mode === "edit"
      ? "Keep your contact details current. Everyone listed under \"others to keep in the loop\" is copied on updates about your requests."
      : "Create a free account for your school or organization with one lead contact. Then request a presenter and follow the request from your dashboard.";
    $("#orgSubmit").textContent = mode === "edit" ? "Save changes" : mode === "complete" ? "Save organization" : "Create organization account";
  }
  $("#orgForm").addEventListener("submit", async e => {
    e.preventDefault();
    const mode = orgMode(), missing = [];
    const email = val("orgEmail").toLowerCase(), password = $("#orgPassword").value;
    const cc = val("orgCc").split(/[,;\s]+/).filter(Boolean).map(x => x.toLowerCase());
    const prior = val("orgPrior");
    const org = { name: val("orgName"), org_type: val("orgType"), lead_name: val("orgLeadName"), lead_email: email,
      cc_emails: cc, prior_contact: prior === "yes" ? true : prior === "no" ? false : null };
    if (!org.name) missing.push("the school or organization name");
    if (!org.lead_name) missing.push("the lead contact's name");
    if (!isEmail(email)) missing.push("a valid lead contact email");
    if (mode === "signup" && !DEMO && password.length < CFG.minPasswordLength) missing.push(`a password of at least ${CFG.minPasswordLength} characters`);
    if (missing.length) return showError("orgError", "Please add: " + missing.join(", ") + ".");
    if (cc.some(x => !isEmail(x))) return showError("orgError", "One of the extra email addresses doesn't look right. Separate addresses with commas.");
    if (mode !== "edit" && !$("#orgConsent").checked) return showError("orgError", "Please tick the confirmation box before continuing.");
    showError("orgError", "");

    await run($("#orgSubmit"), async () => {
      if (mode === "signup") {
        const { needsConfirm } = await B.signUp({ email, password, role: "organization", full_name: org.lead_name });
        if (needsConfirm) {
          draft.save({ kind: "org", email, org });
          $("#orgForm").hidden = true; $("#orgBlocked").hidden = false;
          $("#orgBlocked").innerHTML = `<strong>Check your email.</strong> We sent a confirmation link to ${esc(email)}. Open it on this device to finish setting up your organization.`;
          window.scrollTo({ top: 0 });
          return;
        }
      }
      await B.saveOrganization(org);
      $("#orgPassword").value = "";
      await refresh();
      if (mode === "edit") { fillOrgForm(); toast("Organization saved."); return; }
      toast(org.prior_contact === false ? "Welcome! Your account is ready, and C4C will reach out to offer a quick intro call." : "Welcome! Your organization account is ready.");
      go(S.target ? "request" : "account");
    });
  });

  $("#trackForm").addEventListener("submit", async e => {
    e.preventDefault();
    const out = $("#trackResult");
    await run(e.target.querySelector("button"), async () => {
      const t = await B.track(val("trackId"), val("trackEmail"));
      if (!t) { out.textContent = "We couldn't find a request with that tracking number and email."; return; }
      const st = OPT.STATUS[t.status];
      out.innerHTML = `<div><strong>${esc(t.event_type)}</strong> for ${esc(t.org_name)}</div>
        <div style="margin:6px 0">${statusPill(t.status)}</div><div>${esc(st.help)}</div>
        <div class="hint">${t.presenter_name ? "Presenter: " + esc(t.presenter_name) + " · " : ""}${t.event_starts_at ? esc(fmtInstant(t.event_starts_at)) : "Window: " + esc(fmtWindow(t))}</div>
        <ol>${(t.history || []).map(h => `<li>${esc(fmtDate(h.at))}: ${esc(h.what)}</li>`).join("")}</ol>`;
    });
  });

  /* ================= request form ================= */
  function renderRequestView() {
    const gate = $("#reqGate"), form = $("#reqForm");
    const showGate = html => { gate.innerHTML = html; gate.hidden = false; form.hidden = true; };
    if (!S.me) return showGate(`<h3>Start with an organization account</h3><p>It's free and takes a minute. You'll use it to make requests and follow their progress.</p>
      <div class="btn-row"><a class="btn btn-gold" href="#organizations">Create an account</a><a class="btn btn-outline" href="#account">Sign in</a></div>`);
    if (!S.org) return showGate(S.me.role === "professional"
      ? `<h3>Requests come from organization accounts</h3><p>You're signed in as a presenter. To request a presenter for a school or organization, sign out and use an organization account.</p>`
      : `<h3>One more step</h3><p>Tell us about your school or organization, then you can make a request.</p><div class="btn-row"><a class="btn btn-gold" href="#organizations">Set up my organization</a></div>`);
    gate.hidden = true; form.hidden = false;
    const t = S.target && S.directory.find(p => p.id === S.target);
    $("#targeted").hidden = !t;
    if (t) {
      $("#targetedName").textContent = `${t.display_name} (${shortLicense(t.license_type)})`;
      $("#targetedAvail").textContent = (t.availability || []).length ? `Usually available: ${t.availability.join(" · ")}` : "";
    }
  }
  $("#reqForm").addEventListener("submit", async e => {
    e.preventDefault();
    const missing = [], ws = val("reqWindowStart"), we = val("reqWindowEnd"), custom = val("reqCustomAmount");
    const fields = { requested_professional_id: S.target || null, event_type: val("reqEventType"), topics: [...sel.reqTopics],
      audiences: [...sel.reqAudiences], age_range: val("reqAges") || null,
      attendees_expected: val("reqAttendees") === "" ? null : Math.max(1, parseInt(val("reqAttendees"), 10) || 1),
      delivery: val("reqDelivery"), location: val("reqLocation") || null, duration_min: parseInt(val("reqDuration"), 10),
      timezone: val("reqTimezone"), window_start: ws, window_end: we, description: val("reqDesc"),
      support_level: custom ? `$${custom} (custom)` : S.supportTier };
    if (!fields.event_type) missing.push("session type");
    if (!ws || !we) missing.push("a preferred date window");
    if (!fields.audiences.length) missing.push("at least one audience");
    if (!fields.description) missing.push("a few words about the session");
    if (missing.length) return showError("reqError", "Please add: " + missing.join(", ") + ".");
    if (ws < todayStr() || we < ws) return showError("reqError", "The window should start today or later, and end on or after its start date.");
    showError("reqError", "");
    await run(e.target.querySelector("[type=submit]"), async () => {
      const r = await B.createRequest(fields);
      e.target.reset(); setChips("reqAudiences", []); setChips("reqTopics", []);
      $$("#supportCards .radio-card").forEach(c => c.setAttribute("aria-pressed", "false"));
      S.supportTier = null; S.target = null;
      await refresh();
      toast(`Request received. Your tracking number is ${r.tracking_id}.`);
      go("account");
    });
  });

  /* ================= request cards (account and admin) ================= */
  const PILL = { new: "neutral", matching: "wait", awaiting_presenter: "wait", connected: "info", confirmed: "good", completed: "good", declined: "bad", cancelled: "bad" };
  const statusPill = s => `<span class="pill ${PILL[s] || "neutral"}">${esc((OPT.STATUS[s] || { label: s }).label)}</span>`;
  const fact = (label, value) => (value || value === 0) && value !== "" ? `<div><span>${esc(label)}</span>${value}</div>` : "";
  const mailto = (email, text) => `<a href="mailto:${esc(email)}">${esc(text || email)}</a>`;

  function scheduleForm(r, isChange) {
    const tz = r.timezone || "America/New_York", ev = r.event;
    const inner = `<form data-form="schedule" data-id="${esc(r.id)}">
        <div class="row3">
          <div><label>Date<input type="date" name="date" min="${todayStr()}" required></label></div>
          <div><label>Start time<input type="time" name="time" required></label></div>
          <div><label>Timezone<select name="tz">${OPT.TIMEZONES.map(t => `<option value="${esc(t[0])}" ${t[0] === tz ? "selected" : ""}>${esc(t[1])}</option>`).join("")}</select></label></div>
        </div>
        <div class="row2">
          <div><label>Length (minutes)<input type="number" name="duration" min="15" max="480" value="${esc((ev && ev.duration_min) || r.duration_min || 60)}"></label></div>
          <div><label>Location<input type="text" name="location" value="${esc((ev && ev.location) || r.location || "")}"></label></div>
        </div>
        <div class="btn-row"><button type="submit" class="btn btn-primary btn-sm">${isChange ? "Save new date" : "Confirm this date"}</button></div>
      </form>`;
    return isChange ? `<details class="history"><summary>Change the date</summary>${inner}</details>`
      : `<div class="req-box action"><h4>Set the date</h4><p>Once you've agreed on a date together, record it here. Both sides get calendar links.</p>${inner}</div>`;
  }

  function requestCard(r, role) {
    const st = OPT.STATUS[r.status] || { label: r.status, help: "" };
    const closed = ["completed", "cancelled", "declined"].includes(r.status);
    const meId = S.me.id, org = r.organization || {};
    const isMatched = !!r.matched && r.matched.id === meId, isRequested = !!r.requested && r.requested.id === meId;
    const myCand = (r.candidates || []).find(c => c.professional_id === meId);
    const party = role === "org" || role === "admin" || isMatched;
    const eventPast = r.event && new Date(r.event.starts_at) <= new Date();
    let boxes = "", help = st.help, actions = "";
    if (r.status === "confirmed" && eventPast) {
      help = isMatched || role === "admin" ? "The session date has passed. Please record how it went." : "The session date has passed. Your presenter will record how it went.";
    }

    /* ---- presenter ---- */
    if (role === "pro") {
      if (r.status === "awaiting_presenter" && isRequested) {
        help = `${org.name} asked for you by name.`;
        boxes += `<div class="req-box action"><h4>Can you take this one?</h4><p>If you accept, you'll be introduced to ${esc(org.lead_name || "the lead contact")} to settle the exact date.</p>
          <div class="btn-row"><button type="button" class="btn btn-primary btn-sm" data-act="respond" data-id="${esc(r.id)}" data-accept="1">Accept</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="respond" data-id="${esc(r.id)}" data-accept="0">I can't take this one</button></div></div>`;
      } else if (r.status === "matching" && myCand && !myCand.response) {
        help = "C4C thinks you'd be a good fit for this request.";
        boxes += `<div class="req-box action"><h4>Are you interested?</h4><p>If you say yes, the organization sees your profile and can choose you. Nothing is booked yet.</p>
          <div class="btn-row"><button type="button" class="btn btn-primary btn-sm" data-act="respond" data-id="${esc(r.id)}" data-accept="1">I'm interested</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="respond" data-id="${esc(r.id)}" data-accept="0">Not this time</button></div></div>`;
      } else if (r.status === "matching" && myCand && myCand.response === "interested") {
        help = "You said you're interested. The organization will choose a presenter soon.";
      } else if (myCand && myCand.response === "declined" && !isMatched) {
        help = "You passed on this one. Thanks for letting us know.";
      } else if (!isMatched && ["connected", "confirmed", "completed"].includes(r.status)) {
        help = "Another presenter is handling this request.";
      } else if (r.status === "matching" && isRequested) {
        help = "You passed on this one. C4C is finding another presenter.";
      }
      if (isMatched && org.lead_email && !closed) {
        boxes += `<div class="req-box"><h4>Your contact</h4><p><strong>${esc(org.lead_name)}</strong>, ${esc(org.name)} · ${mailto(org.lead_email)}</p></div>`;
      }
    }

    /* ---- organization ---- */
    if (role === "org") {
      const interested = (r.candidates || []).filter(c => c.response === "interested");
      if (r.status === "matching") {
        if (interested.length) {
          boxes += `<div class="req-box action"><h4>Interested presenters</h4><p>Choose one to be introduced and settle the date.</p>${interested.map(c =>
            `<div class="cand-row"><span><strong>${esc(c.display_name)}</strong> · <a href="#directory" data-act="view-presenter" data-name="${esc(c.display_name)}">view profile</a></span>
             <button type="button" class="btn btn-primary btn-sm" data-act="choose" data-id="${esc(r.id)}" data-pro="${esc(c.professional_id)}">Choose</button></div>`).join("")}</div>`;
        } else help = "C4C has invited best-fit presenters. You'll see them here as they respond.";
      }
      if (r.status === "awaiting_presenter" && r.requested) help = `Waiting for ${r.requested.display_name} to reply.`;
      if (r.matched && !closed) {
        boxes += `<div class="req-box"><h4>Your presenter</h4><p><strong>${esc(r.matched.display_name)}</strong>${r.matched.email ? " · " + mailto(r.matched.email) : ""}</p></div>`;
      }
    }

    /* ---- admin ---- */
    if (role === "admin") {
      const cands = r.candidates || [];
      boxes += `<div class="req-box"><h4>Organization</h4><p><strong>${esc(org.name)}</strong> · ${esc(org.org_type || "")}${org.prior_contact === false ? ' <span class="tagmini">New to C4C</span>' : ""}<br>
        ${esc(org.lead_name)} · ${mailto(org.lead_email)}${(org.cc_emails || []).length ? "<br>Also copied: " + org.cc_emails.map(esc).join(", ") : ""}</p></div>`;
      if (r.matched || r.requested || cands.length) {
        boxes += `<div class="req-box"><h4>Presenters</h4>
          ${r.matched ? `<p>Matched: <strong>${esc(r.matched.display_name)}</strong>${r.matched.email ? " · " + mailto(r.matched.email) : ""}</p>` : ""}
          ${r.requested && !r.matched ? `<p>Requested by the organization: <strong>${esc(r.requested.display_name)}</strong></p>` : ""}
          ${cands.map(c => `<div class="cand-row"><span>${esc(c.display_name)}<span class="score">fit ${esc(c.score)}</span></span>
             <span>${c.response === "interested" ? '<span class="pill good">Interested</span>' : c.response === "declined" ? '<span class="pill bad">Passed</span>' : '<span class="pill wait">No reply yet</span>'}</span></div>`).join("")}</div>`;
      }
      const sug = S.suggestions[r.id], canMatch = !closed && !["connected", "confirmed"].includes(r.status);
      if (canMatch && sug) {
        const canInvite = ["new", "matching", "declined"].includes(r.status);
        boxes += `<div class="req-box action"><h4>Suggested presenters</h4>${!sug.length ? "<p>No approved presenters yet.</p>" : sug.map((s, i) => {
          const already = cands.some(c => c.professional_id === s.professional_id);
          return `<div class="suggest-row"><label><input type="checkbox" data-suggest="${esc(r.id)}" value="${esc(s.professional_id)}" ${already || !canInvite ? "disabled" : (i < 5 && s.score > 0 ? "checked" : "")}>
            ${esc(s.display_name)}<span class="score">fit ${esc(s.score)}</span>${already ? ' <span class="hint">already invited</span>' : ""}</label>
            <button type="button" class="link-btn" data-act="admin-assign" data-id="${esc(r.id)}" data-pro="${esc(s.professional_id)}" data-name="${esc(s.display_name)}">Assign directly</button></div>`;
        }).join("") + (canInvite
          ? `<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" data-act="admin-invite" data-id="${esc(r.id)}">Invite selected</button></div><p class="hint">Invited presenters are emailed and can say they're interested. The organization then chooses.</p>`
          : `<p class="hint">Invitations open once the requested presenter has replied. You can still assign someone directly.</p>`)}</div>`;
      }
      actions += `<label class="sr-only" for="st-${esc(r.id)}">Status</label>
        <select class="status-select" id="st-${esc(r.id)}" data-change="admin-status" data-id="${esc(r.id)}">${Object.entries(OPT.STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>
        ${canMatch && !sug ? `<button type="button" class="link-btn" data-act="admin-suggest" data-id="${esc(r.id)}">Suggest presenters</button>` : ""}
        <button type="button" class="link-btn danger" data-act="admin-remove-request" data-id="${esc(r.id)}">Remove</button>`;
    }

    /* ---- shared: date, outcome, cancel ---- */
    if (r.event) {
      boxes += `<div class="req-box"><h4>${eventPast ? "Session" : "On the calendar"}</h4>
        <p><strong>${esc(fmtInstant(r.event.starts_at, r.timezone))}</strong> · ${esc(r.event.duration_min)} minutes${r.event.location ? " · " + esc(r.event.location) : ""}</p>
        ${r.event.attendance_actual != null ? `<p>Attendance: <strong>${esc(r.event.attendance_actual)}</strong>${r.event.presenter_hours != null ? ` · Presenter time: <strong>${esc(r.event.presenter_hours)} h</strong>` : ""}</p>` : ""}
        ${!eventPast && party ? `<div class="btn-row"><a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${esc(googleCalUrl(r))}">Add to Google Calendar</a>
          <button type="button" class="btn btn-outline btn-sm" data-act="ics" data-id="${esc(r.id)}">Download .ics (Apple / Outlook)</button></div>` : ""}
        ${!eventPast && party && r.status === "confirmed" ? scheduleForm(r, true) : ""}</div>`;
    }
    if (party && r.status === "connected" && r.matched) boxes += scheduleForm(r, false);
    if (r.status === "confirmed" && eventPast && (isMatched || role === "admin")) {
      boxes += `<div class="req-box action"><h4>How did it go?</h4><p>Record the turnout so C4C can report its impact.</p>
        <form data-form="outcome" data-id="${esc(r.event.id)}"><div class="row2">
          <div><label>People who attended<input type="number" name="attendance" min="0" required></label></div>
          <div><label>Your time, in hours (including prep)<input type="number" name="hours" min="0" step="0.25" required></label></div>
        </div><div class="btn-row"><button type="submit" class="btn btn-primary btn-sm">Save and mark complete</button></div></form></div>`;
    }
    if (role === "org" && !closed) actions += `<button type="button" class="link-btn danger" data-act="cancel" data-id="${esc(r.id)}">Cancel this request</button>`;

    const title = role === "org" ? r.event_type : `${r.event_type} · ${org.name || ""}`;
    return `<article class="req-card${closed ? " closed" : ""}">
      <div class="req-top"><div><h4 class="req-title">${esc(title)}</h4>
        <div class="req-sub"><code>${esc(r.tracking_id)}</code> · submitted ${esc(fmtDate(r.created_at))}</div></div>${statusPill(r.status)}</div>
      <p class="req-help">${esc(help)}</p>
      <div class="req-facts">
        ${fact("Preferred window", esc(fmtWindow(r)))}${fact("Audience", (r.audiences || []).map(esc).join(", "))}${fact("Ages / grades", esc(r.age_range))}
        ${fact("Expected attendance", esc(r.attendees_expected))}${fact("Delivery", esc(r.delivery))}${fact("Length", esc(r.duration_min) + " minutes")}
        ${fact("Location", esc(r.location))}${fact("Topics", (r.topics || []).map(esc).join(", "))}${role !== "pro" ? fact("Support level", esc(r.support_level)) : ""}
      </div>
      <p class="req-desc">${esc(r.description)}</p>
      ${boxes}
      ${actions ? `<div class="req-actions">${actions}</div>` : ""}
      ${(r.history || []).length ? `<details class="history"><summary>Timeline (${r.history.length})</summary><ol>${r.history.map(h => `<li>${esc(fmtDate(h.at))}: ${esc(h.what)}</li>`).join("")}</ol></details>` : ""}
    </article>`;
  }

  /* ================= account ================= */
  async function renderAccount() {
    $("#accountRecovery").hidden = !S.recovery;
    $("#accountSignedOut").hidden = S.recovery || !!S.me;
    $("#accountSignedIn").hidden = S.recovery || !S.me;
    if (S.recovery) return;
    if (!S.me) {
      if (DEMO) {
        const box = $("#demoAccounts"), accounts = await B.demo.accounts();
        box.hidden = false;
        box.innerHTML = `<h4>Demo accounts</h4><p class="hint">Demo mode has no passwords. Pick an account to see the portal from that side.</p>` +
          (accounts.length ? accounts.map(a => `<div class="acct"><span><strong>${esc(a.full_name)}</strong><br><span class="hint">${a.role === "organization" ? "Organization" : "Presenter"} · ${esc(a.email)}</span></span>
            <button type="button" class="btn btn-outline btn-sm" data-act="demo-signin" data-email="${esc(a.email)}">Sign in</button></div>`).join("")
            : `<p class="hint">No accounts yet. <button type="button" class="link-btn" data-act="seed">Load sample data</button> to get a few to try.</p>`);
      }
      return;
    }
    $("#accountHello").textContent = "Welcome, " + (S.me.full_name || "").split(",")[0].split(" ")[0];
    $("#accountEmail").textContent = `Signed in as ${S.me.email}${DEMO ? " (demo)" : ""}`;
    let html = "";

    if (isAdmin()) {
      html += `<section class="dash-section"><div class="card"><div class="dash-head"><h3>C4C admin</h3><a class="btn btn-primary btn-sm" href="#admin">Open the dashboard</a></div>
        <p class="hint">Review presenters, follow requests and see every email the portal sends.</p></div></section>`;
    }

    if (S.pro) {
      const st = OPT.PRO_STATUS[S.pro.status], kind = { pending: "wait", approved: "good", rejected: "bad", suspended: "bad" }[S.pro.status];
      const exp = S.priv && S.priv.ins_expires, soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const insNote = !exp ? "" : exp < todayStr()
        ? `<div class="status-banner bad"><span class="pill bad">Insurance expired</span><span>The liability insurance on file expired on ${esc(fmtDay(exp))}. Please update it to keep presenting.</span></div>`
        : exp <= soon ? `<div class="status-banner wait"><span class="pill wait">Renewing soon</span><span>Your liability insurance on file expires on ${esc(fmtDay(exp))}. Update it once you've renewed.</span></div>` : "";
      const mine = S.requests.filter(r => (r.matched && r.matched.id === S.me.id) || (r.requested && r.requested.id === S.me.id) || (r.candidates || []).some(c => c.professional_id === S.me.id));
      html += `<section class="dash-section">
        <div class="dash-head"><h3>Your presenter profile</h3><a class="btn btn-outline btn-sm" href="#presenters">Edit profile</a></div>
        <div class="status-banner ${kind}"><span class="pill ${kind}">${esc(st.label)}</span><span>${esc(st.help)}</span></div>${insNote}
        <div class="dash-head" style="margin-top:28px"><h3>Invitations and sessions</h3></div>
        ${mine.length ? `<div class="request-list">${mine.map(r => requestCard(r, "pro")).join("")}</div>`
          : `<div class="empty-box">Nothing here yet. When an organization requests you, or C4C thinks you're a good fit for a request, it will show up here and you'll get an email.</div>`}
      </section>`;
    } else if (S.me.role === "professional") {
      html += `<section class="dash-section"><div class="card gate"><h3>Finish your presenter profile</h3><p>Your account is ready. Add your license, expertise and insurance details so C4C can review and list you.</p>
        <div class="btn-row"><a class="btn btn-primary" href="#presenters">Complete my profile</a></div></div></section>`;
    }

    if (S.org) {
      const mine = S.requests.filter(r => r.organization && r.organization.id === S.org.id);
      html += `<section class="dash-section">
        <div class="dash-head"><h3>${esc(S.org.name)}</h3><div class="toolbar-actions"><a class="btn btn-gold btn-sm" href="#request">New request</a><a class="btn btn-outline btn-sm" href="#organizations">Edit details</a></div></div>
        <div class="card"><div class="dash-summary">
          <div><span>Type</span>${esc(S.org.org_type)}</div><div><span>Lead contact</span>${esc(S.org.lead_name)} · ${esc(S.org.lead_email)}</div>
          <div><span>Also kept in the loop</span>${(S.org.cc_emails || []).length ? S.org.cc_emails.map(esc).join(", ") : "No one yet"}</div></div></div>
        <div class="dash-head" style="margin-top:28px"><h3>Your requests</h3></div>
        ${mine.length ? `<div class="request-list">${mine.map(r => requestCard(r, "org")).join("")}</div>`
          : `<div class="empty-box">No requests yet. <a href="#directory">Browse the directory</a> to request someone by name, or <a href="#request">describe what you need</a> and C4C will suggest presenters.</div>`}
      </section>`;
    } else if (S.me.role === "organization") {
      html += `<section class="dash-section"><div class="card gate"><h3>Finish setting up your organization</h3><p>Add your school or organization's details, then you can request a presenter.</p>
        <div class="btn-row"><a class="btn btn-gold" href="#organizations">Set up my organization</a></div></div></section>`;
    }
    $("#accountBody").innerHTML = html;
  }

  $("#signInForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = val("siEmail").toLowerCase(), password = $("#siPassword").value;
    if (!isEmail(email)) return showError("siError", "Enter the email you signed up with.");
    if (!DEMO && !password) return showError("siError", "Enter your password.");
    showError("siError", "");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    try { await B.signIn({ email, password }); $("#siPassword").value = ""; await refresh(); await submitDraftIfAny(); }
    catch (err) { showError("siError", err.message); }
    finally { btn.disabled = false; }
  });
  $("#forgotBtn").addEventListener("click", e => run(e.target, async () => {
    const email = val("siEmail").toLowerCase();
    if (!isEmail(email)) return showError("siError", "Enter your email above first, then choose \"Forgot your password?\" again.");
    showError("siError", "");
    await B.resetPassword(email);
    toast("If that email has an account, a link to reset your password is on its way.");
  }));
  $("#recoveryForm").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = $("#newPassword").value;
    if (pw.length < CFG.minPasswordLength) return showError("recoveryError", `Use at least ${CFG.minPasswordLength} characters.`);
    showError("recoveryError", "");
    await run(e.target.querySelector("[type=submit]"), async () => {
      await B.updatePassword(pw);
      S.recovery = false; $("#newPassword").value = "";
      toast("Password updated."); await refresh();
    });
  });
  $("#signOutBtn").addEventListener("click", e => run(e.target, async () => { await B.signOut(); await refresh(); go("home"); }));

  /* ================= admin ================= */
  const EMAIL_LABEL = {
    application_received: "Application received", admin_new_presenter: "New presenter to review", profile_approved: "Profile approved",
    admin_reverify_presenter: "Presenter changed license details", admin_new_organization: "New organization", intro_call_offer: "Intro call offer",
    request_received: "Request received", admin_new_request: "New request", presenter_invited: "Invitation to present",
    presenter_interested: "A presenter is interested", admin_presenter_interested: "A presenter is interested (C4C copy)",
    connected_organization: "You're connected (to organization)", connected_presenter: "You're connected (to presenter)", admin_connection: "New connection",
    event_confirmed: "Date confirmed", admin_event_confirmed: "Date confirmed (C4C copy)", event_rescheduled: "Date changed",
    admin_event_rescheduled: "Date changed (C4C copy)", admin_needs_matching: "Request needs matching",
    request_cancelled: "Request cancelled", admin_request_cancelled: "Request cancelled (C4C copy)",
    outreach_campaign: "Outreach invitation"
  };
  function renderAdmin() {
    const gate = $("#adminGate"), panel = $("#adminPanel");
    if (!isAdmin() || !S.admin) {
      panel.hidden = true; gate.hidden = false;
      gate.innerHTML = DEMO
        ? `<div class="page-head flush"><div class="eyebrow">C4C admin</div><h2>Demo admin</h2></div>
           <form id="demoAdminForm" class="card"><p class="hint" style="margin-bottom:14px">Enter the demo passcode to see the admin dashboard. With the live backend, board members sign in with their own accounts instead.</p>
           <div class="field"><label for="demoPasscode">Passcode</label><input type="password" id="demoPasscode" autocomplete="off"></div>
           <div class="error-text" id="demoAdminError" role="alert"></div><button type="submit" class="btn btn-primary btn-block">Open dashboard</button></form>`
        : `<div class="card gate" style="margin-top:48px"><h3>Admins only</h3><p>${S.me ? "This account doesn't have admin access." : "Sign in with a C4C admin account to open the dashboard."}</p>
           ${S.me ? "" : '<div class="btn-row"><a class="btn btn-primary" href="#account">Sign in</a></div>'}</div>`;
      return;
    }
    gate.hidden = true; panel.hidden = false;
    const A = S.admin, pros = A.professionals, reqs = A.requests;
    const open = reqs.filter(r => ["new", "matching", "awaiting_presenter"].includes(r.status));
    $("#kpis").innerHTML = [[pros.filter(p => p.status === "approved").length, "Live presenters"], [pros.filter(p => p.status === "pending").length, "Waiting for review"],
      [open.length, "Open requests"], [reqs.filter(r => ["connected", "confirmed", "completed"].includes(r.status)).length, "Connections made"]]
      .map(k => `<div class="kpi"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("");

    /* presenters */
    const pf = $("#adminProFilter").value, today = todayStr();
    const proRows = pros.filter(p => !pf || p.status === pf);
    $("#adminProBody").innerHTML = proRows.length ? proRows.map(p => {
      const v = p.private || {}, kind = { pending: "wait", approved: "good", rejected: "bad", suspended: "bad" }[p.status];
      const ins = v.ins_carrier
        ? `${esc(v.ins_carrier)} · ${esc(v.ins_limits)} · policy ${esc(v.ins_policy_number)}<br>expires ${esc(fmtDay(v.ins_expires))}${v.ins_expires < today ? ' <span class="flag-bad">EXPIRED</span>' : ""}
           ${v.ins_verified_at ? ' · <span class="flag-ok">verified</span>' : ' · <span class="flag-bad">not yet verified</span>'}`
        : '<span class="flag-bad">No insurance on file</span>';
      const act = (label, a, extra) => `<button type="button" class="link-btn${extra || ""}" data-act="${a}" data-id="${esc(p.id)}" data-name="${esc(p.display_name)}">${label}</button>`;
      return `<tr>
        <td><strong>${esc(p.display_name)}</strong><br><span class="hint">${esc(p.city_state || "")}</span>${p.website && /^https?:\/\//i.test(p.website) ? `<br><a class="hint" href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">website</a>` : ""}</td>
        <td>${mailto(p.email)}${v.phone ? "<br>" + esc(v.phone) : ""}</td>
        <td>${esc(shortLicense(p.license_type))} · ${esc(p.license_state)} · #${esc(v.license_number || "")}${v.years_practicing != null ? " · " + esc(v.years_practicing) + " yrs" : ""}
          <br><span class="hint">${ins}</span>${v.commit_annual ? '<br><span class="tagmini">Will present yearly</span>' : ""}</td>
        <td>${(p.expertise || []).map(x => `<span class="tagmini">${esc(x)}</span>`).join("")}</td>
        <td>${esc(fmtDate(p.created_at))}</td>
        <td><span class="pill ${kind}">${esc(OPT.PRO_STATUS[p.status].label)}</span></td>
        <td>${p.status !== "approved" ? act("Approve", "pro-approve") : ""}${p.status === "pending" ? act("Don't approve", "pro-reject") : ""}${p.status === "approved" ? act("Pause", "pro-suspend") : ""}
          ${v.ins_carrier ? act(v.ins_verified_at ? "Unmark insurance" : "Mark insurance verified", v.ins_verified_at ? "ins-unverify" : "ins-verify") : ""}${act("Remove", "pro-remove", " danger")}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="admin-empty">${pf ? "No presenters with this status." : "No presenters yet."}</td></tr>`;

    /* requests */
    const rf = $("#adminReqFilter").value;
    const reqRows = reqs.filter(r => !rf || (rf === "open" ? open.includes(r) : r.status === rf));
    $("#adminReqList").innerHTML = reqRows.length ? reqRows.map(r => requestCard(r, "admin")).join("") : `<div class="empty-box">${rf ? "No requests match this filter." : "No requests yet."}</div>`;

    /* organizations */
    $("#adminOrgBody").innerHTML = A.organizations.length ? A.organizations.map(o => `<tr>
      <td><strong>${esc(o.name)}</strong><br><span class="hint">${esc(o.org_type)}</span></td>
      <td>${esc(o.lead_name)}<br>${mailto(o.lead_email)}</td>
      <td>${(o.cc_emails || []).map(esc).join("<br>") || '<span class="hint">None</span>'}</td>
      <td>${esc(fmtDate(o.created_at))}</td>
      <td>${o.prior_contact === false ? `<span class="tagmini">New to C4C</span><br><span class="hint">Intro call offered ${esc(fmtDate(o.intro_call_offered_at))}</span><br>` : o.prior_contact === true ? '<span class="hint">Has worked with C4C</span><br>' : ""}
        <span class="hint">${reqs.filter(r => r.organization && r.organization.id === o.id).length} request(s)</span></td></tr>`).join("")
      : `<tr><td colspan="5" class="admin-empty">No organizations yet.</td></tr>`;

    /* emails */
    $("#emailNote").textContent = DEMO ? "Demo mode: these are the emails the live portal would send. Nothing is delivered."
      : "Messages show as queued until email sending is switched on.";
    $("#adminEmailBody").innerHTML = A.outbox.length ? A.outbox.map(m => {
      const p = m.payload || {}, about = p.tracking_id ? `${esc(p.tracking_id)} · ${esc(p.org_name || "")}` : esc(p.presenter_name || p.org_name || p.campaign_name || "");
      const status = DEMO ? '<span class="pill neutral">Not sent (demo)</span>' : `<span class="pill ${{ queued: "wait", sent: "good", failed: "bad", skipped: "neutral" }[m.status] || "neutral"}">${esc(m.status)}</span>`;
      return `<tr><td>${esc(new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td>
        <td>${esc(EMAIL_LABEL[m.template] || m.template)}</td>
        <td>${(m.to_emails || []).map(esc).join("<br>")}${(m.cc_emails || []).length ? `<br><span class="hint">cc ${m.cc_emails.map(esc).join(", ")}</span>` : ""}</td>
        <td>${about}</td><td>${status}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="admin-empty">No emails yet.</td></tr>`;
    renderOutreach();
  }

  /* ================= outreach campaigns ================= */
  const AUDIENCE_LABEL = { professional: "Licensed professionals", organization: "Schools and organizations" };
  const CONTACT_PILL = { active: ["neutral", "Can be invited"], unsubscribed: ["bad", "Unsubscribed"], bounced: ["bad", "Bounced"], joined: ["good", "Has an account"] };
  function renderOutreach() {
    const O = S.outreach;
    if (!O) return;
    const addr = $("#outMailingAddress");
    if (document.activeElement !== addr) addr.value = O.settings.mailing_address || "";

    $("#campaignList").innerHTML = O.campaigns.length ? O.campaigns.map(c => {
      const draft = c.status === "draft";
      const btn = (label, act, cls) => `<button type="button" class="${cls || "link-btn"}" data-act="${act}" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-n="${esc(c.eligible)}">${label}</button>`;
      return `<article class="req-card${draft ? "" : " closed"}">
        <div class="req-top"><div><h4 class="req-title">${esc(c.name)}</h4>
          <div class="req-sub">For ${esc(AUDIENCE_LABEL[c.audience].toLowerCase())} · created ${esc(fmtDate(c.created_at))}${c.queued_at ? " · queued " + esc(fmtDate(c.queued_at)) : ""}</div></div>
          <span class="pill ${draft ? "wait" : c.status === "queued" ? "good" : "bad"}">${draft ? "Draft" : c.status === "queued" ? "Queued" : "Cancelled"}</span></div>
        <div class="req-facts">
          ${fact("Subject", esc(c.subject))}
          ${draft ? fact("Would go to", `${esc(c.eligible)} contact${c.eligible === 1 ? "" : "s"}`) : fact("Went to", `${esc(c.recipients)} contact${c.recipients === 1 ? "" : "s"}`)}
          ${draft ? "" : fact("Delivered so far", esc(c.sent) + (c.failed ? ` · ${esc(c.failed)} failed` : ""))}
        </div>
        <div class="req-actions">
          ${draft ? btn("Edit", "camp-edit") : ""}${btn("Preview", "camp-preview")}
          ${draft ? btn("Send a test to me", "camp-test") + btn(`Queue to ${esc(c.eligible)} contact${c.eligible === 1 ? "" : "s"}`, "camp-queue", "btn btn-primary btn-sm") + btn("Delete", "camp-remove", "link-btn danger") : ""}
        </div></article>`;
    }).join("") : `<div class="empty-box">No campaigns yet. Choose "New campaign" to draft your first invitation.</div>`;

    $("#contactBody").innerHTML = O.contacts.length ? O.contacts.map(k => {
      const [kind, label] = CONTACT_PILL[k.status] || ["neutral", k.status];
      return `<tr><td><strong>${esc(k.full_name || k.email)}</strong>${k.full_name ? "<br>" + esc(k.email) : ""}${k.organization ? `<br><span class="hint">${esc(k.organization)}</span>` : ""}${k.city_state ? `<br><span class="hint">${esc(k.city_state)}</span>` : ""}</td>
        <td>${esc(AUDIENCE_LABEL[k.audience])}</td><td>${esc(k.source)}</td><td>${esc(fmtDate(k.created_at))}</td>
        <td><span class="pill ${kind}">${esc(label)}</span></td>
        <td><button type="button" class="link-btn danger" data-act="contact-remove" data-id="${esc(k.id)}" data-name="${esc(k.email)}">Remove</button></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="admin-empty">No contacts yet. Paste a list above to get started.</td></tr>`;
  }

  const campaignFromForm = () => ({ id: val("campId") || undefined, name: val("campName"), audience: val("campAudience"), subject: val("campSubject"),
    heading: val("campHeading"), body: $("#campBody").value.trim(), button_label: val("campButtonLabel") || "Learn more", button_path: val("campButtonPath") });
  function openCampaignForm(c) {
    c = c || { audience: "professional", button_path: "#presenters" };
    $("#campId").value = c.id || ""; $("#campName").value = c.name || ""; $("#campAudience").value = c.audience; $("#campSubject").value = c.subject || "";
    $("#campHeading").value = c.heading || ""; $("#campBody").value = c.body || ""; $("#campButtonLabel").value = c.button_label || ""; $("#campButtonPath").value = c.button_path;
    showError("campError", ""); $("#campaignForm").hidden = false; $("#campaignForm").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  // Shows exactly what recipients will get, using the same template the mail sender uses.
  let emailTemplates = null;
  async function previewCampaign(c) {
    emailTemplates = emailTemplates || await import("../supabase/functions/_shared/emails.js");
    const { html } = emailTemplates.renderEmail("outreach_campaign", {
      subject: c.subject, heading: c.heading, body: c.body, button_label: c.button_label, button_path: c.button_path,
      contact_name: "Dana Cole, LMFT", source: "(where this contact came from)",
      mailing_address: (S.outreach.settings.mailing_address || "").trim() || "(add the C4C mailing address above)",
      unsubscribe_token: "0".repeat(32)
    }, { siteUrl: location.origin + location.pathname, contactEmail: CFG.contactEmail });
    $("#campaignPreviewTitle").textContent = `Preview: ${c.subject || "(no subject yet)"}`;
    $("#campaignPreviewFrame").srcdoc = html;
    $("#campaignPreview").hidden = false; $("#campaignPreview").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  $("#newCampaignBtn").addEventListener("click", () => openCampaignForm());
  $("#campCancelBtn").addEventListener("click", () => { $("#campaignForm").hidden = true; });
  $("#campaignPreviewClose").addEventListener("click", () => { $("#campaignPreview").hidden = true; });
  $("#campStarterBtn").addEventListener("click", () => {
    if ($("#campBody").value.trim() && !confirm("Replace what you've written with the starter text?")) return;
    openCampaignForm(Object.assign({}, window.C4C_OUTREACH_STARTER, { id: val("campId") || undefined }));
  });
  $("#campPreviewBtn").addEventListener("click", e => run(e.target, () => previewCampaign(campaignFromForm())));
  $("#campaignForm").addEventListener("submit", async e => {
    e.preventDefault();
    const c = campaignFromForm(), missing = [];
    if (!c.name) missing.push("a campaign name");
    if (c.subject.length < 5) missing.push("an email subject");
    if (!c.heading) missing.push("a heading");
    if (!c.body) missing.push("a message");
    if (missing.length) return showError("campError", "Please add: " + missing.join(", ") + ".");
    showError("campError", "");
    await run(e.target.querySelector("[type=submit]"), async () => {
      await B.admin.outreach.saveCampaign(c);
      $("#campaignForm").hidden = true; await refresh(); toast("Draft saved. Send yourself a test before queueing it.");
    });
  });
  $("#outreachSettingsForm").addEventListener("submit", async e => {
    e.preventDefault();
    await run(e.target.querySelector("[type=submit]"), async () => {
      await B.admin.outreach.saveSetting("mailing_address", val("outMailingAddress")); await refresh(); toast("Mailing address saved.");
    });
  });
  $("#importForm").addEventListener("submit", async e => {
    e.preventDefault();
    const source = val("impSource");
    const rows = $("#impRows").value.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^e-?mail\b/i.test(l)).map(line => {
      const parts = line.split(/[,;\t]/).map(p => p.trim()).filter(Boolean);
      const at = parts.findIndex(p => p.includes("@"));
      const email = at >= 0 ? parts.splice(at, 1)[0].replace(/^.*<|>.*$/g, "") : parts.shift() || "";
      return { email, full_name: parts[0] || "", organization: parts[1] || "", city_state: parts.slice(2).join(", ") };
    });
    if (!source) return showError("impError", "Say where these contacts came from, so C4C has a record.");
    if (!rows.length) return showError("impError", "Paste at least one contact.");
    showError("impError", "");
    await run(e.target.querySelector("[type=submit]"), async () => {
      const r = await B.admin.outreach.importContacts(rows, val("impAudience"), source);
      const bits = [`${r.added} added`];
      if (r.already_members) bits.push(`${r.already_members} already have an account`);
      if (r.already_listed) bits.push(`${r.already_listed} already on the list`);
      if (r.invalid) bits.push(`${r.invalid} skipped (not a valid email)`);
      $("#impRows").value = ""; await refresh();
      const out = $("#impResult"); out.hidden = false; out.textContent = bits.join(" · ") + ".";
    });
  });
  $("#exportContactsBtn").addEventListener("click", () => download(toCSV(S.outreach.contacts, [
    ["Email", k => k.email], ["Name", k => k.full_name], ["Organization", k => k.organization], ["City/State", k => k.city_state],
    ["Type", k => AUDIENCE_LABEL[k.audience]], ["Where From", k => k.source], ["Status", k => k.status], ["Added", k => k.created_at], ["Unsubscribed", k => k.unsubscribed_at]
  ]), "c4c-outreach-contacts.csv", "text/csv"));

  /* ---- unsubscribe page (reached from the link in an outreach email) ---- */
  function renderUnsubscribe() {
    const token = (/^#unsubscribe=([0-9a-f]{32})$/i.exec(location.hash) || [])[1];
    $("#unsubscribeBox").innerHTML = token
      ? `<h3>Stop these emails?</h3><p>Counselors for Change will no longer send invitation emails to your address.</p>
         <div class="btn-row"><button type="button" class="btn btn-primary" data-act="unsubscribe" data-token="${esc(token)}">Yes, unsubscribe me</button></div>`
      : `<h3>This link isn't complete</h3><p>Please use the unsubscribe link from the email again, or write to ${mailto(CFG.contactEmail)} and we'll take you off the list.</p>`;
  }

  /* ---- CSV exports ---- */
  function toCSV(rows, cols) {
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    return [cols.map(c => q(c[0])).join(","), ...rows.map(r => cols.map(c => q(c[1](r))).join(","))].join("\r\n");
  }
  const j = a => (a || []).join("; ");
  $("#exportProsBtn").addEventListener("click", () => download(toCSV(S.admin.professionals, [
    ["Name", p => p.display_name], ["Email", p => p.email], ["Phone", p => (p.private || {}).phone], ["City/State", p => p.city_state],
    ["License Type", p => p.license_type], ["License State", p => p.license_state], ["License Number", p => (p.private || {}).license_number],
    ["Years Practicing", p => (p.private || {}).years_practicing], ["Expertise", p => j(p.expertise)], ["Audiences", p => j(p.audiences)],
    ["Session Types", p => j(p.event_types)], ["Delivery", p => j(p.delivery)], ["Availability", p => j(p.availability)],
    ["Min Notice (days)", p => (p.private || {}).min_notice_days], ["Website", p => p.website], ["Bio", p => p.bio],
    ["Insurance Carrier", p => (p.private || {}).ins_carrier], ["Insurance Policy", p => (p.private || {}).ins_policy_number],
    ["Insurance Limits", p => (p.private || {}).ins_limits], ["Insurance Expires", p => (p.private || {}).ins_expires],
    ["Insurance Verified", p => (p.private || {}).ins_verified_at ? "Yes" : "No"], ["Will Present Yearly", p => (p.private || {}).commit_annual ? "Yes" : "No"],
    ["Status", p => p.status], ["Joined", p => p.created_at], ["Approved", p => p.approved_at]
  ]), "c4c-presenters.csv", "text/csv"));
  $("#exportReqsBtn").addEventListener("click", () => download(toCSV(S.admin.requests, [
    ["Tracking ID", r => r.tracking_id], ["Status", r => (OPT.STATUS[r.status] || {}).label], ["Organization", r => (r.organization || {}).name],
    ["Org Type", r => (r.organization || {}).org_type], ["Lead", r => (r.organization || {}).lead_name], ["Lead Email", r => (r.organization || {}).lead_email],
    ["Session Type", r => r.event_type], ["Window", r => fmtWindow(r)], ["Audiences", r => j(r.audiences)], ["Ages", r => r.age_range],
    ["Expected Attendance", r => r.attendees_expected], ["Delivery", r => r.delivery], ["Length (min)", r => r.duration_min], ["Location", r => r.location],
    ["Topics", r => j(r.topics)], ["Description", r => r.description], ["Support Level", r => r.support_level],
    ["Requested Presenter", r => (r.requested || {}).display_name], ["Matched Presenter", r => (r.matched || {}).display_name],
    ["Session Date", r => r.event ? fmtInstant(r.event.starts_at, r.timezone) : ""], ["Attendance", r => r.event ? r.event.attendance_actual : ""],
    ["Presenter Hours", r => r.event ? r.event.presenter_hours : ""], ["Submitted", r => r.created_at]
  ]), "c4c-requests.csv", "text/csv"));
  $("#exportOrgsBtn").addEventListener("click", () => download(toCSV(S.admin.organizations, [
    ["Organization", o => o.name], ["Type", o => o.org_type], ["Lead", o => o.lead_name], ["Lead Email", o => o.lead_email], ["CC", o => j(o.cc_emails)],
    ["New to C4C", o => o.prior_contact === false ? "Yes" : o.prior_contact === true ? "No" : ""], ["Intro Call Offered", o => o.intro_call_offered_at], ["Joined", o => o.created_at]
  ]), "c4c-organizations.csv", "text/csv"));
  $("#exportJsonBtn").addEventListener("click", () => download(JSON.stringify(Object.assign({ exported_at: new Date().toISOString() }, S.admin), null, 2), "c4c-portal-backup.json", "application/json"));
  async function seed() { await B.demo.seed(); await refresh(); toast("Sample data loaded. Open \"Find a Presenter\", or sign in as a sample account."); }
  $("#adminSeedBtn").addEventListener("click", e => run(e.target, seed));
  $("#seedBtn").addEventListener("click", e => run(e.target, seed));
  $("#resetBtn").addEventListener("click", e => run(e.target, async () => {
    if (!confirm("Delete ALL demo accounts, presenters and requests stored in this browser? This can't be undone.")) return;
    await B.demo.reset(); S.suggestions = {}; await refresh(); toast("Demo data cleared."); go("home");
  }));

  /* ================= delegated actions ================= */
  const findRequest = id => (S.admin ? S.admin.requests : []).concat(S.requests).find(r => r.id === id);
  const ACTIONS = {
    "request-presenter": async d => { S.target = d.id; go("request"); },
    "view-presenter": async d => { $("#dirSearch").value = d.name; },
    "seed": async () => seed(),
    "demo-signin": async d => { await B.signIn({ email: d.email }); await refresh(); },
    "respond": async d => {
      const accept = d.accept === "1";
      if (!accept && !confirm("Pass on this request? C4C will be told so another presenter can be found.")) return;
      const status = await B.respond(d.id, accept);
      await refresh();
      toast(!accept ? "Thanks for letting us know." : status === "connected" ? "You're connected. Reach out to settle the date." : "Thanks! The organization will see that you're interested.");
    },
    "choose": async d => { await B.choosePresenter(d.id, d.pro); await refresh(); toast("You're connected. Reach out to your presenter to settle the date."); },
    "cancel": async d => { if (!confirm("Cancel this request? Your presenter and C4C will be notified.")) return; await B.cancelRequest(d.id); await refresh(); toast("Request cancelled."); },
    "ics": async d => downloadIcs(findRequest(d.id)),
    "admin-suggest": async d => { S.suggestions[d.id] = await B.admin.suggest(d.id); renderAdmin(); },
    "admin-invite": async d => {
      const ids = $$(`input[data-suggest="${d.id}"]:checked:not(:disabled)`).map(i => i.value);
      if (!ids.length) return toast("Tick at least one presenter to invite.", "error");
      const n = await B.admin.invite(d.id, ids); delete S.suggestions[d.id]; await refresh();
      toast(n ? `Invited ${n} presenter${n === 1 ? "" : "s"}.` : "Those presenters were already invited.");
    },
    "admin-assign": async d => {
      if (!confirm(`Connect ${d.name} with this organization right away? Both sides will be introduced by email.`)) return;
      await B.admin.assign(d.id, d.pro); delete S.suggestions[d.id]; await refresh(); toast("Assigned and connected.");
    },
    "admin-remove-request": async d => { if (!confirm("Permanently remove this request and its history? This can't be undone.")) return; await B.admin.removeRequest(d.id); await refresh(); toast("Request removed."); },
    "pro-approve": async d => { await B.admin.setProfessionalStatus(d.id, "approved"); await refresh(); toast(`${d.name} is now live in the directory.`); },
    "pro-reject": async d => { if (!confirm(`Mark ${d.name} as not approved? They stay out of the directory.`)) return; await B.admin.setProfessionalStatus(d.id, "rejected"); await refresh(); },
    "pro-suspend": async d => { if (!confirm(`Pause ${d.name}? Their profile is hidden from the directory until you approve it again.`)) return; await B.admin.setProfessionalStatus(d.id, "suspended"); await refresh(); },
    "ins-verify": async d => { await B.admin.setInsuranceVerified(d.id, true); await refresh(); },
    "ins-unverify": async d => { await B.admin.setInsuranceVerified(d.id, false); await refresh(); },
    "pro-remove": async d => { if (!confirm(`Permanently remove ${d.name}'s presenter profile? This can't be undone. Their sign-in stays.`)) return; await B.admin.removeProfessional(d.id); await refresh(); toast("Profile removed."); },
    "camp-edit": async d => openCampaignForm(S.outreach.campaigns.find(c => c.id === d.id)),
    "camp-preview": async d => previewCampaign(S.outreach.campaigns.find(c => c.id === d.id)),
    "camp-test": async d => { await B.admin.outreach.queue(d.id, true); await refresh(); toast(`A test of "${d.name}" was queued to ${S.me.email}. It appears in the Emails tab.`); },
    "camp-queue": async d => {
      if (d.n === "0") return toast("There are no eligible contacts for this campaign yet. Add contacts below first.", "error");
      if (!confirm(`Queue "${d.name}" to ${d.n} contact${d.n === "1" ? "" : "s"}?\n\nEach one gets this email once. After this the wording is locked and it can't be recalled.`)) return;
      const n = await B.admin.outreach.queue(d.id, false); await refresh(); toast(`Queued to ${n} contact${n === 1 ? "" : "s"}.`);
    },
    "camp-remove": async d => { if (!confirm(`Delete the draft "${d.name}"?`)) return; await B.admin.outreach.removeCampaign(d.id); await refresh(); },
    "contact-remove": async d => { if (!confirm(`Remove ${d.name} from the contact list?`)) return; await B.admin.outreach.removeContact(d.id); await refresh(); },
    "unsubscribe": async d => {
      const ok = await B.unsubscribe(d.token);
      $("#unsubscribeBox").innerHTML = ok
        ? `<h3>You're unsubscribed</h3><p>You won't get any more invitation emails from Counselors for Change. If you ever want to join, you're always welcome.</p>`
        : `<h3>We couldn't find that link</h3><p>It may have been mistyped. Write to ${mailto(CFG.contactEmail)} and we'll take you off the list.</p>`;
    }
  };
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el || !ACTIONS[el.dataset.act]) return;
    run(el.tagName === "BUTTON" ? el : null, () => ACTIONS[el.dataset.act](el.dataset));
  });
  document.addEventListener("change", e => {
    const el = e.target.closest('[data-change="admin-status"]');
    if (el) run(el, async () => { await B.admin.setRequestStatus(el.dataset.id, el.value); await refresh(); });
  });
  document.addEventListener("submit", e => {
    const f = e.target.closest("[data-form]");
    if (f) {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f)), btn = f.querySelector("[type=submit]");
      if (f.dataset.form === "schedule") run(btn, async () => {
        const starts = zonedToUtc(d.date, d.time, d.tz);
        if (!(starts > new Date())) throw new Error("Choose a date and time in the future.");
        await B.scheduleEvent(f.dataset.id, starts.toISOString(), parseInt(d.duration, 10) || 60, d.location || "");
        await refresh(); toast("Date saved. Calendar links are ready on the request.");
      });
      if (f.dataset.form === "outcome") run(btn, async () => {
        await B.recordOutcome(f.dataset.id, Math.max(0, parseInt(d.attendance, 10) || 0), Math.max(0, parseFloat(d.hours) || 0));
        await refresh(); toast("Thank you! The session is marked complete.");
      });
      return;
    }
    if (e.target.id === "demoAdminForm") {
      e.preventDefault();
      const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
      B.demo.unlockAdmin($("#demoPasscode").value).then(refresh)
        .catch(err => { btn.disabled = false; showError("demoAdminError", err.message); });
    }
  });

  /* ================= boot ================= */
  B.onAuth(async event => {
    if (event === "PASSWORD_RECOVERY") S.recovery = true;
    await refresh();
    if (event === "PASSWORD_RECOVERY") return go("account");
    if (event === "SIGNED_IN") await submitDraftIfAny();
  });

  (async function boot() {
    initUI();
    // Links from confirmation and reset emails come back with details in the address; surface any error.
    const hashErr = /error_description=([^&]+)/.exec(location.hash);
    try { await B.init(); }
    catch (e) { console.error(e); toast(e.message || "Could not start the sign-in service.", "error"); }
    await refresh();
    if (hashErr) {
      toast(decodeURIComponent(hashErr[1].replace(/\+/g, " ")) + ". Please request a new link.", "error");
      history.replaceState(null, "", location.pathname + "#account");
    }
    route();
    booted = true;
    await submitDraftIfAny();
  })();
})();
