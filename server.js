require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const Database = require("better-sqlite3");
const twilio = require("twilio");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const UPLOADS = path.join(ROOT, "uploads");
const DATA = path.join(ROOT, "data");
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn("WARNING: Set JWT_SECRET to a long random secret in .env before production.");
}

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(x => x.trim()) : true
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(PUBLIC));

const db = new Database(path.join(DATA, "giveaway.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_type TEXT NOT NULL CHECK(task_type IN ('whatsapp','instagram','purchase')),
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  bill_number TEXT,
  purchase_amount REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  entry_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS used_bills (
  bill_number TEXT PRIMARY KEY,
  submission_id INTEGER NOT NULL UNIQUE,
  FOREIGN KEY(submission_id) REFERENCES task_submissions(id)
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  submission_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrate existing OTP-era databases without deleting submissions.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(column => column.name);
if (!userColumns.includes("name")) db.exec("ALTER TABLE users ADD COLUMN name TEXT");
if (!userColumns.includes("password_hash")) db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");

const minPurchase = Number(process.env.MINIMUM_PURCHASE || 1000);
const campaign = {
  whatsappUrl: process.env.WHATSAPP_GROUP_URL || "https://chat.whatsapp.com/REPLACE_WITH_YOUR_INVITE",
  instagramUrl: process.env.INSTAGRAM_PROFILE_URL || "https://www.instagram.com/v_creation_aundipatti_?xtok=cXhud29ybXl4enR5",
  minimumPurchase: Number.isFinite(minPurchase) ? minPurchase : 1000
};

function normalizeIndianPhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]/.test(digits)) return "+" + digits;
  if (String(input || "").trim().startsWith("+") && /^\+[1-9]\d{7,14}$/.test(String(input).trim())) return String(input).trim();
  return null;
}
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || "development-only-change-this-secret-now", { expiresIn: "12h" });
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!token) throw new Error("missing");
    req.auth = jwt.verify(token, process.env.JWT_SECRET || "development-only-change-this-secret-now");
    if (req.auth.role !== "user") return res.status(403).json({ error: "Customer access required." });
    next();
  } catch {
    return res.status(401).json({ error: "Please log in again." });
  }
}
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!token) throw new Error("missing");
    req.auth = jwt.verify(token, process.env.JWT_SECRET || "development-only-change-this-secret-now");
    if (req.auth.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
    next();
  } catch {
    return res.status(401).json({ error: "Administrator login required." });
  }
}
function twilioVerifyClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID ||
      TWILIO_ACCOUNT_SID.includes("xxxx") || TWILIO_VERIFY_SERVICE_SID.includes("xxxx")) return null;
  return { client: twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), serviceSid: TWILIO_VERIFY_SERVICE_SID };
}
function getUser(phone) {
  let user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user) {
    const result = db.prepare("INSERT INTO users(phone) VALUES (?)").run(phone);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  }
  return user;
}
function getTaskStatuses(userId) {
  const latest = db.prepare(`
    SELECT t.* FROM task_submissions t
    JOIN (SELECT task_type, MAX(id) AS max_id FROM task_submissions WHERE user_id=? GROUP BY task_type) x
    ON t.id=x.max_id
  `).all(userId);
  const statuses = { whatsapp: null, instagram: null, purchase: null };
  for (const row of latest) statuses[row.task_type] = {
    status: row.status,
    submittedAt: row.submitted_at,
    rejectionReason: row.rejection_reason,
    fileName: row.file_name
  };
  return statuses;
}
function ensureEntry(userId) {
  const tasks = getTaskStatuses(userId);
  if (["whatsapp", "instagram", "purchase"].every(k => tasks[k] && tasks[k].status === "approved")) {
    let entry = db.prepare("SELECT * FROM entries WHERE user_id=?").get(userId);
    if (!entry) {
      const code = "VC-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      db.prepare("INSERT OR IGNORE INTO entries(user_id, entry_code) VALUES (?, ?)").run(userId, code);
      entry = db.prepare("SELECT * FROM entries WHERE user_id=?").get(userId);
    }
    return entry;
  }
  return null;
}
function customerSnapshot(userId) {
  const user = db.prepare("SELECT id, phone, created_at FROM users WHERE id=?").get(userId);
  const tasks = getTaskStatuses(userId);
  const entry = ensureEntry(userId);
  return { user, tasks, eligible: !!entry, entryCode: entry ? entry.entry_code : null, minimumPurchase: campaign.minimumPurchase };
}

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: "Too many OTP requests. Please try again later." } });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "V Creation Giveaway API", otpConfigured: !!twilioVerifyClient() });
});
app.get("/api/config", (req, res) => {
  res.json({ whatsappUrl: campaign.whatsappUrl, instagramUrl: campaign.instagramUrl, minimumPurchase: campaign.minimumPurchase });
});

