"use strict";

const state = {
  user: null,
  loginRole: "worker",
  activeView: "overview",
  incidents: [],
  analytics: null,
  team: [],
  filters: { q: "", status: "", type: "", severity: "", section: "" },
  modal: null
};

const $ = id => document.getElementById(id);
const STATUS = ["Reported", "Under Investigation", "Resolved"];
const TYPE_LABEL = { "accident": "Accident", "near-miss": "Near-miss", "unsafe condition": "Unsafe condition" };
const TYPE_COLORS = { "accident": "#ff6a67", "near-miss": "#ffd12f", "unsafe condition": "#ffbd59" };
const SEVERITY_COLORS = { low: "#6ce0ad", medium: "#ffbd59", high: "#ff6a67" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}
function initials(name) {
  return String(name || "MG").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function prettyType(type) { return TYPE_LABEL[type] || type; }
function typeClass(type) { return String(type || "").replace(/\s+/g, "-"); }
function statusClass(status) { return String(status || "").toLowerCase().replace(/\s+/g, "-"); }
function formatDate(date, withTime = true) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }).format(d);
}
function localDateTimeValue(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3300);
}
async function api(url, options = {}) {
  const config = { credentials: "same-origin", ...options };
  if (config.body && !(config.body instanceof FormData) && typeof config.body !== "string") {
    config.headers = { "Content-Type": "application/json", ...(config.headers || {}) };
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(url, config);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && !url.includes("/api/login")) showLogin();
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}
function showLogin() {
  state.user = null;
  $("app-shell").hidden = true;
  $("login-screen").hidden = false;
  $("login-password").value = "";
}
function showApp(user) {
  state.user = user;
  state.activeView = "overview";
  $("login-screen").hidden = true;
  $("app-shell").hidden = false;
  $("sidebar").classList.remove("open");
  $("sidebar-profile").innerHTML = `
    <div class="profile-icon">${esc(initials(user.name))}</div>
    <div><b>${esc(user.name)}</b><small>${esc(user.role === "supervisor" ? "Safety supervisor" : "Mine worker")}</small></div>`;
  $("topbar-avatar").textContent = initials(user.name);
  $("topbar-name").textContent = user.name;
  $("topbar-role").textContent = user.role;
  renderNav();
  navigate("overview");
}
function renderNav() {
  const items = state.user.role === "supervisor"
    ? [
        ["overview", "▦", "Safety overview"],
        ["incidents", "▤", "All incidents"],
        ["team", "♙", "Worker accounts"]
      ]
    : [
        ["overview", "⌂", "My workspace"],
        ["report", "＋", "Report an incident"],
        ["my-reports", "▤", "My reports"]
      ];
  $("primary-nav").innerHTML = items.map(([key, icon, label]) => `
    <button class="nav-item ${state.activeView === key ? "active" : ""}" data-nav="${key}">
      <span class="nav-icon">${icon}</span><span>${label}</span>
      ${key === "incidents" && state.analytics ? `<span class="nav-count">${state.analytics.open}</span>` : ""}
    </button>`).join("");
}
function setPageHeader(title, eyebrow = state.user.role === "supervisor" ? "SAFETY OPERATIONS" : "WORKER PORTAL") {
  $("page-title").textContent = title;
  $("topbar-eyebrow").textContent = eyebrow;
}
async function navigate(view) {
  state.activeView = view;
  renderNav();
  $("sidebar").classList.remove("open");
  const content = $("page-content");
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div><span>Loading safety workspace…</span></div>`;
  try {
    if (view === "overview" && state.user.role === "supervisor") {
      const [analytics, incidentData] = await Promise.all([api("/api/analytics"), api("/api/incidents")]);
      state.analytics = analytics; state.incidents = incidentData.incidents;
      renderSupervisorOverview();
    } else if (view === "overview" && state.user.role === "worker") {
      const data = await api("/api/incidents");
      state.incidents = data.incidents;
      renderWorkerOverview();
    } else if (view === "report") {
      renderReportForm();
    } else if (view === "my-reports" || view === "incidents") {
      const data = await api("/api/incidents");
      state.incidents = data.incidents;
      renderIncidentList(view === "incidents");
    } else if (view === "team") {
      const data = await api("/api/team");
      state.team = data.users;
      renderTeam();
    } else {
      navigate("overview");
    }
  } catch (error) {
    content.innerHTML = `<div class="card empty-state"><strong>Could not load this page</strong>${esc(error.message)}<br><br><button class="btn btn-secondary" data-retry>Retry</button></div>`;
  }
}
function pageIntro(title, subtitle, button = "") {
  return `<div class="page-intro"><div><h3>${title}</h3><p>${subtitle}</p></div>${button ? `<div class="action-row">${button}</div>` : ""}</div>`;
}
function statCard(title, value, hint, icon, colour = "") {
  return `<article class="stat-card ${colour}"><div class="stat-top"><span>${title}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-hint">${hint}</div></article>`;
}
function statusPill(status) {
  return `<span class="status-pill ${statusClass(status)}">${esc(status)}</span>`;
}
function typePill(type) {
  return `<span class="type-pill ${typeClass(type)}">${esc(prettyType(type))}</span>`;
}
function severityPill(severity) {
  return `<span class="severity-pill ${esc(severity)}">${esc(severity[0].toUpperCase() + severity.slice(1))}</span>`;
}
function renderSupervisorOverview() {
  const a = state.analytics;
  setPageHeader("Safety overview");
  const recentReports = state.incidents.slice(0, 5);
  $("page-content").innerHTML = `
    ${pageIntro(`Good ${greeting()}, ${esc(state.user.name.split(" ")[0])}.`, "Here's the current picture across reported mine hazards.", `<button class="btn btn-secondary" data-nav="incidents">View all incidents ↗</button><a class="btn btn-primary" href="/api/incidents/export.csv" id="export-csv">Export CSV ↓</a>`)}
    <section class="stats-grid">
      ${statCard("Total incident reports", a.total, "All recorded reports", "▤", "blue")}
      ${statCard("Open investigations", a.open, "Not yet marked resolved", "◷", "amber")}
      ${statCard("High-severity open", a.highSeverity, "Needs careful review", "!", "red")}
      ${statCard("Resolved reports", a.resolved, "Marked as resolved", "✓", "green")}
    </section>
    <section class="dashboard-grid">
      <article class="card"><div class="card-header"><div><h3>Reports by mine section</h3><p>Where incident records are concentrated</p></div><span class="card-kicker">SECTION COUNT</span></div>${renderBarChart(a.sections)}</article>
      <article class="card"><div class="card-header"><div><h3>7-day incident trend</h3><p>Reports by event date</p></div><span class="card-kicker">LAST 7 DAYS</span></div>${renderLineChart(a.trend)}</article>
      <article class="card"><div class="card-header"><div><h3>Incident type split</h3><p>Distribution of all recorded reports</p></div><span class="card-kicker">BY TYPE</span></div>${renderDonut(a.types, a.total)}</article>
      <article class="card"><div class="card-header"><div><h3>Section hazard heatmap</h3><p>A report-concentration signal, not a formal risk assessment</p></div><span class="card-kicker">OVERVIEW</span></div>${renderHeatmap(a.heatmap)}</article>
    </section>
    <section class="card" style="margin-bottom:16px"><div class="card-header"><div><h3>Smart warnings</h3><p>Transparent rules flag clusters for human review</p></div><span class="card-kicker">${a.alerts.length} FLAGGED</span></div>${renderAlerts(a.alerts)}</section>
    <section class="card table-card">
      <div class="table-toolbar"><h3>Latest incident reports</h3><button class="table-action" data-nav="incidents">Open incident tracker →</button></div>
      ${renderTable(recentReports, true)}
    </section>`;
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
function renderBarChart(sections) {
  if (!sections.length) return `<div class="empty-state">Reports will appear here when workers submit incidents.</div>`;
  const top = sections.slice(0, 5);
  const max = Math.max(1, ...top.map(s => s.total));
  const width = 520, height = Math.max(145, top.length * 36 + 20);
  const rows = top.map((s, i) => {
    const y = 18 + i * 36;
    const barWidth = Math.max(2, (s.total / max) * 270);
    const color = s.high > 0 || s.nearMiss >= 3 ? "#ff6a67" : s.total >= 2 ? "#ffbd59" : "#6ce0ad";
    return `<text x="0" y="${y + 12}" fill="#b8b2a2" font-size="11">${esc(s.section.length > 17 ? s.section.slice(0, 16) + "…" : s.section)}</text>
    <rect x="140" y="${y}" width="278" height="16" rx="5" fill="#3a3426"/>
    <rect x="140" y="${y}" width="${barWidth}" height="16" rx="5" fill="${color}"/>
    <text x="${Math.min(455, 150 + barWidth)}" y="${y + 12}" fill="#fff7df" font-size="11" font-weight="700">${s.total}</text>`;
  }).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart of reports by mine section">${rows}</svg><div class="chart-legend"><span class="legend-item"><i class="legend-dot" style="background:#78d6a6"></i>Lower count</span><span class="legend-item"><i class="legend-dot" style="background:#ffbd59"></i>Repeated reports</span><span class="legend-item"><i class="legend-dot" style="background:#ff6a67"></i>High-risk signal</span></div>`;
}
function renderLineChart(points) {
  if (!points.length || points.every(p => p.count === 0)) {
    return `<div class="empty-state">No reports in the last 7 days yet.<br>New event dates will appear here.</div>`;
  }
  const width = 520, height = 190, left = 32, right = 20, top = 18, bottom = 35;
  const max = Math.max(1, ...points.map(p => p.count));
  const chartH = height - top - bottom, chartW = width - left - right;
  const coords = points.map((p, i) => ({
    x: left + i * chartW / Math.max(1, points.length - 1),
    y: top + chartH - (p.count / max) * chartH,
    ...p
  }));
  const poly = coords.map(p => `${p.x},${p.y}`).join(" ");
  const guides = [0, .5, 1].map(f => {
    const y = top + f * chartH;
    return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#393225" stroke-dasharray="3 5"/><text x="4" y="${y+4}" fill="#968f7e" font-size="10">${Math.round(max*(1-f))}</text>`;
  }).join("");
  const dots = coords.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#ffd12f" stroke="#1a1914" stroke-width="2"><title>${esc(p.label)}: ${p.count} reports</title></circle><text x="${p.x}" y="${height-11}" fill="#a6a08f" font-size="9" text-anchor="middle">${esc(p.label)}</text>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Line chart of incident reports over the last 7 days">${guides}<polyline points="${poly}" fill="none" stroke="#ffd12f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}
function renderDonut(types, total) {
  const entries = [
    ["near-miss", "Near-miss", types["near-miss"] || 0, "#ffd12f"],
    ["unsafe condition", "Unsafe condition", types["unsafe condition"] || 0, "#ffbd59"],
    ["accident", "Accident", types.accident || 0, "#ff6a67"]
  ];
  let acc = 0;
  const gradient = entries.map(e => {
    const start = total ? acc / total * 100 : 0;
    acc += e[2];
    const end = total ? acc / total * 100 : 100;
    return `${e[3]} ${start}% ${end}%`;
  }).join(", ");
  return `<div class="donut-layout"><div class="donut" style="background:conic-gradient(${gradient})"><div class="donut-center"><b>${total}</b><small>REPORTS</small></div></div><div class="donut-legend">${entries.map(e => `<div class="legend-row"><span class="legend-dot" style="background:${e[3]}"></span><span>${e[1]}</span><b>${e[2]}</b></div>`).join("")}</div></div>`;
}
function renderHeatmap(cells) {
  if (!cells.length) return `<div class="empty-state">No section data available.</div>`;
  return `<div class="heatmap-grid">${cells.slice(0, 9).map(cell => `
    <div class="heat-cell ${esc(cell.risk)}"><b>${esc(cell.section)}</b><strong>${cell.count}</strong><small>${cell.risk === "high" ? "Review recommended" : cell.risk === "medium" ? "Monitor pattern" : "Lower report count"}</small></div>`).join("")}</div>
    <p class="heatmap-note">Color is calculated from reported counts and rule triggers. It is not proof that a location is safe or unsafe; inspection findings and site procedures take priority.</p>`;
}
function renderAlerts(alerts) {
  if (!alerts.length) return `<div class="alert-empty"><strong>No rule-based warnings at this time</strong>As new reports arrive, MineGuard checks near-miss clusters and repeated incident types. Keep regular inspections in place.</div>`;
  return `<div class="alert-list">${alerts.map(a => `<div class="alert-card ${esc(a.level)}"><div class="alert-symbol">${a.level === "high" ? "!" : "↻"}</div><div><b>${esc(a.title)} · ${esc(a.section)}</b><p>${esc(a.message)}</p></div></div>`).join("")}</div>`;
}
function renderWorkerOverview() {
  setPageHeader("My workspace");
  const own = state.incidents;
  const open = own.filter(i => i.status !== "Resolved").length;
  const resolved = own.length - open;
  const latest = own.slice(0, 4);
  $("page-content").innerHTML = `
    ${pageIntro(`Welcome, ${esc(state.user.name.split(" ")[0])}.`, "If you spot an accident, near-miss or unsafe condition, report it promptly so the team can review it.", `<button class="btn btn-primary" data-nav="report">＋ Report a hazard</button>`)}
    <section class="stats-grid">
      ${statCard("Reports submitted", own.length, "Your incident records", "▤", "blue")}
      ${statCard("Awaiting follow-up", open, "Not yet marked resolved", "◷", "amber")}
      ${statCard("Resolved reports", resolved, "Closure recorded", "✓", "green")}
      ${statCard("Quick action", "＋", "Submit a new safety report", "!", "red")}
    </section>
    <section class="card table-card">
      <div class="table-toolbar"><h3>My latest reports</h3><button class="table-action" data-nav="my-reports">View all →</button></div>
      ${renderTable(latest, false)}
    </section>`;
}
function renderIncidentList(isSupervisor) {
  setPageHeader(isSupervisor ? "All incidents" : "My reports");
  const list = state.incidents;
  $("page-content").innerHTML = `
    ${pageIntro(isSupervisor ? "Incident tracker" : "Your incident history", isSupervisor ? "Search reports, review supporting details and keep status updates traceable." : "Follow the status of incidents you have submitted.", isSupervisor ? `<a class="btn btn-secondary" href="/api/incidents/export.csv">Export CSV ↓</a>` : `<button class="btn btn-primary" data-nav="report">＋ New report</button>`)}
    <section class="card table-card">
      <div class="table-toolbar">
        <h3>${isSupervisor ? "All submitted reports" : "Submitted by you"} <span class="nav-count">${list.length}</span></h3>
        <div class="filters">
          <input class="search-input" id="filter-search" placeholder="Search section or description…" value="${esc(state.filters.q)}" aria-label="Search reports">
          <select id="filter-status" aria-label="Filter by status"><option value="">All statuses</option>${STATUS.map(x => `<option ${state.filters.status===x?"selected":""}>${x}</option>`).join("")}</select>
          <select id="filter-type" aria-label="Filter by type"><option value="">All types</option><option value="accident" ${state.filters.type==="accident"?"selected":""}>Accident</option><option value="near-miss" ${state.filters.type==="near-miss"?"selected":""}>Near-miss</option><option value="unsafe condition" ${state.filters.type==="unsafe condition"?"selected":""}>Unsafe condition</option></select>
          <select id="filter-severity" aria-label="Filter by severity"><option value="">All severity</option><option value="low" ${state.filters.severity==="low"?"selected":""}>Low</option><option value="medium" ${state.filters.severity==="medium"?"selected":""}>Medium</option><option value="high" ${state.filters.severity==="high"?"selected":""}>High</option></select>
        </div>
      </div>
      ${renderTable(list, isSupervisor, true)}
    </section>
    <p class="field-hint" style="margin-top:10px">Photos and incident details are access-controlled. Status changes are recorded in the history of each report.</p>`;
  bindFilters();
}
function renderTable(list, isSupervisor, showFilters = false) {
  if (!list.length) return `<div class="empty-state"><strong>No reports found</strong>${state.user.role === "worker" ? "Use “Report a hazard” to create your first incident record." : "Try clearing one or more filters."}</div>`;
  const rows = list.map(i => `<tr>
    <td><span class="incident-main"><b>${esc(i.id.slice(0,8).toUpperCase())}</b><small>${esc(formatDate(i.reportedAt))}</small></span></td>
    <td>${typePill(i.type)}</td><td>${severityPill(i.severity)}</td>
    <td><span class="incident-main"><b>${esc(i.section)}</b><small>${esc(formatDate(i.eventAt))}</small></span></td>
    ${isSupervisor ? `<td>${esc(i.reporterName || "Worker")}</td>` : ""}
    <td>${statusPill(i.status)}</td><td><button class="table-action" data-open-incident="${esc(i.id)}">Review ↗</button></td>
  </tr>`).join("");
  const mobileCards = list.map(i => `<article class="mobile-incident-card">
    <div class="mobile-incident-top"><span class="incident-main"><b>${esc(i.id.slice(0,8).toUpperCase())}</b><small>${esc(formatDate(i.reportedAt))}</small></span>${severityPill(i.severity)}</div>
    <h4>${esc(i.section)} · ${esc(prettyType(i.type))}</h4><p>${esc(i.description.slice(0,150))}${i.description.length>150?"…":""}</p>
    <div class="mobile-incident-foot">${statusPill(i.status)}<button class="table-action" data-open-incident="${esc(i.id)}">Review ↗</button></div>
  </article>`).join("");
  return `<div class="table-scroll"><table><thead><tr><th>Incident / reported</th><th>Type</th><th>Severity</th><th>Section / event time</th>${isSupervisor?"<th>Reporter</th>":""}<th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mobile-incident-list">${mobileCards}</div>`;
}
function bindFilters() {
  const ids = [["filter-search","q"],["filter-status","status"],["filter-type","type"],["filter-severity","severity"]];
  for (const [id, key] of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener(id === "filter-search" ? "input" : "change", debounce(async () => {
      state.filters[key] = el.value;
      const params = new URLSearchParams(Object.entries(state.filters).filter(([,v])=>v));
      try {
        const data = await api(`/api/incidents?${params}`);
        state.incidents = data.incidents;
        renderIncidentList(state.user.role === "supervisor");
      } catch(e) { toast(e.message, true); }
    }, id === "filter-search" ? 250 : 0));
  }
}
function debounce(fn, ms) {
  let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
function renderReportForm() {
  setPageHeader("Report an incident");
  $("page-content").innerHTML = `
    ${pageIntro("Report a safety concern", "Share what happened, where it happened and how serious it may be. Required fields are marked with an asterisk.")}
    <div class="form-layout">
      <section class="card form-card">
        <form id="incident-form">
          <div class="form-grid">
            <div class="field">
              <label for="incident-type">Incident type *</label>
              <select id="incident-type" name="type" required><option value="">Select type</option><option value="accident">Accident</option><option value="near-miss">Near-miss</option><option value="unsafe condition">Unsafe condition</option></select>
            </div>
            <div class="field">
              <label for="incident-severity">Severity *</label>
              <select id="incident-severity" name="severity" required><option value="">Select severity</option><option value="low">Low — no immediate threat observed</option><option value="medium">Medium — requires prompt review</option><option value="high">High — serious potential or harm</option></select>
            </div>
            <div class="field full">
              <label for="incident-section">Mine section / location *</label>
              <input id="incident-section" name="section" list="mine-sections" maxlength="100" placeholder="e.g. Level 2, Face 3, Haul road" required>
              <datalist id="mine-sections"><option>Level 2</option><option>Face 3</option><option>Haul road</option><option>Workshop</option><option>Conveyor belt</option><option>Loading point</option></datalist>
              <p class="field-hint">Use your site's official section name so repeated incidents can be grouped correctly.</p>
            </div>
            <div class="field full">
              <label for="incident-description">What happened / hazard description *</label>
              <textarea id="incident-description" name="description" maxlength="2000" placeholder="Describe what you observed, the equipment or activity involved, and any immediate risk. Avoid unnecessary personal details." required></textarea>
              <p class="field-hint">2,000 characters maximum. Do not delay emergency response to complete this form.</p>
            </div>
            <div class="field full">
              <label for="incident-photo">Attach photo (optional)</label>
              <input id="incident-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
              <p class="field-hint">JPG, PNG, WEBP or GIF · maximum 5 MB. Only upload images permitted by site policy.</p>
              <img id="photo-preview" class="file-preview" alt="Selected photo preview" hidden>
            </div>
            <div class="field full">
              <label for="incident-event-at">Date and time observed *</label>
              <input id="incident-event-at" name="eventAt" type="datetime-local" required>
              <p class="field-hint">The report submission time is recorded automatically as well.</p>
            </div>
          </div>
          <p id="incident-error" class="form-error" hidden></p>
          <div class="form-actions"><button class="btn btn-primary" type="submit" id="submit-incident">Submit report <span>→</span></button><button class="btn btn-secondary" type="button" data-nav="my-reports">Cancel</button></div>
        </form>
      </section>
      <aside class="card guidance-card">
        <h3>Before you submit</h3>
        <div class="guidance-step"><span class="step-no">1</span><div><b>Move to safety first</b><p>Follow mine emergency procedures and alert the appropriate person immediately if danger is active.</p></div></div>
        <div class="guidance-step"><span class="step-no">2</span><div><b>Choose a clear location</b><p>Consistent names help the safety team see where reports repeat.</p></div></div>
        <div class="guidance-step"><span class="step-no">3</span><div><b>Describe observations</b><p>Stick to what you saw and avoid guessing about the cause.</p></div></div>
        <div class="guidance-step"><span class="step-no">4</span><div><b>Check the status later</b><p>Your report appears in My reports after submission. A supervisor can update its progress.</p></div></div>
        <div class="notice"><strong>Not an emergency hotline</strong>MineGuard is a reporting and tracking tool. Use approved site alarms, communication channels and emergency procedures for urgent danger.</div>
      </aside>
    </div>`;
  $("incident-event-at").value = localDateTimeValue();
  $("incident-event-at").max = localDateTimeValue();
  $("incident-photo").addEventListener("change", previewPhoto);
  $("incident-form").addEventListener("submit", submitIncident);
}
function previewPhoto() {
  const file = $("incident-photo").files[0];
  const img = $("photo-preview");
  if (!file) { img.hidden = true; img.removeAttribute("src"); return; }
  if (file.size > 5 * 1024 * 1024) {
    $("incident-photo").value = "";
    img.hidden = true; toast("Photo is larger than 5 MB.", true); return;
  }
  const url = URL.createObjectURL(file);
  img.src = url; img.hidden = false;
}
async function compressImage(file) {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    let q = 0.8, blob = null;
    for (let n = 0; n < 4; n++) {
      blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= 700 * 1024) break;
      q -= 0.15;
    }
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}
async function submitIncident(event) {
  event.preventDefault();
  const form = $("incident-form");
  const errorEl = $("incident-error");
  errorEl.hidden = true;
  const file = $("incident-photo").files[0];
  if (file && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    errorEl.textContent = "Please choose a JPG, PNG, WEBP or GIF image.";
    errorEl.hidden = false; return;
  }
  if (file && file.size > 5 * 1024 * 1024) {
    errorEl.textContent = "Photo must be 5 MB or smaller.";
    errorEl.hidden = false; return;
  }
  const btn = $("submit-incident");
  btn.disabled = true; btn.textContent = "Submitting securely…";
  const data = new FormData(form);
  try {
    if (file) data.set("photo", await compressImage(file));
    const result = await api("/api/incidents", { method: "POST", body: data });
    toast(`Report submitted · ${result.incident.id.slice(0,8).toUpperCase()}`);
    state.filters = { q: "", status: "", type: "", severity: "", section: "" };
    await navigate("my-reports");
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    btn.disabled = false; btn.innerHTML = 'Submit report <span>→</span>';
  }
}
async function openIncident(id) {
  try {
    const result = state.incidents.find(i => i.id === id) || (await api("/api/incidents")).incidents.find(i => i.id === id);
    if (!result) return toast("Incident not found.", true);
    state.modal = result;
    renderIncidentModal(result);
  } catch (error) { toast(error.message, true); }
}
function renderIncidentModal(i) {
  const supervisor = state.user.role === "supervisor";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop"; backdrop.id = "incident-modal";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><div><p class="eyebrow">INCIDENT DETAIL · ${esc(i.id.slice(0,8).toUpperCase())}</p><h3 id="modal-title">${esc(i.section)} · ${esc(prettyType(i.type))}</h3><p>Reported ${esc(formatDate(i.reportedAt))}</p></div><button class="close-modal" data-close-modal aria-label="Close dialog">×</button></div>
    <div class="detail-meta">
      <div class="meta-block"><small>SEVERITY</small>${severityPill(i.severity)}</div>
      <div class="meta-block"><small>STATUS</small>${statusPill(i.status)}</div>
      <div class="meta-block"><small>EVENT TIME</small><b>${esc(formatDate(i.eventAt))}</b></div>
      <div class="meta-block"><small>REPORTER</small><b>${esc(i.reporterName || "You")}</b></div>
    </div>
    <div class="detail-section"><h4>Description</h4><div class="detail-copy">${esc(i.description)}</div></div>
    ${i.photoUrl ? `<div class="detail-section"><h4>Photo evidence</h4><img class="detail-photo" src="${esc(i.photoUrl)}" alt="Incident evidence photo"></div>` : ""}
    ${i.actionNote ? `<div class="detail-section"><h4>Investigation / corrective-action note</h4><div class="detail-copy">${esc(i.actionNote)}</div></div>` : ""}
    <div class="detail-section"><h4>Activity history</h4>${(i.history || []).slice().reverse().map(h => `<div class="history-item"><b>${esc(h.status)} · ${esc(h.by || "User")}</b><p>${esc(formatDate(h.at))}<br>${esc(h.note || "")}</p></div>`).join("")}</div>
    ${supervisor ? `<form id="status-form" data-id="${esc(i.id)}" class="detail-section"><h4>Supervisor action</h4><label for="status-next">Update status</label><select id="status-next" name="status">${STATUS.map(s=>`<option ${s===i.status?"selected":""}>${s}</option>`).join("")}</select><label for="action-note">Investigation / corrective-action note</label><textarea id="action-note" maxlength="1000" placeholder="Record what was checked, action assigned or evidence needed…">${esc(i.actionNote || "")}</textarea><p id="status-error" class="form-error" hidden></p><div class="form-actions"><button class="btn btn-primary" type="submit" id="save-status">Save update</button></div></form>` : ""}
  </section>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", event => { if (event.target === backdrop || event.target.closest("[data-close-modal]")) closeModal(); });
  const form = $("status-form");
  if (form) form.addEventListener("submit", saveStatus);
}
function closeModal() {
  const modal = $("incident-modal");
  if (modal) modal.remove();
  state.modal = null;
}
async function saveStatus(event) {
  event.preventDefault();
  const form = event.currentTarget, id = form.dataset.id;
  const btn = $("save-status"), error = $("status-error");
  btn.disabled = true; btn.textContent = "Saving…"; error.hidden = true;
  try {
    await api(`/api/incidents/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: { status: $("status-next").value, actionNote: $("action-note").value }
    });
    closeModal(); toast("Incident status and history updated.");
    await navigate(state.activeView);
  } catch (e) {
    error.textContent = e.message; error.hidden = false;
    btn.disabled = false; btn.textContent = "Save update";
  }
}
function renderTeam() {
  setPageHeader("Worker accounts");
  const workers = state.team.filter(u => u.role === "worker");
  $("page-content").innerHTML = `
    ${pageIntro("Team access", "Create worker accounts for your site. Account roles are assigned by the system, not selected by the user at login.", `<button class="btn btn-primary" id="add-worker">＋ Create worker account</button>`)}
    <section class="card" style="margin-bottom:16px"><div class="card-header"><div><h3>Workers</h3><p>${workers.length} worker account${workers.length===1?"":"s"} registered</p></div><span class="card-kicker">TEAM DIRECTORY</span></div>
    <div class="team-grid">${workers.length ? workers.map(w=>`<div class="team-card"><div class="profile-icon">${esc(initials(w.name))}</div><div><b>${esc(w.name)}</b><small>${esc(w.email)}</small><small>Joined ${esc(formatDate(w.createdAt, false))}</small></div></div>`).join("") : `<div class="empty-state">No worker accounts yet.</div>`}</div></section>
    <section class="card"><div class="card-header"><div><h3>Account roles</h3><p>Supervisors can see all incident reports, change status and export records. Workers see only their own reports.</p></div></div><div class="team-grid"><div class="team-card"><div class="profile-icon">S</div><div><b>Safety supervisor</b><small>Analytics · investigation · exports · worker account creation</small></div></div><div class="team-card"><div class="profile-icon">W</div><div><b>Mine worker</b><small>Report incidents · upload photos · follow own report status</small></div></div></div></section>`;
  $("add-worker").addEventListener("click", renderCreateWorkerModal);
}
function renderCreateWorkerModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop"; backdrop.id = "worker-modal";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="worker-modal-title">
    <div class="modal-head"><div><p class="eyebrow">ACCOUNT MANAGEMENT</p><h3 id="worker-modal-title">Create a worker login</h3><p>Give the worker their sign-in details securely.</p></div><button class="close-modal" data-close-worker aria-label="Close dialog">×</button></div>
    <form id="worker-form"><label for="worker-name">Full name</label><input id="worker-name" name="name" required maxlength="100" placeholder="Worker name"><label for="worker-email">Email address</label><input id="worker-email" name="email" type="email" required maxlength="254" placeholder="worker@mine.com"><label for="worker-password">Temporary password</label><input id="worker-password" name="password" type="password" minlength="10" maxlength="128" required placeholder="At least 10 characters"><p class="field-hint">Set a strong temporary password and share it securely with the worker.</p><p id="worker-error" class="form-error" hidden></p><div class="form-actions"><button class="btn btn-primary" type="submit" id="create-worker-submit">Create worker</button><button class="btn btn-secondary" type="button" data-close-worker>Cancel</button></div></form>
  </section>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.closest("[data-close-worker]")) backdrop.remove(); });
  $("worker-form").addEventListener("submit", createWorker);
}
async function createWorker(event) {
  event.preventDefault();
  const btn = $("create-worker-submit"), err = $("worker-error");
  btn.disabled = true; btn.textContent = "Creating…"; err.hidden = true;
  try {
    await api("/api/team", { method: "POST", body: {
      name: $("worker-name").value, email: $("worker-email").value, password: $("worker-password").value
    }});
    $("worker-modal").remove(); toast("Worker account created.");
    await navigate("team");
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
    btn.disabled = false; btn.textContent = "Create worker";
  }
}
function attachGlobalEvents() {
  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-nav]");
    if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
    const open = event.target.closest("[data-open-incident]");
    if (open) { openIncident(open.dataset.openIncident); return; }
    if (event.target.closest("[data-retry]")) navigate(state.activeView);
  });
  $("primary-nav").addEventListener("click", event => {
    const nav = event.target.closest("[data-nav]");
    if (nav) navigate(nav.dataset.nav);
  });
  $("logout-button").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    showLogin(); toast("You have signed out.");
  });
  $("mobile-menu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  document.addEventListener("click", event => {
    if (window.innerWidth <= 780 && $("sidebar").classList.contains("open") &&
        !event.target.closest("#sidebar") && !event.target.closest("#mobile-menu")) {
      $("sidebar").classList.remove("open");
    }
  });
}
function attachLoginEvents() {
  document.querySelectorAll("[data-role]").forEach(button => button.addEventListener("click", () => {
    state.loginRole = button.dataset.role;
    document.querySelectorAll("[data-role]").forEach(b => {
      const active = b.dataset.role === state.loginRole;
      b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active));
    });
    $("login-submit").innerHTML = `Sign in as ${state.loginRole} <span>→</span>`;
    $("demo-credential-text").textContent = state.loginRole === "worker"
      ? "Worker: worker@mineguard.demo" : "Supervisor: supervisor@mineguard.demo";
    $("demo-password-text").textContent = state.loginRole === "worker"
      ? "Password: Worker@123" : "Password: Supervisor@123";
    $("login-error").hidden = true;
  }));
  $("fill-demo").addEventListener("click", () => {
    $("login-email").value = state.loginRole === "worker" ? "worker@mineguard.demo" : "supervisor@mineguard.demo";
    $("login-password").value = state.loginRole === "worker" ? "Worker@123" : "Supervisor@123";
  });
  $("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const error = $("login-error"), button = $("login-submit");
    error.hidden = true; button.disabled = true; button.textContent = "Signing in…";
    try {
      const result = await api("/api/login", { method: "POST", body: {
        email: $("login-email").value, password: $("login-password").value, expectedRole: state.loginRole
      }});
      showApp(result.user);
    } catch (e) {
      error.textContent = e.message; error.hidden = false;
    } finally {
      button.disabled = false;
      button.innerHTML = `Sign in as ${state.loginRole} <span>→</span>`;
    }
  });
}
async function init() {
  attachGlobalEvents(); attachLoginEvents();
  try {
    const result = await api("/api/me");
    showApp(result.user);
  } catch {
    showLogin();
  }
}
document.addEventListener("DOMContentLoaded", init);
