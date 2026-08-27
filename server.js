"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "ai-safety-sight-change-me-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const BCRYPT_ROUNDS = 10;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "safety-sight.db");

const tokenBlacklist = new Set();

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function parseBearer(header) {
  if (!header || typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const CAMERAS = [
  {
    id: "cam-01",
    name: "ประตูทางเข้าหลัก",
    location: "อาคาร A ชั้น 1",
    zone: "ทางเข้า",
    status: "online",
    stream_url: "/streams/cam-01",
    ai_models: ["helmet", "restricted"],
  },
  {
    id: "cam-02",
    name: "พื้นที่ก่อสร้าง",
    location: "ไซต์งาน โซน B",
    zone: "ก่อสร้าง",
    status: "online",
    stream_url: "/streams/cam-02",
    ai_models: ["helmet", "fall", "restricted"],
  },
  {
    id: "cam-03",
    name: "คลังสินค้า",
    location: "โกดัง C",
    zone: "คลัง",
    status: "online",
    stream_url: "/streams/cam-03",
    ai_models: ["helmet", "restricted"],
  },
  {
    id: "cam-04",
    name: "โรงงานสายการผลิต",
    location: "โรงงาน D สาย 2",
    zone: "ผลิต",
    status: "online",
    stream_url: "/streams/cam-04",
    ai_models: ["helmet", "fall"],
  },
  {
    id: "cam-05",
    name: "ลานจอดรถหนัก",
    location: "ลานจอดด้านหลัง",
    zone: "ยานยนต์",
    status: "degraded",
    stream_url: "/streams/cam-05",
    ai_models: ["restricted"],
  },
  {
    id: "cam-06",
    name: "ห้องเครื่องจักร",
    location: "อาคาร E ชั้นใต้ดิน",
    zone: "เครื่องจักร",
    status: "online",
    stream_url: "/streams/cam-06",
    ai_models: ["helmet", "fall", "restricted"],
  },
];

async function initDatabase(db) {
  await dbRun(db, "PRAGMA foreign_keys = ON");
  await dbRun(db, "PRAGMA journal_mode = WAL");

  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'supervisor', 'operator')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  await dbRun(
    db,
    `CREATE TABLE IF NOT EXISTS safety_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT NOT NULL,
      camera_name TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'acknowledged', 'resolved')),
      confidence REAL NOT NULL DEFAULT 0.9,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const userCount = await dbGet(db, "SELECT COUNT(*) AS count FROM users");
  if (userCount.count === 0) {
    const seeds = [
      {
        username: "admin",
        email: "admin@safetysight.local",
        password: "Admin123!",
        full_name: "ผู้ดูแลระบบ",
        role: "admin",
      },
      {
        username: "supervisor",
        email: "supervisor@safetysight.local",
        password: "Super123!",
        full_name: "หัวหน้าความปลอดภัย",
        role: "supervisor",
      },
      {
        username: "operator",
        email: "operator@safetysight.local",
        password: "Oper123!",
        full_name: "เจ้าหน้าที่เฝ้าระวัง",
        role: "operator",
      },
    ];

    for (const seed of seeds) {
      const hash = await bcrypt.hash(seed.password, BCRYPT_ROUNDS);
      await dbRun(
        db,
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES (?, ?, ?, ?, ?)`,
        [seed.username, seed.email, hash, seed.full_name, seed.role]
      );
    }
  }

  const alertCount = await dbGet(db, "SELECT COUNT(*) AS count FROM safety_alerts");
  if (alertCount.count === 0) {
    const sampleAlerts = [
      ["cam-02", "พื้นที่ก่อสร้าง", "helmet", "high", "ตรวจพบคนงานไม่สวมหมวกนิรภัย", "ไซต์งาน โซน B", "open", 0.94],
      ["cam-04", "โรงงานสายการผลิต", "fall", "critical", "ตรวจพบเหตุล้มที่สายการผลิต", "โรงงาน D สาย 2", "open", 0.97],
      ["cam-01", "ประตูทางเข้าหลัก", "restricted", "medium", "บุคลากรเข้าพื้นที่หวงห้ามโดยไม่มีสิทธิ์", "อาคาร A ชั้น 1", "acknowledged", 0.88],
      ["cam-06", "ห้องเครื่องจักร", "helmet", "high", "ช่างซ่อมไม่สวมหมวกนิรภัยใกล้เครื่องจักร", "อาคาร E ชั้นใต้ดิน", "open", 0.91],
      ["cam-03", "คลังสินค้า", "restricted", "low", "รถโฟล์คลิฟต์เข้าโซนคนเดิน", "โกดัง C", "resolved", 0.82],
      ["cam-02", "พื้นที่ก่อสร้าง", "fall", "critical", "คนงานล้มจากนั่งร้านชั้น 2", "ไซต์งาน โซน B", "acknowledged", 0.96],
      ["cam-05", "ลานจอดรถหนัก", "restricted", "medium", "บุคคลภายนอกเข้าลานจอดรถหนัก", "ลานจอดด้านหลัง", "open", 0.79],
      ["cam-04", "โรงงานสายการผลิต", "helmet", "high", "พนักงานเดินในโซนเครื่องจักรโดยไม่สวมหมวก", "โรงงาน D สาย 2", "open", 0.93],
    ];

    for (const alert of sampleAlerts) {
      await dbRun(
        db,
        `INSERT INTO safety_alerts
          (camera_id, camera_name, alert_type, severity, description, location, status, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
        [...alert, `-${Math.floor(Math.random() * 180)} minutes`]
      );
    }
  }
}

function createAuthMiddleware(db) {
  return asyncHandler(async (req, res, next) => {
    const token = parseBearer(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ success: false, message: "ต้องเข้าสู่ระบบก่อนใช้งาน" });
    }
    if (tokenBlacklist.has(token)) {
      return res.status(401).json({ success: false, message: "โทเคนถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่" });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (_err) {
      return res.status(401).json({ success: false, message: "โทเคนไม่ถูกต้องหรือหมดอายุ" });
    }

    const user = await dbGet(db, "SELECT * FROM users WHERE id = ?", [payload.sub]);
    if (!user || !user.is_active) {
      return res.status(401).json({ success: false, message: "บัญชีผู้ใช้ไม่พร้อมใช้งาน" });
    }

    req.token = token;
    req.user = sanitizeUser(user);
    next();
  });
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ดำเนินการนี้" });
    }
    next();
  };
}

function validateUsername(name) {
  return typeof name === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(name);
}

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

async function start() {
  const dataDir = path.dirname(DB_PATH);
  fs.mkdirSync(dataDir, { recursive: true });

  const db = new sqlite3.Database(DB_PATH);
  await initDatabase(db);

  const app = express();
  const auth = createAuthMiddleware(db);

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/health", (_req, res) => {
    res.json({
      success: true,
      service: "AI Safety Sight",
      status: "ok",
      time: new Date().toISOString(),
    });
  });

  app.post(
    "/api/register",
    asyncHandler(async (req, res) => {
      const username = String(req.body.username || "").trim();
      const email = String(req.body.email || "").trim();
      const fullName = String(req.body.full_name || req.body.fullName || "").trim();
      const password = String(req.body.password || "");
      const requestedRole = String(req.body.role || "operator").trim();
      const role = ["admin", "supervisor", "operator"].includes(requestedRole)
        ? requestedRole
        : "operator";

      if (!validateUsername(username)) {
        return res.status(400).json({
          success: false,
          message: "ชื่อผู้ใช้ต้องมี 3-32 ตัวอักษร และใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง",
        });
      }
      if (!validateEmail(email)) {
        return res.status(400).json({ success: false, message: "รูปแบบอีเมลไม่ถูกต้อง" });
      }
      if (!fullName || fullName.length < 2) {
        return res.status(400).json({ success: false, message: "กรุณากรอกชื่อ-นามสกุล" });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ success: false, message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
      }

      const existing = await dbGet(
        db,
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE",
        [username, email]
      );
      if (existing) {
        return res.status(409).json({ success: false, message: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว" });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const result = await dbRun(
        db,
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES (?, ?, ?, ?, ?)`,
        [username, email, passwordHash, fullName, role]
      );

      const user = sanitizeUser(
        await dbGet(db, "SELECT * FROM users WHERE id = ?", [result.lastID])
      );
      const token = signToken(user);

      res.status(201).json({
        success: true,
        message: "สมัครสมาชิกสำเร็จ",
        token,
        user,
      });
    })
  );

  app.post(
    "/api/login",
    asyncHandler(async (req, res) => {
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");

      if (!username || !password) {
        return res.status(400).json({ success: false, message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
      }

      const row = await dbGet(
        db,
        "SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE",
        [username, username]
      );
      if (!row) {
        return res.status(401).json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      }
      if (!row.is_active) {
        return res.status(403).json({ success: false, message: "บัญชีนี้ถูกระงับการใช้งาน" });
      }

      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
      }

      const user = sanitizeUser(row);
      const token = signToken(user);
      res.json({
        success: true,
        message: "เข้าสู่ระบบสำเร็จ",
        token,
        user,
      });
    })
  );

  app.post(
    "/api/logout",
    auth,
    asyncHandler(async (req, res) => {
      tokenBlacklist.add(req.token);
      res.json({ success: true, message: "ออกจากระบบสำเร็จ" });
    })
  );

  app.post(
    "/api/change-password",
    auth,
    asyncHandler(async (req, res) => {
      const currentPassword = String(req.body.current_password || req.body.currentPassword || "");
      const newPassword = String(req.body.new_password || req.body.newPassword || "");

      if (!validatePassword(newPassword)) {
        return res.status(400).json({ success: false, message: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร" });
      }

      const row = await dbGet(db, "SELECT * FROM users WHERE id = ?", [req.user.id]);
      const ok = await bcrypt.compare(currentPassword, row.password_hash);
      if (!ok) {
        return res.status(400).json({ success: false, message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
      }

      const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await dbRun(
        db,
        "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
        [hash, req.user.id]
      );

      res.json({ success: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" });
    })
  );

  app.get(
    "/api/me",
    auth,
    asyncHandler(async (req, res) => {
      const row = await dbGet(db, "SELECT * FROM users WHERE id = ?", [req.user.id]);
      res.json({ success: true, user: sanitizeUser(row) });
    })
  );

  app.get(
    "/api/check-username/:name",
    asyncHandler(async (req, res) => {
      const name = String(req.params.name || "").trim();
      if (!validateUsername(name)) {
        return res.json({
          success: true,
          available: false,
          valid: false,
          message: "รูปแบบชื่อผู้ใช้ไม่ถูกต้อง",
        });
      }

      const existing = await dbGet(
        db,
        "SELECT id FROM users WHERE username = ? COLLATE NOCASE",
        [name]
      );
      res.json({
        success: true,
        available: !existing,
        valid: true,
        message: existing ? "ชื่อผู้ใช้นี้ถูกใช้แล้ว" : "ชื่อผู้ใช้นี้พร้อมใช้งาน",
      });
    })
  );

  app.get(
    "/api/users",
    auth,
    requireRoles("admin", "supervisor"),
    asyncHandler(async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
      const offset = (page - 1) * limit;
      const q = String(req.query.q || "").trim();

      let where = "1=1";
      const params = [];
      if (q) {
        where += " AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)";
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const totalRow = await dbGet(db, `SELECT COUNT(*) AS count FROM users WHERE ${where}`, params);
      const rows = await dbAll(
        db,
        `SELECT * FROM users WHERE ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      res.json({
        success: true,
        page,
        limit,
        total: totalRow.count,
        total_pages: Math.max(1, Math.ceil(totalRow.count / limit)),
        users: rows.map(sanitizeUser),
      });
    })
  );

  app.get(
    "/api/users/:id",
    auth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "รหัสผู้ใช้ไม่ถูกต้อง" });
      }

      if (req.user.role === "operator" && req.user.id !== id) {
        return res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ดูข้อมูลผู้ใช้อื่น" });
      }

      const row = await dbGet(db, "SELECT * FROM users WHERE id = ?", [id]);
      if (!row) {
        return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
      }
      res.json({ success: true, user: sanitizeUser(row) });
    })
  );

  app.put(
    "/api/users/:id",
    auth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "รหัสผู้ใช้ไม่ถูกต้อง" });
      }

      const existing = await dbGet(db, "SELECT * FROM users WHERE id = ?", [id]);
      if (!existing) {
        return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
      }

      const isSelf = req.user.id === id;
      const isAdmin = req.user.role === "admin";
      if (!isSelf && !isAdmin) {
        return res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์แก้ไขผู้ใช้นี้" });
      }

      const nextUsername =
        req.body.username !== undefined ? String(req.body.username).trim() : existing.username;
      const nextEmail =
        req.body.email !== undefined ? String(req.body.email).trim() : existing.email;
      const nextFullName =
        req.body.full_name !== undefined || req.body.fullName !== undefined
          ? String(req.body.full_name || req.body.fullName).trim()
          : existing.full_name;

      let nextRole = existing.role;
      let nextActive = existing.is_active;
      if (isAdmin) {
        if (req.body.role !== undefined) {
          const role = String(req.body.role).trim();
          if (!["admin", "supervisor", "operator"].includes(role)) {
            return res.status(400).json({ success: false, message: "บทบาทไม่ถูกต้อง" });
          }
          nextRole = role;
        }
        if (req.body.is_active !== undefined || req.body.isActive !== undefined) {
          nextActive = req.body.is_active === false || req.body.isActive === false ? 0 : 1;
        }
      }

      if (!validateUsername(nextUsername)) {
        return res.status(400).json({ success: false, message: "รูปแบบชื่อผู้ใช้ไม่ถูกต้อง" });
      }
      if (!validateEmail(nextEmail)) {
        return res.status(400).json({ success: false, message: "รูปแบบอีเมลไม่ถูกต้อง" });
      }
      if (!nextFullName || nextFullName.length < 2) {
        return res.status(400).json({ success: false, message: "กรุณากรอกชื่อ-นามสกุล" });
      }

      const conflict = await dbGet(
        db,
        `SELECT id FROM users
         WHERE id != ? AND (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE)`,
        [id, nextUsername, nextEmail]
      );
      if (conflict) {
        return res.status(409).json({ success: false, message: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้แล้ว" });
      }

      if (isAdmin && existing.role === "admin" && nextRole !== "admin") {
        const adminCount = await dbGet(
          db,
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1"
        );
        if (adminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            message: "ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี",
          });
        }
      }

      await dbRun(
        db,
        `UPDATE users
         SET username = ?, email = ?, full_name = ?, role = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [nextUsername, nextEmail, nextFullName, nextRole, nextActive, id]
      );

      const updated = sanitizeUser(await dbGet(db, "SELECT * FROM users WHERE id = ?", [id]));
      res.json({ success: true, message: "อัปเดตผู้ใช้สำเร็จ", user: updated });
    })
  );

  app.delete(
    "/api/users/:id",
    auth,
    requireRoles("admin"),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, message: "รหัสผู้ใช้ไม่ถูกต้อง" });
      }
      if (req.user.id === id) {
        return res.status(400).json({ success: false, message: "ไม่สามารถลบบัญชีของตนเองได้" });
      }

      const existing = await dbGet(db, "SELECT * FROM users WHERE id = ?", [id]);
      if (!existing) {
        return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
      }

      if (existing.role === "admin") {
        const adminCount = await dbGet(
          db,
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1"
        );
        if (adminCount.count <= 1) {
          return res.status(400).json({
            success: false,
            message: "ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้",
          });
        }
      }

      await dbRun(db, "DELETE FROM users WHERE id = ?", [id]);
      res.json({ success: true, message: "ลบผู้ใช้สำเร็จ" });
    })
  );

  app.get(
    "/api/cameras",
    auth,
    asyncHandler(async (_req, res) => {
      res.json({
        success: true,
        cameras: CAMERAS,
        generated_at: new Date().toISOString(),
      });
    })
  );

  app.get(
    "/api/alerts",
    auth,
    asyncHandler(async (req, res) => {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;
      const status = String(req.query.status || "").trim();
      const type = String(req.query.type || req.query.alert_type || "").trim();
      const cameraId = String(req.query.camera_id || "").trim();

      let where = "1=1";
      const params = [];
      if (status) {
        where += " AND status = ?";
        params.push(status);
      }
      if (type) {
        where += " AND alert_type = ?";
        params.push(type);
      }
      if (cameraId) {
        where += " AND camera_id = ?";
        params.push(cameraId);
      }

      const totalRow = await dbGet(
        db,
        `SELECT COUNT(*) AS count FROM safety_alerts WHERE ${where}`,
        params
      );
      const rows = await dbAll(
        db,
        `SELECT * FROM safety_alerts WHERE ${where} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      res.json({
        success: true,
        page,
        limit,
        total: totalRow.count,
        total_pages: Math.max(1, Math.ceil(totalRow.count / limit)),
        alerts: rows,
      });
    })
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ success: false, message: "ไม่พบ API ที่ร้องขอ" });
    }
    res.sendFile(path.join(__dirname, "public", "index.html"), (err) => {
      if (err) next(err);
    });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Safety Sight listening on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start AI Safety Sight:", err);
  process.exit(1);
});
