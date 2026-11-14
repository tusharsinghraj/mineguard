"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1); // required behind Render/Railway/Fly proxies so secure cookies and rate limits work
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const DEMO_MODE = String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";
const SESSION_SECRET = process.env.SESSION_SECRET || "mineguard-local-demo-secret-change-before-deployment";

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

// ---- Firebase / Firestore (optional). If no credentials are set, the app falls back to the local JSON file. ----
let db = null;
function initFirestore() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
  }
  if (!raw) return null;
  const admin = require("firebase-admin");
  const creds = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  const firestore = admin.firestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}
db = initFirestore();
const MAX_FIRESTORE_PHOTO_BYTES = 800 * 1024; // Firestore documents are capped at 1 MiB

const INCIDENT_TYPES = ["accident", "near-miss", "unsafe condition"];
const SEVERITIES = ["low", "medium", "high"];
const STATUSES = ["Reported", "Under Investigation", "Resolved"];

function safeEqualText(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function nowIso() { return new Date().toISOString(); }

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.incidents)) throw new Error("Invalid store");
    return parsed;
  } catch {
    return { users: [], incidents: [] };
  }
}

let store = db ? { users: [], incidents: [] } : readStore();
function saveStore() {
  const temp = STORE_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, STORE_FILE);
}

async function persist({ users = [], incidents = [] } = {}) {
  if (!db) { saveStore(); return; }
  const writes = [
    ...users.map(u => [db.collection("users").doc(u.id), u]),
    ...incidents.map(i => [db.collection("incidents").doc(i.id), i])
  ];
  for (let n = 0; n < writes.length; n += 400) {
    const batch = db.batch();
    for (const [ref, data] of writes.slice(n, n + 400)) batch.set(ref, data);
    await batch.commit();
  }
}

async function loadFromFirestore() {
  const [u, i] = await Promise.all([db.collection("users").get(), db.collection("incidents").get()]);
  store.users = u.docs.map(d => d.data());
  store.incidents = i.docs.map(d => d.data());
}

async function addSampleReports() {
  if (!DEMO_MODE || store.incidents.length > 0) return;
  const supervisor = store.users.find(u => u.role === "supervisor");
  const worker = store.users.find(u => u.role === "worker");
  if (!supervisor || !worker) return;
  const now = Date.now();
  const ago = days => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const samples = [
    { days: 0, type: "near-miss", severity: "high", section: "Face 3", description: "Loose material observed near the working face during routine movement; area referred for inspection.", status: "Reported" },
    { days: 1, type: "near-miss", severity: "medium", section: "Face 3", description: "Trip hazard reported on the face access path; housekeeping review requested.", status: "Under Investigation" },
    { days: 3, type: "near-miss", severity: "high", section: "Face 3", description: "Equipment movement came close to the marked pedestrian route; traffic separation requires review.", status: "Reported" },
    { days: 2, type: "unsafe condition", severity: "medium", section: "Haul road", description: "Visibility was reduced at the haul road bend; line-of-sight and signage require inspection.", status: "Under Investigation" },
    { days: 5, type: "unsafe condition", severity: "low", section: "Workshop", description: "Loose cable routing was identified in the workshop; housekeeping correction was recorded.", status: "Resolved" },
    { days: 8, type: "accident", severity: "high", section: "Level 2", description: "Equipment-related incident reported in Level 2; supervisor review and corrective-action verification recorded.", status: "Resolved" },
    { days: 6, type: "near-miss", severity: "medium", section: "Haul road", description: "Near-miss reported during reversing; banksman visibility and vehicle movement controls require review.", status: "Reported" },
    { days: 12, type: "unsafe condition", severity: "medium", section: "Face 3", description: "A follow-up inspection identified housekeeping improvements in the working section.", status: "Resolved" }
  ];
  store.incidents = samples.map((s, i) => ({
    id: crypto.randomUUID(),
    type: s.type,
    severity: s.severity,
    section: s.section,
    description: s.description,
    eventAt: ago(s.days),
    reportedAt: ago(s.days),
    status: s.status,
    photoName: null,
    reporterId: worker.id,
    reporterName: worker.name,
    reporterEmail: worker.email,
    assignedTo: s.status === "Under Investigation" ? supervisor.name : null,
    actionNote: s.status === "Resolved" ? "Corrective action completed and follow-up inspection recorded by the shift supervisor." : "",
    updatedAt: ago(s.days),
    isDemo: true,
    history: [{ status: s.status, at: ago(s.days), by: s.status === "Resolved" ? supervisor.name : worker.name, note: s.status === "Resolved" ? "Follow-up inspection and closure recorded." : "Initial report submitted for supervisor review." }]
  }));
  await persist({ incidents: store.incidents });
}

