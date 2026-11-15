/* Counselors for Change — Connecting Portal (draft)
   Vanilla JS, no build step. Data access goes through window.C4CStore (js/storage.js). */
(function(){
  "use strict";
  const CFG = window.C4C_CONFIG, OPT = window.C4C_OPTIONS, Store = window.C4CStore;
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const genId = (n=12) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(36).padStart(2,"0")).join("").slice(0, n*2); };
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  const AVATAR_COLORS = ["#2C6489","#3E9A9D","#0E7BAE","#4E6E8A","#23838B","#5E7EA3"];

  let counselors = [], requests = [];
  const sel = {};               // chipset id -> Set of selected values
  let selectedDonation = null, targetedId = null, adminUnlocked = false;

  /* ---------------- Email (optional, EmailJS) ---------------- */
  let emailReady = null;
  function loadEmail(){
    const e = CFG.emailjs;
    if(!e.enabled || !e.publicKey || !e.serviceId) return Promise.resolve(false);
    if(emailReady) return emailReady;
    emailReady = new Promise(res => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js";
      s.onload = () => { try{ emailjs.init({ publicKey: e.publicKey }); res(true); }catch(err){ res(false); } };
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return emailReady;
  }
  async function notify(templateId, params){
    if(!templateId || !(await loadEmail())) return;
    try{ await emailjs.send(CFG.emailjs.serviceId, templateId, params); }catch(e){ console.warn("Email failed", e); }
  }

  /* ---------------- Time zone helpers ---------------- */
  // Offset (ms) of tz from UTC at a given instant.
  function tzOffset(ms, tz){
    const p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit" })
      .formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
    return Date.UTC(+p.year, +p.month-1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
  }
  // Wall-clock date+time in tz -> UTC Date.
  function zonedToUtc(date, time, tz){
    const [y,m,d] = date.split("-").map(Number), [h,mi] = time.split(":").map(Number);
    const guess = Date.UTC(y, m-1, d, h, mi);
    let t = guess - tzOffset(guess, tz);
    t = guess - tzOffset(t, tz);
    return new Date(t);
  }
  const tzLabel = tz => (OPT.TIMEZONES.find(t => t[0] === tz) || [tz, tz])[1];
  function formatSlot(slot, tz){
    if(!slot?.date || !slot?.time) return "";
    const [y,m,d] = slot.date.split("-").map(Number), [h,mi] = slot.time.split(":").map(Number);
    const wall = new Date(Date.UTC(y, m-1, d, h, mi));
    const s = wall.toLocaleString("en-US", { timeZone:"UTC", weekday:"short", month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" });
    return `${s} ${tzLabel(tz).replace(/^.*\((.*)\)$/, "$1")}`;
  }
  const utcStamp = dt => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  /* ---------------- Calendar ---------------- */
  function eventInfo(req){
    const c = counselors.find(x => x.id === req.counselorId);
    const slot = req.proposedSlots[req.confirmedSlotIndex];
    const start = zonedToUtc(slot.date, slot.time, req.timezone);
    const end = new Date(start.getTime() + (+req.duration || 60) * 60000);
    const title = `${req.eventType}: ${req.orgName} × ${c ? c.name : "Counselors for Change"}`;
    const location = req.location || (req.format === "Virtual" ? "Virtual (link to follow)" : "");
    const details = [`Event: ${req.eventType}`, `Organization: ${req.orgName}`, `Contact: ${req.contact} (${req.email})`,
      `Audience: ${(req.audiences||[]).join(", ")}`, `Format: ${req.format}`, "", req.description, "", "Booked through Counselors for Change"].join("\n");
    return { c, start, end, title, location, details };
  }
  function googleCalUrl(req){
    const e = eventInfo(req);
    return "https://calendar.google.com/calendar/render?" + new URLSearchParams({ action:"TEMPLATE", text:e.title, dates:`${utcStamp(e.start)}/${utcStamp(e.end)}`, details:e.details, location:e.location });
  }
  const icsEsc = s => String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  function downloadIcs(req){
    const e = eventInfo(req);
    const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Counselors for Change//Connecting Portal//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
      `UID:${req.id}@counselorsforchange.org`, `DTSTAMP:${utcStamp(new Date())}`, `DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${icsEsc(e.title)}`, `DESCRIPTION:${icsEsc(e.details)}`, `LOCATION:${icsEsc(e.location)}`, "END:VEVENT","END:VCALENDAR"].join("\r\n");
    download(ics, `c4c-session-${req.id}.ics`, "text/calendar");
  }
  function download(content, filename, type){
    const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href:url, download:filename });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /* ---------------- UI setup ---------------- */
  function fillSelect(el, items, placeholder){
    el.innerHTML = (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") +
      items.map(it => Array.isArray(it) ? `<option value="${esc(it[0])}">${esc(it[1])}</option>` : `<option>${esc(it)}</option>`).join("");
  }
  function buildChipset(el){
    const values = OPT[el.dataset.options];
    const set = sel[el.id] = new Set();
    el.innerHTML = "";
    values.forEach(v => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip-btn"; b.textContent = v; b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        set.has(v) ? set.delete(v) : set.add(v);
        b.setAttribute("aria-pressed", String(set.has(v)));
        if(el.id.startsWith("filter")) renderDirectory();
      });
      el.appendChild(b);
    });
  }
  function clearChips(id){ sel[id].clear(); $$(`#${id} .chip-btn`).forEach(b => b.setAttribute("aria-pressed","false")); }

  function initUI(){
    fillSelect($("#volLicenseType"), OPT.LICENSE_TYPES, "Select one");
    fillSelect($("#reqOrgType"), OPT.ORG_TYPES);
    fillSelect($("#reqEventType"), OPT.EVENT_TYPES, "Select one");
    $$(".tz-select").forEach(s => fillSelect(s, OPT.TIMEZONES));
    $$(".chipset[data-options]").forEach(buildChipset);
    const dc = $("#donationCards");
    dc.innerHTML = OPT.DONATION_TIERS.map(t => `<button type="button" class="radio-card" aria-pressed="false" data-amount="${t[0]}"><div class="amt">${esc(t[1])}</div><div class="lbl">${esc(t[2])}</div></button>`).join("");
    $$(".radio-card", dc).forEach(card => card.addEventListener("click", () => {
      $$(".radio-card", dc).forEach(c => c.setAttribute("aria-pressed","false"));
      card.setAttribute("aria-pressed","true"); selectedDonation = card.dataset.amount; $("#reqCustomAmount").value = "";
    }));
    $("#reqCustomAmount").addEventListener("input", e => { if(e.target.value){ $$(".radio-card", dc).forEach(c => c.setAttribute("aria-pressed","false")); selectedDonation = null; } });
    const today = new Date().toISOString().slice(0,10);
    $$("[data-slot-date]").forEach(i => i.min = today);

    document.addEventListener("click", e => {
      const t = e.target.closest("[data-tab]");
      if(t){ e.preventDefault(); go(t.dataset.tab); }
    });
    window.addEventListener("hashchange", route);

    $("#dirSearch").addEventListener("input", renderDirectory);
    $("#dirFormat").addEventListener("change", renderDirectory);
    $("#dirClear").addEventListener("click", () => { $("#dirSearch").value = ""; $("#dirFormat").value = ""; clearChips("filterExpertise"); clearChips("filterAudience"); renderDirectory(); });
    $("#targetedClear").addEventListener("click", () => setTarget(null));

    if(CFG.draftMode){ $("#demoBanner").hidden = false; $("#seedBtn").addEventListener("click", seed); }
    $("#storageMode").textContent = Store.mode;
  }

  /* ---------------- Routing ---------------- */
  const VIEWS = ["home","join","directory","request","privacy","admin","confirm"];
  function go(tab){ if(location.hash === "#" + tab) route(); else location.hash = tab; }
  function route(){
    const h = location.hash.slice(1);
    const m = h.match(/^confirm=([a-z0-9]+)$/i);
    let view = VIEWS.includes(h) ? h : "home";
    if(m){ view = "confirm"; renderConfirm(m[1]); }
    $$("section.view").forEach(s => s.classList.toggle("active", s.id === view));
    $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === view));
    if(view === "admin") showAdmin();
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Data ---------------- */
  async function load(){
    counselors = await Store.list("counselors");
    requests = await Store.list("requests");
  }
  const isPublic = c => !CFG.requireApproval || c.status === "approved";
  function updateStats(){
    const pub = counselors.filter(isPublic);
    $("#statCounselors").textContent = pub.length;
    $("#statRequests").textContent = requests.length;
    $("#statExpertise").textContent = new Set(pub.flatMap(c => c.expertise || [])).size;
  }
  function refreshAll(){ updateStats(); renderDirectory(); refreshBadge(); if(adminUnlocked) renderAdmin(); }

  /* ---------------- Join form ---------------- */
  function showError(el, msg){ el.textContent = msg; el.classList.toggle("show", !!msg); }
  $("#volForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value.trim();
    const err = $("#volError");
    const missing = [];
    if(!v("volName")) missing.push("name");
    if(!isEmail(v("volEmail"))) missing.push("a valid email");
    if(!v("volLicenseType")) missing.push("license type");
    if(!/^[A-Za-z]{2}$/.test(v("volLicenseState"))) missing.push("2-letter license state");
    if(!v("volLicenseNum")) missing.push("license number");
    if(!sel.volExpertise.size) missing.push("at least one area of expertise");
    if(!sel.volAudience.size) missing.push("at least one audience");
    if(!v("volBio")) missing.push("a short bio");
    if(!v("volInsCarrier")) missing.push("insurance carrier");
    if(!v("volInsPolicy")) missing.push("insurance policy number");
    if(!v("volInsLimits")) missing.push("insurance limits");
    if(!v("volInsExpires")) missing.push("insurance expiration date");
    if(missing.length) return showError(err, "Please add: " + missing.join(", ") + ".");
    if(v("volInsExpires") < new Date().toISOString().slice(0,10)) return showError(err, "Your liability insurance appears to be expired. Please enter a current policy.");
    if(!$("#volConsentAge").checked || !$("#volConsentInsurance").checked || !$("#volConsentPrivacy").checked) return showError(err, "Please confirm the age, insurance and privacy checkboxes before submitting.");
    if(counselors.some(c => c.email.toLowerCase() === v("volEmail").toLowerCase())) return showError(err, "A profile with this email already exists. Contact " + CFG.contactEmail + " to update it.");
    showError(err, "");

    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const entry = {
      id: genId(), name: v("volName"), email: v("volEmail"), phone: v("volPhone"), location: v("volLocation"),
      licenseType: v("volLicenseType"), licenseState: v("volLicenseState").toUpperCase(), licenseNum: v("volLicenseNum"),
      years: v("volYears"), expertise: [...sel.volExpertise], audiences: [...sel.volAudience], eventTypes: [...sel.volEventTypes],
      formats: [...sel.volFormat], availability: [...sel.volAvailability], timezone: v("volTimezone"), leadTime: v("volLeadTime"),
      bio: v("volBio"), website: v("volWebsite"),
      insurance: { carrier: v("volInsCarrier"), policy: v("volInsPolicy"), limits: v("volInsLimits"), expires: v("volInsExpires") },
      commitAnnual: $("#volCommit").checked,
      status: CFG.requireApproval ? "pending" : "approved", dateAdded: new Date().toISOString()
    };
    try{
      counselors = await Store.upsert("counselors", entry);
      notify(CFG.emailjs.templateNewSignup, { to_email: CFG.emailjs.adminEmail, counselor_name: entry.name, counselor_email: entry.email,
        license_type: entry.licenseType, expertise: entry.expertise.join(", "), audiences: entry.audiences.join(", ") });
      const n = $("#volNotice"); n.classList.add("show");
      n.textContent = CFG.requireApproval
        ? "Thanks! Your profile was submitted. C4C will verify your license and insurance, then email you when it's live in the directory. (In the live version you'll also get a link to set up your login.)"
        : "You're in the directory! Organizations can now find and request you.";
      e.target.reset(); ["volExpertise","volAudience","volEventTypes","volFormat","volAvailability"].forEach(clearChips);
      refreshAll(); n.scrollIntoView({ behavior:"smooth", block:"center" });
    }catch(x){ showError(err, "Something went wrong saving your profile. Please try again."); }
    btn.disabled = false;
  });

  /* ---------------- Directory ---------------- */
  function renderDirectory(){
    const grid = $("#directoryGrid");
    const q = $("#dirSearch").value.trim().toLowerCase();
    const fmt = $("#dirFormat").value;
    const fx = sel.filterExpertise, fa = sel.filterAudience;
    const pub = counselors.filter(isPublic);
    const list = pub.slice().reverse().filter(c =>
      (!fx.size || (c.expertise||[]).some(x => fx.has(x))) &&
      (!fa.size || (c.audiences||[]).some(x => fa.has(x))) &&
      (!fmt || !(c.formats||[]).length || c.formats.includes(fmt)) &&
      (!q || [c.name, c.bio, c.location, c.licenseType, ...(c.expertise||[]), ...(c.audiences||[])].join(" ").toLowerCase().includes(q)));
    $("#resultCount").textContent = pub.length ? `Showing ${list.length} of ${pub.length} counselor${pub.length === 1 ? "" : "s"}` : "";
    if(!list.length){
      grid.innerHTML = `<div class="empty-state"><svg aria-hidden="true"><use href="#four-mark"/></svg><h3>No matches yet</h3><p>${pub.length ? "Try clearing a filter to see more listings." : "No counselors are listed yet. Be the first to join!"}</p></div>`;
      return;
    }
    grid.innerHTML = list.map((c, i) => {
      const initials = c.name.split(/\s+/).map(p => p[0]).slice(0,2).join("").toUpperCase();
      const fmts = (c.formats||[]).length ? `<div class="meta-line"><strong>Delivery:</strong> ${c.formats.map(esc).join(" · ")}</div>` : "";
      const avail = (c.availability||[]).length ? `<div class="meta-line"><strong>Available:</strong> ${c.availability.map(esc).join(" · ")}</div>` : "";
      const more = (c.expertise||[]).length > 4 ? `<span class="tag">+${c.expertise.length - 4} more</span>` : "";
      return `<article class="profile-card">
        <div class="avatar" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}" aria-hidden="true">${esc(initials)}</div>
        <h3>${esc(c.name)}</h3>
        <div class="cred">${esc((c.licenseType||"").split(" — ")[0])} · ${esc(c.licenseState||"")}${c.location ? " · " + esc(c.location) : ""}${c.status === "approved" ? '<span class="verified">✓ Verified</span>' : ""}</div>
        <div class="bio">${esc(c.bio)}</div>
        <div class="tag-row">${(c.expertise||[]).slice(0,4).map(t => `<span class="tag">${esc(t)}</span>`).join("")}${more}</div>
        ${fmts}${avail}
        <button type="button" class="btn btn-outline btn-block" data-request-id="${esc(c.id)}">Request this speaker</button>
      </article>`;
    }).join("");
    $$("[data-request-id]", grid).forEach(b => b.addEventListener("click", () => { setTarget(b.dataset.requestId); go("request"); }));
  }
  function setTarget(id){
    targetedId = id;
    const c = counselors.find(x => x.id === id), box = $("#targeted");
    box.classList.toggle("show", !!c);
    if(!c) return;
    $("#targetedName").textContent = `${c.name} (${c.licenseType.split(" — ")[0]})`;
    $("#targetedAvail").textContent = (c.availability||[]).length ? `Their availability: ${c.availability.join(" · ")}. Please propose times inside these windows.` : "";
  }

  /* ---------------- Request form ---------------- */
  $("#reqForm").addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value.trim();
    const err = $("#reqError");
    const missing = [];
    if(!v("reqOrgName")) missing.push("organization name");
    if(!v("reqContact")) missing.push("contact name");
    if(!isEmail(v("reqEmail"))) missing.push("a valid email");
    if(!v("reqEventType")) missing.push("event type");
    if(!sel.reqAudience.size) missing.push("audience");
    if(!v("reqDesc")) missing.push("a session description");
    const ws = v("reqWindowStart"), we = v("reqWindowEnd"), todayStr = new Date().toISOString().slice(0,10);
    if(!ws || !we) missing.push("a preferred date window");
    if(missing.length) return showError(err, "Please add: " + missing.join(", ") + ".");
    if(ws < todayStr || we < ws) return showError(err, "The preferred window must start today or later, and end on or after its start date.");
    const rawSlots = [1,2,3].map(i => ({ date: $(`[data-slot-date="${i}"]`).value, time: $(`[data-slot-time="${i}"]`).value }));
    if(rawSlots.some(s => !!s.date !== !!s.time)) return showError(err, "Each specific time needs both a date and a time.");
    const slots = rawSlots.filter(s => s.date && s.time);
    const tz = v("reqTimezone");
    if(slots.some(s => zonedToUtc(s.date, s.time, tz) < new Date())) return showError(err, "Specific times must be in the future.");
    const cc = v("reqCc").split(/[,;\s]+/).filter(Boolean);
    if(cc.some(x => !isEmail(x))) return showError(err, "One of the CC emails doesn't look right. Separate addresses with commas.");
    if(!$("#reqConsentAge").checked || !$("#reqConsentPrivacy").checked) return showError(err, "Please confirm both checkboxes before submitting.");
    showError(err, "");

    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const custom = v("reqCustomAmount");
    const c = counselors.find(x => x.id === targetedId);
    const entry = {
      id: genId(), confirmToken: genId(16), trackingId: newTrackingId(),
      orgName: v("reqOrgName"), orgType: v("reqOrgType"), contact: v("reqContact"), email: v("reqEmail"),
      cc, priorContact: v("reqPrior"), ages: v("reqAges"), windowStart: ws, windowEnd: we,
      eventType: v("reqEventType"), duration: v("reqDuration"), format: v("reqFormat"), timezone: tz, attendees: v("reqAttendees"),
      location: v("reqLocation"), proposedSlots: slots, confirmedSlotIndex: null, audiences: [...sel.reqAudience], topics: [...sel.reqTopics],
      description: v("reqDesc"), donation: custom ? `$${custom} (custom)` : (selectedDonation ? "$" + selectedDonation.replace("-", "–$") : "Not specified"),
      counselorId: c ? c.id : null, counselorName: c ? c.name : null,
      status: c ? "Awaiting counselor" : "New", history: [{ at: new Date().toISOString(), what: "Submitted" }], dateAdded: new Date().toISOString()
    };
    try{
      requests = await Store.upsert("requests", entry);
      const params = { org_name: entry.orgName, contact_name: entry.contact, contact_email: entry.email, event_type: entry.eventType,
        audiences: entry.audiences.join(", "), tracking_id: entry.trackingId, window: fmtWindow(entry),
        proposed_slots: slots.map((s,i) => `Option ${i+1}: ${formatSlot(s, tz)}`).join(" | "), cc: cc.join(", "),
        first_time: entry.priorContact === "no" ? "Yes, offer an intro call" : "No",
        donation: entry.donation, counselor_name: entry.counselorName || "Needs matching", confirm_url: confirmUrl(entry.confirmToken) };
      notify(CFG.emailjs.templateNewRequest, { ...params, to_email: CFG.emailjs.adminEmail });
      if(c) notify(CFG.emailjs.templateNewRequest, { ...params, to_email: c.email });
      const n = $("#reqNotice"); n.classList.add("show");
      n.textContent = `Request received. Your tracking number is ${entry.trackingId}. ` +
        (c ? `${c.name} will be invited to accept, and we'll email ${entry.email} when they reply.`
           : `C4C will suggest best-fit presenters and follow up at ${entry.email}.`) +
        (entry.priorContact === "no" ? " Since this is your first time with C4C, we'll also reach out to offer a 30-minute intro call." : "");
      e.target.reset(); clearChips("reqAudience"); clearChips("reqTopics");
      $$("#donationCards .radio-card").forEach(x => x.setAttribute("aria-pressed","false")); selectedDonation = null; setTarget(null);
      refreshAll(); n.scrollIntoView({ behavior:"smooth", block:"center" });
    }catch(x){ showError(err, "Something went wrong submitting your request. Please try again."); }
    btn.disabled = false;
  });

  /* ---------------- Tracking ---------------- */
  function newTrackingId(){
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", a = new Uint8Array(6); crypto.getRandomValues(a);
    return "C4C-" + Array.from(a, b => abc[b % abc.length]).join("");
  }
  const fmtDay = d => { if(!d) return ""; const [y,m,dd] = d.split("-").map(Number); return new Date(Date.UTC(y, m-1, dd)).toLocaleDateString("en-US", { timeZone:"UTC", month:"short", day:"numeric", year:"numeric" }); };
  const fmtWindow = r => r.windowStart ? `${fmtDay(r.windowStart)} to ${fmtDay(r.windowEnd)}` : "";
  $("#trackForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = $("#trackId").value.trim().toUpperCase(), em = $("#trackEmail").value.trim().toLowerCase(), out = $("#trackResult");
    const r = requests.find(x => x.trackingId === id && x.email.toLowerCase() === em);
    if(!r){ out.textContent = "We couldn't find a request with that tracking number and email."; return; }
    const when = r.confirmedSlotIndex != null ? formatSlot(r.proposedSlots[r.confirmedSlotIndex], r.timezone) : fmtWindow(r);
    out.innerHTML = `<div><strong>${esc(r.eventType)}</strong> for ${esc(r.orgName)}</div>
      <div style="margin:6px 0"><span class="tr-status">${esc(r.status)}</span></div>
      <div>${esc(OPT.STATUS_HELP[r.status] || "")}</div>
      <div class="hint">${r.counselorName && !["New","Matching"].includes(r.status) ? "Presenter: " + esc(r.counselorName) + " · " : ""}${esc(when)}</div>
      <ol>${(r.history||[]).map(h => `<li>${esc(fmtDate(h.at))}: ${esc(h.what)}</li>`).join("")}</ol>`;
  });

  /* ---------------- Matching suggestions ---------------- */
  // Rank approved presenters for a request: topic fit counts most, then audience, session type, delivery and notice.
  function scoreCounselor(c, r){
    const hit = (a, b) => (a||[]).filter(x => (b||[]).includes(x)).length;
    let s = hit(r.topics, c.expertise) * 3 + hit(r.audiences, c.audiences) * 2;
    if((c.eventTypes||[]).includes(r.eventType)) s += 1;
    if(!(c.formats||[]).length || c.formats.includes(r.format)) s += 1;
    if(r.windowEnd){
      const days = (new Date(r.windowEnd) - new Date()) / 86400000;
      if(days < (+c.leadTime || 30)) s -= 2;
    }
    return s;
  }
  function rankedCandidates(r){
    return counselors.filter(c => c.status === "approved").map(c => ({ c, score: scoreCounselor(c, r) })).sort((a, b) => b.score - a.score);
  }

  /* ---------------- Confirmation flow ---------------- */
  const confirmUrl = token => location.origin + location.pathname + "#confirm=" + token;
  function detailBlock(r){
    const row = (k, val) => val ? `<div class="detail-row"><span>${k}</span><span>${val}</span></div>` : "";
    return `<div class="card">${row("Organization", esc(r.orgName))}${row("Contact", esc(r.contact) + " · " + esc(r.email))}${row("Event type", esc(r.eventType))}
      ${row("Length", esc(r.duration) + " minutes")}${row("Delivery", esc(r.format))}${row("Attendees", esc(r.attendees))}
      ${row("Preferred window", esc(fmtWindow(r)))}${row("Audience", (r.audiences||[]).map(esc).join(", "))}${row("Ages / grades", esc(r.ages))}
      ${row("Topics", (r.topics||[]).map(esc).join(", "))}${row("Location", esc(r.location))}
      <div class="detail-row"><span>About</span><span style="font-weight:400;max-width:70%">${esc(r.description)}</span></div></div>`;
  }
  async function saveRequest(r, what){ (r.history = r.history || []).push({ at: new Date().toISOString(), what }); requests = await Store.upsert("requests", r); refreshAll(); }

  function renderConfirm(token){
    const box = $("#confirmContent");
    const r = requests.find(x => x.confirmToken === token);
    if(!r){
      box.innerHTML = `<div class="confirm-head"><div class="eyebrow">Confirmation link</div><h2>We couldn't find that request</h2>
        <p>The link may be mistyped or the request was removed. Questions? Email ${esc(CFG.contactEmail)}.</p></div>
        <button type="button" class="btn btn-outline" data-tab="home">Back to home</button>`;
      return;
    }
    const c = counselors.find(x => x.id === r.counselorId);
    if(r.status === "Confirmed" || r.status === "Completed"){
      box.innerHTML = `<div class="confirm-head"><div class="eyebrow">Booking confirmed</div><h2>You're all set</h2>
        <p>This session is confirmed for <strong>${esc(formatSlot(r.proposedSlots[r.confirmedSlotIndex], r.timezone))}</strong>.</p></div>
        ${detailBlock(r)}<h3>Add to your calendar</h3>
        <div class="btn-row"><a class="btn btn-primary" target="_blank" rel="noopener" href="${esc(googleCalUrl(r))}">Google Calendar</a>
        <button type="button" class="btn btn-outline" id="icsBtn">Download .ics (Apple / Outlook)</button></div>`;
      $("#icsBtn").addEventListener("click", () => downloadIcs(r));
      return;
    }
    if(["Declined","Cancelled"].includes(r.status)){
      box.innerHTML = `<div class="confirm-head"><div class="eyebrow">Request closed</div><h2>This request was ${esc(r.status.toLowerCase())}</h2><p>No further action is needed.</p></div>`;
      return;
    }
    if(r.status === "Connected"){
      box.innerHTML = `<div class="confirm-head"><div class="eyebrow">You're connected</div><h2>Thanks for saying yes</h2>
        <p>Reach out to <strong>${esc(r.contact)}</strong> at <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> to settle the exact date inside their window (${esc(fmtWindow(r))}). C4C has been notified and is here if you need anything.</p></div>${detailBlock(r)}`;
      return;
    }
    const first = (c ? c.name : "there").split(" ")[0];
    if(!(r.proposedSlots||[]).length){
      box.innerHTML = `<div class="confirm-head"><div class="eyebrow">Speaker request</div><h2>${esc(r.orgName)} would like you to present</h2>
        <p>Hi ${esc(first)}, they're hoping for a date between <strong>${esc(fmtWindow(r))}</strong>. If you accept, you'll settle the exact date with them directly.</p></div>
        ${detailBlock(r)}
        <div class="btn-row"><button type="button" class="btn btn-primary" id="acceptBtn">I'm interested, connect us</button>
        <button type="button" class="btn btn-outline" id="declineBtn">I can't take this one</button></div>`;
      $("#acceptBtn").addEventListener("click", async () => { r.status = "Connected"; await saveRequest(r, "Presenter accepted; connected with organization"); renderConfirm(token); });
      $("#declineBtn").addEventListener("click", async () => {
        if(!confirm("Decline this request? C4C will follow up with the organization.")) return;
        r.status = "Declined"; await saveRequest(r, "Declined by presenter"); renderConfirm(token);
      });
      return;
    }
    let chosen = null;
    box.innerHTML = `<div class="confirm-head"><div class="eyebrow">Speaker request</div><h2>${esc(r.orgName)} would like to book you</h2>
      <p>Hi ${esc(first)}, pick the time that works best, or decline if none do.</p></div>
      ${detailBlock(r)}<h3>Pick a time</h3>
      <div id="slotChoices">${r.proposedSlots.map((s,i) => `<button type="button" class="slot-choice" aria-pressed="false" data-i="${i}"><div class="slot-when">${esc(formatSlot(s, r.timezone))}</div><div class="slot-tz">${esc(tzLabel(r.timezone))}</div></button>`).join("")}</div>
      <div class="btn-row"><button type="button" class="btn btn-primary" id="confirmBtn" disabled>Confirm this time</button>
      <button type="button" class="btn btn-outline" id="declineBtn">None of these work</button></div>`;
    $$(".slot-choice", box).forEach(b => b.addEventListener("click", () => {
      chosen = +b.dataset.i; $$(".slot-choice", box).forEach(x => x.setAttribute("aria-pressed", String(x === b))); $("#confirmBtn").disabled = false;
    }));
    $("#confirmBtn").addEventListener("click", async () => {
      if(chosen === null) return;
      r.confirmedSlotIndex = chosen; r.status = "Confirmed";
      await saveRequest(r, "Confirmed by counselor");
      const when = formatSlot(r.proposedSlots[chosen], r.timezone), cal = googleCalUrl(r);
      const params = { org_name: r.orgName, contact_name: r.contact, event_type: r.eventType, when, counselor_name: c ? c.name : "", calendar_url: cal };
      notify(CFG.emailjs.templateConfirmed, { ...params, to_email: r.email });
      if(c) notify(CFG.emailjs.templateConfirmed, { ...params, to_email: c.email });
      notify(CFG.emailjs.templateConfirmed, { ...params, to_email: CFG.emailjs.adminEmail });
      renderConfirm(token);
    });
    $("#declineBtn").addEventListener("click", async () => {
      if(!confirm("Decline all proposed times? C4C will follow up with the organization.")) return;
      r.status = "Declined"; await saveRequest(r, "Declined by counselor"); renderConfirm(token);
    });
  }

  /* ---------------- Admin ---------------- */
  async function sha256(s){ const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2,"0")).join(""); }
  $("#adminGateForm").addEventListener("submit", async e => {
    e.preventDefault();
    const ok = (await sha256($("#adminPasscode").value)) === CFG.adminPasscodeHash;
    $("#adminGateError").classList.toggle("show", !ok);
    if(ok){ adminUnlocked = true; $("#adminPasscode").value = ""; showAdmin(); }
  });
  $("#lockBtn").addEventListener("click", () => { adminUnlocked = false; showAdmin(); });
  $$("[data-admin-tab]").forEach(b => b.addEventListener("click", () => {
    $$("[data-admin-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    $$("[data-admin-panel]").forEach(p => p.hidden = p.dataset.adminPanel !== b.dataset.adminTab);
  }));
  function showAdmin(){
    $("#adminGate").hidden = adminUnlocked; $("#adminPanel").hidden = !adminUnlocked;
    if(adminUnlocked){ renderAdmin(); Store.setMeta("adminLastViewed", Date.now()).then(refreshBadge); }
  }
  async function refreshBadge(){
    const last = (await Store.getMeta("adminLastViewed")) || 0;
    const n = [...counselors, ...requests].filter(x => new Date(x.dateAdded).getTime() > last).length;
    const b = $("#adminBadge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n;
  }
  const fmtDate = iso => { try{ return new Date(iso).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }); }catch(e){ return iso || ""; } };
  const STATUS_LABEL = { pending: "Pending review", approved: "Approved", rejected: "Not approved" };

  function renderAdmin(){
    const pending = counselors.filter(c => c.status === "pending").length;
    const open = requests.filter(r => ["New","Matching","Awaiting counselor"].includes(r.status)).length;
    const confirmed = requests.filter(r => ["Connected","Confirmed","Completed"].includes(r.status)).length;
    const todayStr = new Date().toISOString().slice(0,10);
    $("#kpis").innerHTML = [[counselors.filter(c => c.status === "approved").length, "Approved counselors"], [pending, "Pending review"], [open, "Open requests"], [confirmed, "Connections made"]]
      .map(k => `<div class="kpi"><b>${k[0]}</b><span>${k[1]}</span></div>`).join("");

    const f = $("#adminCounselorFilter").value;
    const cl = counselors.filter(c => !f || c.status === f).slice().reverse();
    $("#adminCounselorCount").textContent = counselors.length;
    $("#adminCounselorBody").innerHTML = cl.length ? cl.map(c => `<tr>
      <td><strong>${esc(c.name)}</strong><br><span class="hint">${esc(c.location)}</span></td>
      <td>${esc(c.email)}${c.phone ? "<br>" + esc(c.phone) : ""}</td>
      <td>${esc((c.licenseType||"").split(" — ")[0])}<br><span class="hint">${esc(c.licenseState)} · #${esc(c.licenseNum)}${c.years ? " · " + esc(c.years) + " yrs" : ""}</span>
        <br><span class="hint">${c.insurance ? `Ins: ${esc(c.insurance.carrier)} · ${esc(c.insurance.limits)} · exp ${esc(fmtDay(c.insurance.expires))}${c.insurance.expires < todayStr ? ' <span class="flag-bad">EXPIRED</span>' : ""}` : '<span class="flag-bad">No insurance on file</span>'}</span>
        ${c.commitAnnual ? '<br><span class="tagmini">1 talk / year</span>' : ""}</td>
      <td>${(c.expertise||[]).map(x => `<span class="tagmini">${esc(x)}</span>`).join("")}</td>
      <td>${fmtDate(c.dateAdded)}</td>
      <td><span class="status-pill ${esc(c.status)}">${STATUS_LABEL[c.status] || esc(c.status)}</span></td>
      <td>${c.status !== "approved" ? `<button class="link-btn" data-c-approve="${esc(c.id)}">Approve</button>` : ""}${c.status !== "rejected" ? `<button class="link-btn" data-c-reject="${esc(c.id)}">${c.status === "approved" ? "Unlist" : "Reject"}</button>` : ""}<button class="link-btn danger" data-c-remove="${esc(c.id)}">Remove</button></td>
    </tr>`).join("") : `<tr><td colspan="7" class="admin-empty">No counselors${f ? " with this status" : " yet"}.</td></tr>`;

    $("#adminRequestCount").textContent = requests.length;
    $("#adminRequestBody").innerHTML = requests.length ? requests.slice().reverse().map(r => { const ranked = rankedCandidates(r); return `<tr>
      <td><strong>${esc(r.orgName)}</strong><br><span class="hint">${esc(r.trackingId || "")}<br>${esc(r.orgType)}<br>${esc(r.contact)} · ${esc(r.email)}${(r.cc||[]).length ? "<br>CC: " + r.cc.map(esc).join(", ") : ""}</span>${r.priorContact === "no" ? '<br><span class="tagmini">New to C4C: offer intro call</span>' : ""}</td>
      <td>${esc(r.eventType)}<br><span class="hint">${esc(r.duration)} min · ${esc(r.format)}${r.attendees ? " · " + esc(r.attendees) + " people" : ""}${r.ages ? " · " + esc(r.ages) : ""}</span><br>${(r.audiences||[]).map(x => `<span class="tagmini">${esc(x)}</span>`).join("")}</td>
      <td>${r.windowStart ? `<div class="hint">Window: ${esc(fmtWindow(r))}</div>` : ""}${(r.proposedSlots||[]).map((s,i) => `<div style="${r.confirmedSlotIndex === i ? "font-weight:700;color:var(--deep-teal)" : ""}">${r.confirmedSlotIndex === i ? "✓ " : ""}${esc(formatSlot(s, r.timezone))}</div>`).join("")}</td>
      <td>${esc(r.donation)}</td>
      <td><select class="status-select" data-r-assign="${esc(r.id)}" aria-label="Assign presenter"><option value="">Needs matching</option>${ranked.map((x, i) => `<option value="${esc(x.c.id)}" ${x.c.id === r.counselorId ? "selected" : ""}>${i < 5 && x.score > 0 ? "★ " : ""}${esc(x.c.name)} (fit ${x.score})</option>`).join("")}</select>
        <div class="hint">★ = top 5 suggested</div></td>
      <td><select class="status-select" data-r-status="${esc(r.id)}" aria-label="Request status">${OPT.REQUEST_STATUSES.map(s => `<option ${r.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td>${r.counselorId ? `<button class="link-btn" data-r-copy="${esc(r.confirmToken)}">Copy invite link</button><br>` : ""}<button class="link-btn danger" data-r-remove="${esc(r.id)}">Remove</button></td>
    </tr>`; }).join("") : `<tr><td colspan="7" class="admin-empty">No speaker requests yet.</td></tr>`;
  }

  async function setCounselorStatus(id, status){
    const c = counselors.find(x => x.id === id); if(!c) return;
    c.status = status; c.reviewedAt = new Date().toISOString();
    counselors = await Store.upsert("counselors", c); refreshAll();
  }
  $("#adminCounselorFilter").addEventListener("change", renderAdmin);
  $("#adminPanel").addEventListener("click", async e => {
    const d = e.target.dataset;
    if(d.cApprove) setCounselorStatus(d.cApprove, "approved");
    else if(d.cReject) setCounselorStatus(d.cReject, "rejected");
    else if(d.cRemove){ if(confirm("Permanently remove this counselor? This can't be undone.")){ counselors = await Store.remove("counselors", d.cRemove); refreshAll(); } }
    else if(d.rRemove){ if(confirm("Permanently remove this request? This can't be undone.")){ requests = await Store.remove("requests", d.rRemove); refreshAll(); } }
    else if(d.rCopy){
      const url = confirmUrl(d.rCopy);
      try{ await navigator.clipboard.writeText(url); e.target.textContent = "✓ Copied"; setTimeout(() => e.target.textContent = "Copy invite link", 1500); }
      catch(x){ prompt("Copy this link and send it to the counselor:", url); }
    }
  });
  $("#adminPanel").addEventListener("change", async e => {
    const d = e.target.dataset;
    const r = requests.find(x => x.id === (d.rStatus || d.rAssign)); if(!r) return;
    if(d.rStatus){ r.status = e.target.value; await saveRequest(r, "Status → " + r.status); }
    if(d.rAssign !== undefined){
      const c = counselors.find(x => x.id === e.target.value);
      r.counselorId = c ? c.id : null; r.counselorName = c ? c.name : null;
      if(c && ["New","Matching"].includes(r.status)) r.status = "Awaiting counselor";
      await saveRequest(r, c ? "Assigned to " + c.name : "Unassigned");
    }
  });

  function toCSV(rows, cols){
    const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    return [cols.map(c => q(c[0])).join(","), ...rows.map(r => cols.map(c => q(c[1](r))).join(","))].join("\r\n");
  }
  const j = a => (a||[]).join("; ");
  $("#exportCounselorsBtn").addEventListener("click", () => download(toCSV(counselors, [
    ["Name",c=>c.name],["Email",c=>c.email],["Phone",c=>c.phone],["Location",c=>c.location],["License Type",c=>c.licenseType],
    ["License State",c=>c.licenseState],["License Number",c=>c.licenseNum],["Years",c=>c.years],["Expertise",c=>j(c.expertise)],
    ["Audiences",c=>j(c.audiences)],["Session Formats",c=>j(c.eventTypes)],["Delivery",c=>j(c.formats)],["Availability",c=>j(c.availability)],
    ["Timezone",c=>c.timezone],["Min Notice (days)",c=>c.leadTime],["Bio",c=>c.bio],["Website",c=>c.website],["Insurance Carrier",c=>c.insurance?.carrier],["Insurance Policy",c=>c.insurance?.policy],["Insurance Limits",c=>c.insurance?.limits],["Insurance Expires",c=>c.insurance?.expires],["Annual Commitment",c=>c.commitAnnual?"Yes":"No"],["Status",c=>c.status],["Date Added",c=>c.dateAdded]
  ]), "c4c-counselors.csv", "text/csv"));
  $("#exportRequestsBtn").addEventListener("click", () => download(toCSV(requests, [
    ["Tracking ID",r=>r.trackingId],["Organization",r=>r.orgName],["Org Type",r=>r.orgType],["Contact",r=>r.contact],["Email",r=>r.email],["CC",r=>j(r.cc)],["New to C4C",r=>r.priorContact==="no"?"Yes":""],["Window",r=>fmtWindow(r)],["Ages",r=>r.ages],["Event Type",r=>r.eventType],
    ["Duration (min)",r=>r.duration],["Delivery",r=>r.format],["Attendees",r=>r.attendees],["Timezone",r=>r.timezone],["Location",r=>r.location],
    ["Proposed Times",r=>(r.proposedSlots||[]).map(s=>formatSlot(s,r.timezone)).join(" | ")],
    ["Confirmed Time",r=>r.confirmedSlotIndex != null ? formatSlot(r.proposedSlots[r.confirmedSlotIndex], r.timezone) : ""],
    ["Audiences",r=>j(r.audiences)],["Topics",r=>j(r.topics)],["Description",r=>r.description],["Support Level",r=>r.donation],
    ["Counselor",r=>r.counselorName],["Status",r=>r.status],["Date Added",r=>r.dateAdded]
  ]), "c4c-requests.csv", "text/csv"));
  $("#exportJsonBtn").addEventListener("click", () => download(JSON.stringify({ exportedAt: new Date().toISOString(), counselors, requests }, null, 2), "c4c-portal-backup.json", "application/json"));
  $("#resetBtn").addEventListener("click", async () => {
    if(!confirm("Delete ALL draft counselors and requests stored in this browser? This can't be undone.")) return;
    await Store.clear(); await load(); refreshAll();
  });
  $("#adminSeedBtn").addEventListener("click", seed);

  /* ---------------- Sample data (draft only, clearly fictional) ---------------- */
  async function seed(){
    if(counselors.some(c => c.sample)) return alert("Sample counselors are already loaded.");
    const base = { phone:"", years:"", timezone:"America/New_York", leadTime:"30", status:"approved", sample:true, licenseNum:"SAMPLE", insurance:{ carrier:"Sample Carrier", policy:"SAMPLE", limits:"$1M / $3M", expires:"2027-12-31" } };
    const now = Date.now();
    const samples = [
      { name:"Sample Counselor A", location:"Melbourne, FL", licenseType:OPT.LICENSE_TYPES[2], licenseState:"FL", expertise:["Relationships & Family","Parenting Support","Youth & Adolescent Mental Health"], audiences:["Parents & Caregivers","Educators & School Staff"], eventTypes:["Workshop","Panel Discussion"], formats:["Virtual","In-person"], availability:["Weekday evenings","Saturday mornings"], bio:"Example profile for demo purposes. Family therapist who leads parent workshops on supporting teens through stress and big transitions." },
      { name:"Sample Counselor B", location:"Orlando, FL", licenseType:OPT.LICENSE_TYPES[3], licenseState:"FL", expertise:["Anxiety & Stress","Suicide Prevention","Bullying & Social Media"], audiences:["K-12 Students","Educators & School Staff"], eventTypes:["Assembly / Keynote","Psychoeducation Session"], formats:["In-person"], availability:["Weekday mornings","Weekday afternoons"], bio:"Example profile for demo purposes. School-focused counselor offering age-appropriate assemblies on anxiety, coping skills and asking for help." },
      { name:"Sample Counselor C", location:"Tampa, FL", licenseType:OPT.LICENSE_TYPES[4], licenseState:"FL", expertise:["Trauma & PTSD","Burnout & Workplace Stress","Crisis Response"], audiences:["First Responders","Healthcare Workers","Corporate / Workplace Groups"], eventTypes:["Staff Training","Workshop"], formats:["Virtual"], availability:["Weekday afternoons","Weekday evenings"], bio:"Example profile for demo purposes. Psychologist who trains first responders and clinical teams on trauma-informed care and burnout prevention." }
    ].map((s, i) => ({ ...base, ...s, id: genId(), email: `sample${i+1}@example.org`, dateAdded: new Date(now - (3-i) * 86400000).toISOString() }));
    counselors = counselors.concat(samples);
    await Store.saveAll("counselors", counselors); refreshAll();
  }

  /* ---------------- Boot ---------------- */
  initUI();
  load().then(() => { refreshAll(); route(); });
})();
