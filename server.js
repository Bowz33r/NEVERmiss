require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const db = new Database("nevermiss.sqlite");
const PORT = process.env.PORT || 3000;
const BTC_ADDRESS = process.env.BITCOIN_ADDRESS || "1CHiggYcdzuEpiWVEnF2y7e83viyAhzh2m";

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  subscription_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  notes TEXT DEFAULT '',
  reminded_30 INTEGER DEFAULT 0,
  reminded_7 INTEGER DEFAULT 0,
  reminded_1 INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  txid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE(txid),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "nevermiss.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 150 }));

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT id,email,subscription_status,subscription_expires_at FROM users WHERE id=?").get(req.session.userId);
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function hasActiveSubscription(user) {
  return user && user.subscription_status === "active" &&
    user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date();
}
function requireSubscription(req, res, next) {
  const user = currentUser(req);
  if (!hasActiveSubscription(user)) return res.status(402).json({ error: "An active annual subscription is required." });
  next();
}
function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

app.get("/api/config", (req, res) => res.json({ bitcoinAddress: BTC_ADDRESS, annualPriceUsd: 50 }));
app.get("/api/me", (req, res) => res.json({ user: currentUser(req) }));

app.post("/api/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
    return res.status(400).json({ error: "Enter a valid email and a password of at least 10 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(email,password_hash) VALUES(?,?)").run(email, hash);
    req.session.userId = result.lastInsertRowid;
    res.json({ ok: true, user: currentUser(req) });
  } catch {
    res.status(409).json({ error: "That email may already be registered." });
  }
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash)))
    return res.status(401).json({ error: "Incorrect email or password." });
  req.session.userId = user.id;
  res.json({ ok: true, user: currentUser(req) });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/reminders", requireAuth, requireSubscription, (req, res) => {
  res.json(db.prepare("SELECT id,title,due_date,category,notes FROM reminders WHERE user_id=? ORDER BY due_date").all(req.session.userId));
});
app.post("/api/reminders", requireAuth, requireSubscription, (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 120);
  const due = String(req.body.due_date || "");
  const category = String(req.body.category || "General").slice(0, 60);
  const notes = String(req.body.notes || "").slice(0, 1000);
  if (!title || !validDate(due)) return res.status(400).json({ error: "Add a title and a valid due date." });
  const result = db.prepare("INSERT INTO reminders(user_id,title,due_date,category,notes) VALUES(?,?,?,?,?)")
    .run(req.session.userId, title, due, category, notes);
  res.json({ ok: true, id: result.lastInsertRowid });
});
app.delete("/api/reminders/:id", requireAuth, requireSubscription, (req, res) => {
  db.prepare("DELETE FROM reminders WHERE id=? AND user_id=?").run(Number(req.params.id), req.session.userId);
  res.json({ ok: true });
});

app.post("/api/payments", requireAuth, (req, res) => {
  const txid = String(req.body.txid || "").trim();
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) return res.status(400).json({ error: "Enter a valid 64-character Bitcoin transaction ID (TXID)." });
  try {
    db.prepare("INSERT INTO payments(user_id,txid) VALUES(?,?)").run(req.session.userId, txid);
    res.json({ ok: true, message: "Payment submitted for manual review. Your subscription stays inactive until it is verified." });
  } catch {
    res.status(409).json({ error: "That transaction ID has already been submitted." });
  }
});
app.get("/api/payment-status", requireAuth, (req, res) => {
  const payments = db.prepare("SELECT txid,status,submitted_at FROM payments WHERE user_id=? ORDER BY id DESC").all(req.session.userId);
  res.json({ payments, user: currentUser(req) });
});

// Admin: set x-admin-key to ADMIN_KEY. Approving a payment activates one year from today,
// or extends an existing unexpired subscription by one year.
app.get("/api/admin/payments", (req, res) => {
  if (!process.env.ADMIN_KEY || req.get("x-admin-key") !== process.env.ADMIN_KEY) return res.sendStatus(403);
  const rows = db.prepare(`
    SELECT p.id,p.txid,p.status,p.submitted_at,u.email
    FROM payments p JOIN users u ON u.id=p.user_id
    ORDER BY p.submitted_at DESC
  `).all();
  res.json(rows);
});
app.post("/api/admin/payments/:id/approve", (req, res) => {
  if (!process.env.ADMIN_KEY || req.get("x-admin-key") !== process.env.ADMIN_KEY) return res.sendStatus(403);
  const payment = db.prepare("SELECT * FROM payments WHERE id=?").get(Number(req.params.id));
  if (!payment) return res.status(404).json({ error: "Payment not found." });
  if (payment.status === "approved") return res.json({ ok: true, message: "Already approved." });
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(payment.user_id);
  const base = user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date()
    ? new Date(user.subscription_expires_at) : new Date();
  base.setFullYear(base.getFullYear() + 1);
  const expires = base.toISOString();
  const transaction = db.transaction(() => {
    db.prepare("UPDATE payments SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(payment.id);
    db.prepare("UPDATE users SET subscription_status='active',subscription_expires_at=? WHERE id=?").run(expires, payment.user_id);
  });
  transaction();
  res.json({ ok: true, email: user.email, expires });
});
app.post("/api/admin/payments/:id/reject", (req, res) => {
  if (!process.env.ADMIN_KEY || req.get("x-admin-key") !== process.env.ADMIN_KEY) return res.sendStatus(403);
  db.prepare("UPDATE payments SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

// Daily reminder job. SMTP is optional; with no SMTP configured, no emails are sent.
async function sendDueReminders() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const rows = db.prepare(`
    SELECT r.*,u.email FROM reminders r JOIN users u ON u.id=r.user_id
    WHERE u.subscription_status='active' AND u.subscription_expires_at > ?
  `).all(new Date().toISOString());
  for (const r of rows) {
    const due = new Date(r.due_date + "T00:00:00Z");
    const days = Math.round((due - today) / 86400000);
    const flag = days === 30 ? "reminded_30" : days === 7 ? "reminded_7" : days === 1 ? "reminded_1" : null;
    if (!flag || r[flag]) continue;
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: r.email,
      subject: `NeverMiss reminder: ${r.title}`,
      text: `${r.title} is due in ${days} day(s), on ${r.due_date}.\n\nSign in to NeverMiss to review your deadline.`
    });
    db.prepare(`UPDATE reminders SET ${flag}=1 WHERE id=?`).run(r.id);
  }
}
// A simple daily check. For production, use a durable job scheduler and monitor delivery.
setInterval(() => sendDueReminders().catch(err => console.error("Reminder email error:", err)), 60 * 60 * 1000);
sendDueReminders().catch(err => console.error("Reminder email error:", err));

app.listen(PORT, () => console.log(`NeverMiss running at http://localhost:${PORT}`));