async function bootstrap() {
  if (db) await loadFromFirestore();
  if (store.users.length === 0) {
    if (DEMO_MODE) {
      store.users.push({
        id: crypto.randomUUID(), name: "Safety Supervisor", email: "supervisor@mineguard.demo",
        passwordHash: await bcrypt.hash("Supervisor@123", 10), role: "supervisor", createdAt: nowIso()
      });
      store.users.push({
        id: crypto.randomUUID(), name: "Mine Worker", email: "worker@mineguard.demo",
        passwordHash: await bcrypt.hash("Worker@123", 10), role: "worker", createdAt: nowIso()
      });
    } else {
      const supervisorEmail = process.env.SUPERVISOR_EMAIL;
      const supervisorPassword = process.env.SUPERVISOR_PASSWORD;
      const workerEmail = process.env.WORKER_EMAIL;
      const workerPassword = process.env.WORKER_PASSWORD;
      if (!supervisorEmail || !supervisorPassword || !workerEmail || !workerPassword) {
        throw new Error("Set supervisor/worker email and password environment variables when DEMO_MODE=false.");
      }
      if (supervisorPassword.length < 10 || workerPassword.length < 10) {
        throw new Error("Bootstrap passwords must be at least 10 characters.");
      }
      store.users.push({
        id: crypto.randomUUID(), name: process.env.SUPERVISOR_NAME || "Safety Supervisor",
        email: supervisorEmail.toLowerCase().trim(), passwordHash: await bcrypt.hash(supervisorPassword, 12),
        role: "supervisor", createdAt: nowIso()
      });
      store.users.push({
        id: crypto.randomUUID(), name: process.env.WORKER_NAME || "Mine Worker",
        email: workerEmail.toLowerCase().trim(), passwordHash: await bcrypt.hash(workerPassword, 12),
        role: "worker", createdAt: nowIso()
      });
    }
    await persist({ users: store.users });
  }
  await addSampleReports();
}
const bootPromise = bootstrap();

// Security headers and static hosting
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
class FirestoreSessionStore extends session.Store {
  constructor(firestore) { super(); this.col = firestore.collection("sessions"); }
  get(sid, cb) {
    this.col.doc(sid).get().then(d => {
      if (!d.exists) return cb(null, null);
      const { data, expires } = d.data();
      if (expires < Date.now()) { this.col.doc(sid).delete().catch(() => {}); return cb(null, null); }
      cb(null, JSON.parse(data));
    }).catch(cb);
  }
  set(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
    this.col.doc(sid).set({ data: JSON.stringify(sess), expires }).then(() => cb && cb(null)).catch(e => cb && cb(e));
  }
  destroy(sid, cb) { this.col.doc(sid).delete().then(() => cb && cb(null)).catch(e => cb && cb(e)); }
}

app.use(session({
  store: db ? new FirestoreSessionStore(db) : undefined,
  name: "mineguard.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in to continue." });
  next();
}
function requireSupervisor(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in to continue." });
  if (req.session.user.role !== "supervisor") return res.status(403).json({ error: "Supervisor access is required." });
  next();
}
function currentUser(req) {
  return store.users.find(u => u.id === req.session.user.id);
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
}
function cleanIncident(incident, viewer) {
  const result = { ...incident };
  delete result.photoName;
  // Seeded records are synthetic data for local presentation; keep the UI clean while retaining their internal flag for maintenance.
  if (result.isDemo) {
    result.description = String(result.description || "").replace(/^\[DEMO DATA\]\s*/i, "");
    if (String(result.actionNote || "").startsWith("Demo action recorded;")) {
      result.actionNote = "Corrective action completed and follow-up inspection recorded by the shift supervisor.";
    }
    result.history = (result.history || []).map(entry => ({
      ...entry,
      note: entry.note === "Demo record" ? "Follow-up inspection and closure recorded." : entry.note
    }));
  }
  delete result.isDemo;
  // Workers can see only their own records; supervisor sees reporter identity.
  if (viewer.role !== "supervisor") {
    delete result.reporterEmail;
    delete result.reporterId;
  }
  result.photoUrl = incident.photoName ? `/api/photos/${encodeURIComponent(incident.photoName)}` : null;
  return result;
}
function validateText(value, max, field) {
  if (typeof value !== "string" || !value.trim()) return `${field} is required.`;
  if (value.trim().length > max) return `${field} must be ${max} characters or fewer.`;
  return null;
}
function parseEventAt(input) {
  if (!input) return nowIso();
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() > Date.now() + 5 * 60 * 1000) return null;
  return d.toISOString();
}
function csvCell(value) {
  const s = String(value == null ? "" : value);
  return `"${s.replace(/"/g, '""')}"`;
}