// Password-based customer authentication. Legacy OTP accounts remain in the database.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts. Please try again later." } });
app.post("/api/auth/register", authLimiter, async (req, res) => {
 const phone=normalizeIndianPhone(req.body.phone), name=String(req.body.name||"").trim(), password=String(req.body.password||"");
 if(!phone) return res.status(400).json({error:"Enter a valid mobile number."});
 if(name.length<2||name.length>80) return res.status(400).json({error:"Enter your full name (2–80 characters)."});
 if(password.length<8||password.length>72) return res.status(400).json({error:"Password must be between 8 and 72 characters."});
 if(db.prepare("SELECT id FROM users WHERE phone=?").get(phone)) return res.status(409).json({error:"An account already exists for this number. Please log in or contact support if you previously used OTP."});
 try {
  const hash=await bcrypt.hash(password,12);
  const result=db.prepare("INSERT INTO users(phone,name,password_hash) VALUES (?,?,?)").run(phone,name,hash);
  const user=db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
  const token=signToken({sub:String(user.id),role:"user",phone:user.phone});
  return res.status(201).json({ok:true,token,user:{id:user.id,phone:user.phone,name:user.name},snapshot:customerSnapshot(user.id)});
 } catch(err) {
  if(String(err.code||"").includes("SQLITE_CONSTRAINT")) return res.status(409).json({error:"An account already exists for this number."});
  console.error("Registration error:",err.message); return res.status(500).json({error:"Could not create your account. Please try again."});
 }
});
app.post("/api/auth/login", authLimiter, async (req,res)=>{
 const phone=normalizeIndianPhone(req.body.phone), password=String(req.body.password||"");
 if(!phone||!password||password.length>72) return res.status(400).json({error:"Enter a valid mobile number and password."});
 const user=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
 if(!user||!user.password_hash) return res.status(401).json({error:"Invalid mobile number or password. If you used the old OTP login, contact support to migrate your account."});
 if(!(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:"Invalid mobile number or password."});
 const token=signToken({sub:String(user.id),role:"user",phone:user.phone});
 return res.json({ok:true,token,user:{id:user.id,phone:user.phone,name:user.name},snapshot:customerSnapshot(user.id)});
});

app.get("/api/me", requireAuth, (req, res) => res.json(customerSnapshot(Number(req.auth.sub))));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return cb(new Error("Upload a JPG, PNG, or WEBP image."));
    cb(null, true);
  }
});

app.post("/api/tasks/:taskType", requireAuth, (req, res, next) => {
  upload.single("proof")(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    next();
  });
}, (req, res) => {
  const taskType = req.params.taskType;
  if (!["whatsapp", "instagram", "purchase"].includes(taskType)) return res.status(400).json({ error: "Unknown task type." });
  if (!req.file) return res.status(400).json({ error: "Please attach a screenshot or bill image." });
  let billNumber = null, amount = null;
  if (taskType === "purchase") {
    billNumber = String(req.body.billNumber || "").trim();
    amount = Number(req.body.purchaseAmount);
    if (!billNumber || !Number.isFinite(amount) || amount < campaign.minimumPurchase) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Enter a bill number and purchase amount of at least ₹${campaign.minimumPurchase}.` });
    }
    const existingBill = db.prepare("SELECT bill_number FROM used_bills WHERE bill_number=?").get(billNumber);
    if (existingBill) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: "This bill number has already been submitted." });
    }
  }
  const result = db.prepare(`
    INSERT INTO task_submissions(user_id, task_type, file_name, stored_name, bill_number, purchase_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(Number(req.auth.sub), taskType, req.file.originalname, req.file.filename, billNumber, amount);
  if (taskType === "purchase") {
    try {
      db.prepare("INSERT INTO used_bills(bill_number, submission_id) VALUES (?, ?)").run(billNumber, result.lastInsertRowid);
    } catch (err) {
      db.prepare("DELETE FROM task_submissions WHERE id=?").run(result.lastInsertRowid);
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: "This bill number has already been submitted." });
    }
  }
  res.status(201).json({ ok: true, message: "Submission received and awaiting manual admin review.", snapshot: customerSnapshot(Number(req.auth.sub)) });
});