app.get("/api/health", async (req, res) => {
  await bootPromise;
  res.json({ ok: true, app: "MineGuard", mode: DEMO_MODE ? "demo" : "configured", time: nowIso() });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  await bootPromise;
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const expectedRole = String(req.body.expectedRole || "");
  if (!email || !password || !["worker", "supervisor"].includes(expectedRole)) {
    return res.status(400).json({ error: "Choose a login type and enter email and password." });
  }
  const user = store.users.find(u => safeEqualText(u.email, email));
  const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !passwordOk || user.role !== expectedRole) {
    return res.status(401).json({ error: "Login details don't match this portal. Check the email, password and selected role." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Unable to start a secure session. Please retry." });
    req.session.user = publicUser(user);
    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: "Unable to save your session. Please retry." });
      res.json({ user: publicUser(user), demoMode: DEMO_MODE });
    });
  });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(err => {
    res.clearCookie("mineguard.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    if (err) return res.status(500).json({ error: "Logout failed. Please close your browser." });
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  await bootPromise;
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Account not found. Please log in again." });
  res.json({ user: publicUser(user), demoMode: DEMO_MODE });
});

app.post("/api/incidents", requireAuth, (req, res, next) => {
  upload.single("photo")(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || "Photo upload failed." });
    next();
  });
}, async (req, res) => {
  await bootPromise;
  const type = String(req.body.type || "").trim().toLowerCase();
  const severity = String(req.body.severity || "").trim().toLowerCase();
  const section = String(req.body.section || "").trim();
  const description = String(req.body.description || "").trim();
  const eventAt = parseEventAt(req.body.eventAt);
  const typeError = INCIDENT_TYPES.includes(type) ? null : "Choose a valid incident type.";
  const severityError = SEVERITIES.includes(severity) ? null : "Choose a valid severity.";
  const sectionError = validateText(section, 100, "Mine section");
  const descriptionError = validateText(description, 2000, "Description");
  const errors = [typeError, severityError, sectionError, descriptionError, eventAt ? null : "Choose a valid date and time (not in the future)."].filter(Boolean);
  if (errors.length) {
    return res.status(400).json({ error: errors[0], errors });
  }
  const user = currentUser(req);
  const now = nowIso();
  let photoName = null;
  if (req.file) {
    const extMap = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
    photoName = crypto.randomUUID() + (extMap[req.file.mimetype] || ".img");
    try {
      if (db) {
        if (req.file.size > MAX_FIRESTORE_PHOTO_BYTES) {
          return res.status(400).json({ error: "Photo is too large. Please choose a photo under 800 KB (it is normally compressed automatically)." });
        }
        await db.collection("photos").doc(photoName).set({ data: req.file.buffer, contentType: req.file.mimetype, createdAt: now });
      } else {
        fs.writeFileSync(path.join(UPLOAD_DIR, photoName), req.file.buffer);
      }
    } catch (e) {
      console.error("Photo save failed:", e.message);
      return res.status(500).json({ error: "Could not save the photo. Please try again." });
    }
  }
  const incident = {
    id: crypto.randomUUID(), type, severity, section, description,
    eventAt, reportedAt: now, status: "Reported",
    photoName,
    reporterId: user.id, reporterName: user.name, reporterEmail: user.email,
    assignedTo: null, actionNote: "", updatedAt: now, isDemo: false,
    history: [{ status: "Reported", at: now, by: user.name, note: "Incident submitted" }]
  };
  store.incidents.unshift(incident);
  await persist({ incidents: [incident] });
  res.status(201).json({ incident: cleanIncident(incident, req.session.user) });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      return cb(new Error("Photo must be JPG, PNG, WEBP or GIF, up to 5 MB."));
    }
    cb(null, true);
  }
});

app.get("/api/incidents", requireAuth, async (req, res) => {
  await bootPromise;
  const viewer = req.session.user;
  const params = req.query;
  let results = store.incidents.filter(i => viewer.role === "supervisor" || i.reporterId === viewer.id);
  if (params.type && INCIDENT_TYPES.includes(String(params.type))) results = results.filter(i => i.type === params.type);
  if (params.severity && SEVERITIES.includes(String(params.severity))) results = results.filter(i => i.severity === params.severity);
  if (params.status && STATUSES.includes(String(params.status))) results = results.filter(i => i.status === params.status);
  if (params.section) results = results.filter(i => i.section.toLowerCase().includes(String(params.section).toLowerCase().slice(0, 100)));
  if (params.q) {
    const q = String(params.q).toLowerCase().slice(0, 100);
    results = results.filter(i => [i.id, i.section, i.description, i.reporterName, i.type].some(v => String(v || "").toLowerCase().includes(q)));
  }
  if (params.from) {
    const from = new Date(params.from);
    if (!Number.isNaN(from.getTime())) results = results.filter(i => new Date(i.eventAt) >= from);
  }
  if (params.to) {
    const to = new Date(params.to);
    if (!Number.isNaN(to.getTime())) results = results.filter(i => new Date(i.eventAt) <= to);
  }
  results.sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
  res.json({ incidents: results.map(i => cleanIncident(i, viewer)), total: results.length });
});

app.patch("/api/incidents/:id/status", requireSupervisor, async (req, res) => {
  await bootPromise;
  const incident = store.incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found." });
  const status = String(req.body.status || "");
  const actionNote = String(req.body.actionNote || "").trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Choose a valid status." });
  if (actionNote.length > 1000) return res.status(400).json({ error: "Corrective-action note must be 1,000 characters or fewer." });
  const user = currentUser(req);
  const oldStatus = incident.status;
  incident.status = status;
  incident.actionNote = actionNote;
  incident.updatedAt = nowIso();
  incident.assignedTo = status === "Reported" ? null : user.name;
  incident.history = Array.isArray(incident.history) ? incident.history : [];
  incident.history.push({
    status, at: incident.updatedAt, by: user.name,
    note: actionNote || (oldStatus === status ? "Record reviewed; status retained." : `Status changed from ${oldStatus} to ${status}.`)
  });
  await persist({ incidents: [incident] });
  res.json({ incident: cleanIncident(incident, req.session.user) });
});

app.get("/api/analytics", requireSupervisor, async (req, res) => {
  await bootPromise;
  const all = store.incidents;
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const recent = all.filter(i => new Date(i.eventAt).getTime() >= sevenDaysAgo);
  const types = Object.fromEntries(INCIDENT_TYPES.map(t => [t, all.filter(i => i.type === t).length]));
  const sectionsMap = {};
  for (const item of all) {
    const key = item.section || "Unspecified";
    sectionsMap[key] ||= { section: key, total: 0, high: 0, nearMiss: 0, open: 0 };
    sectionsMap[key].total++;
    if (item.severity === "high") sectionsMap[key].high++;
    if (item.type === "near-miss" && new Date(item.eventAt).getTime() >= sevenDaysAgo) sectionsMap[key].nearMiss++;
    if (item.status !== "Resolved") sectionsMap[key].open++;
  }
  const sections = Object.values(sectionsMap).sort((a, b) => b.total - a.total);
  const trend = [];
  for (let ago = 6; ago >= 0; ago--) {
    const d = new Date(now);
    d.setDate(d.getDate() - ago);
    const key = d.toISOString().slice(0, 10);
    const count = all.filter(i => new Date(i.eventAt).toISOString().slice(0, 10) === key).length;
    trend.push({ date: key, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), count });
  }
  const alerts = [];
  for (const sec of sections) {
    const n = recent.filter(i => i.section.toLowerCase() === sec.section.toLowerCase() && i.type === "near-miss").length;
    if (n >= 3) alerts.push({
      id: `cluster-${sec.section}`, level: "high", title: "Near-miss cluster detected",
      message: `${n} near-misses in ${sec.section} within the last 7 days. Inspection recommended.`,
      section: sec.section, count: n
    });
  }
  const recurringMap = {};
  for (const item of all.filter(i => new Date(i.eventAt).getTime() >= thirtyDaysAgo)) {
    const key = `${item.section}::${item.type}`;
    recurringMap[key] ||= { section: item.section, type: item.type, count: 0 };
    recurringMap[key].count++;
  }
  for (const item of Object.values(recurringMap)) {
    if (item.count >= 3 && !alerts.some(a => a.section === item.section && a.title === "Near-miss cluster detected")) {
      alerts.push({
        id: `repeat-${item.section}-${item.type}`, level: item.type === "accident" ? "high" : "medium",
        title: "Recurring hazard pattern",
        message: `${item.count} ${item.type} reports in ${item.section} within 30 days. Review controls and root cause.`,
        section: item.section, count: item.count
      });
    }
  }
  const unresolved = all.filter(i => i.status !== "Resolved").length;
  const highSeverity = all.filter(i => i.severity === "high" && i.status !== "Resolved").length;
  res.json({
    total: all.length, open: unresolved, highSeverity, resolved: all.length - unresolved,
    types, sections, trend, alerts,
    heatmap: sections.map(s => ({
      section: s.section, count: s.total, risk: s.high > 0 || s.nearMiss >= 3 ? "high" : (s.total >= 2 ? "medium" : "low")
    })),
    recentCount: recent.length,
    demoDataCount: all.filter(i => i.isDemo).length
  });
});