// Admin login uses environment credentials. Use a unique password in production.
app.post("/api/admin/login", adminLimiter, async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const expectedUser = process.env.ADMIN_USERNAME || "admin";
  const expectedPassword = process.env.ADMIN_PASSWORD || "";
  if (!expectedPassword || expectedPassword.startsWith("replace-with-")) return res.status(503).json({ error: "Admin password is not configured. Set ADMIN_PASSWORD in .env." });
  const userOk = crypto.timingSafeEqual(Buffer.from(username.padEnd(128).slice(0,128)), Buffer.from(expectedUser.padEnd(128).slice(0,128)));
  // Password is configured as a secret; timingSafeEqual compares equal-length buffers.
  const passBuf = Buffer.from(password.padEnd(256).slice(0,256));
  const expectedBuf = Buffer.from(expectedPassword.padEnd(256).slice(0,256));
  const passOk = crypto.timingSafeEqual(passBuf, expectedBuf);
  if (!userOk || !passOk) return res.status(401).json({ error: "Invalid admin credentials." });
  const token = signToken({ sub: "admin", role: "admin", username: expectedUser });
  res.json({ ok: true, token });
});

app.get("/api/admin/submissions", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.user_id, u.phone, t.task_type, t.file_name, t.stored_name,
           t.bill_number, t.purchase_amount, t.status, t.rejection_reason, t.submitted_at
    FROM task_submissions t JOIN users u ON u.id=t.user_id
    ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.id DESC
  `).all();
  res.json({ submissions: rows.map(r => ({ ...r, proofUrl: `/api/admin/submissions/${r.id}/proof` })) });
});
app.get("/api/admin/submissions/:id/proof", requireAdmin, (req, res) => {
  const row = db.prepare("SELECT stored_name, file_name FROM task_submissions WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Submission not found." });
  const filePath = path.join(UPLOADS, row.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Proof file not found on server." });
  res.type(path.extname(row.file_name) || ".jpg");
  res.sendFile(filePath);
});
app.post("/api/admin/submissions/:id/review", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");
  const reason = String(req.body.reason || "").trim();
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Status must be approved or rejected." });
  if (status === "rejected" && !reason) return res.status(400).json({ error: "A rejection reason is required." });
  const row = db.prepare("SELECT * FROM task_submissions WHERE id=?").get(id);
  if (!row) return res.status(404).json({ error: "Submission not found." });
  if (row.status !== "pending") return res.status(409).json({ error: "This submission has already been reviewed. Ask the customer to resubmit if needed." });
  const tx = db.transaction(() => {
    db.prepare("UPDATE task_submissions SET status=?, rejection_reason=?, reviewed_at=CURRENT_TIMESTAMP, reviewed_by=? WHERE id=?")
      .run(status, status === "rejected" ? reason : null, req.auth.username, id);
    db.prepare("INSERT INTO admin_audit(admin_username, action, submission_id, details) VALUES (?, ?, ?, ?)")
      .run(req.auth.username, status, id, reason || "");
  });
  tx();
  const entry = ensureEntry(row.user_id);
  res.json({ ok: true, message: `Submission ${status}.`, eligible: !!entry, entryCode: entry ? entry.entry_code : null });
});
app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM task_submissions WHERE status='pending'").get().n;
  const approved = db.prepare("SELECT COUNT(*) AS n FROM task_submissions WHERE status='approved'").get().n;
  const eligible = db.prepare("SELECT COUNT(*) AS n FROM entries").get().n;
  res.json({ users, pending, approved, eligible });
});
app.get("/api/admin/eligible.csv", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT e.entry_code, u.phone, e.created_at
    FROM entries e JOIN users u ON u.id=e.user_id ORDER BY e.created_at
  `).all();
  const csv = ["participant_id,phone,eligible_since", ...rows.map(r =>
    [r.entry_code, r.phone, r.created_at].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
  )].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="vcreation-eligible-participants.csv"');
  res.send(csv);
});

app.get("*", (req, res) => res.sendFile(path.join(PUBLIC, "index.html")));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`V Creation Giveaway running at http://localhost:${PORT}`);
  console.log(`OTP configured: ${!!twilioVerifyClient()}`);
});