app.get("/api/incidents/export.csv", requireSupervisor, async (req, res) => {
  await bootPromise;
  const headers = ["ID", "Type", "Severity", "Mine Section", "Description", "Event Time", "Reported At", "Status", "Reporter", "Assigned To", "Corrective Action"];
  const rows = store.incidents.map(i => [
    i.id, i.type, i.severity, i.section, i.description, i.eventAt, i.reportedAt, i.status,
    i.reporterName, i.assignedTo || "", i.actionNote || ""
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="mineguard-incidents.csv"');
  res.send("\uFEFF" + csv);
});

app.get("/api/team", requireSupervisor, async (req, res) => {
  await bootPromise;
  res.json({ users: store.users.map(publicUser) });
});

app.post("/api/team", requireSupervisor, async (req, res) => {
  await bootPromise;
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const nameError = validateText(name, 100, "Name");
  if (nameError) return res.status(400).json({ error: nameError });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be at least 10 and at most 128 characters." });
  if (store.users.some(u => safeEqualText(u.email, email))) return res.status(409).json({ error: "An account with this email already exists." });
  const newUser = {
    id: crypto.randomUUID(), name, email, role: "worker",
    passwordHash: await bcrypt.hash(password, 10), createdAt: nowIso()
  };
  store.users.push(newUser);
  await persist({ users: [newUser] });
  res.status(201).json({ user: publicUser(newUser) });
});

app.get("/api/photos/:filename", requireAuth, async (req, res) => {
  await bootPromise;
  const filename = path.basename(req.params.filename);
  const incident = store.incidents.find(i => i.photoName === filename);
  if (!incident) return res.status(404).send("Photo not found.");
  if (req.session.user.role !== "supervisor" && incident.reporterId !== req.session.user.id) {
    return res.status(403).send("You are not allowed to view this photo.");
  }
  if (db) {
    const doc = await db.collection("photos").doc(filename).get();
    if (!doc.exists) return res.status(404).send("Photo file is missing.");
    const { data, contentType } = doc.data();
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", contentType || "image/jpeg");
    return res.send(Buffer.from(data));
  }
  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).send("Photo file is missing.");
  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(fullPath);
});

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.use((err, req, res, next) => {
  console.error(err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  const status = err && err.code === "LIMIT_FILE_SIZE" ? 400 : 500;
  res.status(status).json({ error: err.message || "Unexpected server error." });
});

bootPromise.then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MineGuard is running at http://localhost:${PORT}`);
    console.log(`Database: ${db ? "Firebase Firestore" : "local JSON file (data/store.json)"}`);
    console.log(`Mode: ${DEMO_MODE ? "DEMO (sample reports enabled)" : "configured"}`);
    if (DEMO_MODE) {
      console.log("Demo supervisor: supervisor@mineguard.demo / Supervisor@123");
      console.log("Demo worker:     worker@mineguard.demo / Worker@123");
    }
  });
}).catch(err => {
  console.error("MineGuard failed to start:", err);
  process.exit(1);
});
