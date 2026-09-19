import path from "node:path";
import { Router } from "express";
import { many, one } from "../db/index.js";
import { wrap, badRequest, notFound } from "../lib/http.js";
import { requireAdmin, requireRole, ROLE_RANK } from "../middleware/auth.js";
import { getPublicSettings, getSetting, setSetting } from "../lib/settings.js";
import { audit } from "../lib/audit.js";
import { config, lineLoginEnabled, lineMessagingEnabled } from "../config.js";
import { backend } from "../db/index.js";
import { status as modbusStatus } from "../services/modbusPoller.js";
import { runBackup, listBackups, BACKUP_DIR } from "../services/backup.js";

export const router = Router();

const EDITABLE = {
  "notify.recipients": (v) => {
    if (!v || typeof v !== "object") throw badRequest("รูปแบบผู้รับแจ้งเตือนไม่ถูกต้อง");
    for (const sev of ["warning", "critical"]) {
      const rule = v[sev];
      if (!rule || !Array.isArray(rule.roles) || !rule.roles.length) {
        throw badRequest(`ต้องระบุระดับสิทธิ์ผู้รับของ ${sev} อย่างน้อยหนึ่งระดับ`);
      }
      for (const r of rule.roles) if (!(r in ROLE_RANK)) throw badRequest(`ระดับสิทธิ์ ${r} ไม่ถูกต้อง`);
      if (rule.departments !== "all" && rule.departments !== "related" && !Array.isArray(rule.departments)) {
        throw badRequest("หน่วยงานผู้รับต้องเป็น all, related หรือรายการหน่วยงาน");
      }
    }
    return v;
  },
  "notify.repeat_minutes": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 5 || n > 1440) throw badRequest("ระยะส่งซ้ำต้องอยู่ระหว่าง 5–1440 นาที");
    return n;
  },
  "notify.quiet_hours": (v) => {
    if (!v || typeof v !== "object") throw badRequest("รูปแบบช่วงเวลางดแจ้งเตือนไม่ถูกต้อง");
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!re.test(v.from ?? "") || !re.test(v.to ?? "")) throw badRequest("เวลาต้องอยู่ในรูปแบบ HH:MM");
    return { enabled: Boolean(v.enabled), from: v.from, to: v.to };
  },
  "alarm.no_signal_sec": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 30 || n > 86400) throw badRequest("เวลาขาดสัญญาณต้องอยู่ระหว่าง 30–86400 วินาที");
    return n;
  },
  "retention.raw_months": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 120) throw badRequest("ระยะเก็บข้อมูลดิบต้องอยู่ระหว่าง 1–120 เดือน");
    return n;
  },
  "retention.raw_days": (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 3650) throw badRequest("ระยะเก็บข้อมูลดิบต้องอยู่ระหว่าง 0–3650 วัน (0 = ปิด)");
    return n;
  },
  "dashboard.visible_cards": (v) => {
    if (!v || typeof v !== "object") throw badRequest("รูปแบบการตั้งค่าการ์ดไม่ถูกต้อง");
    const known = ["diagram", "instruments", "chart", "alarms"];
    const out = {};
    for (const k of known) out[k] = Boolean(v[k] ?? true);
    return out;
  },
  "dashboard.hidden_tags": (v) => {
    if (!Array.isArray(v)) throw badRequest("รูปแบบรายการเครื่องมือวัดที่ซ่อนไม่ถูกต้อง");
    const tags = v.map((t) => String(t).trim()).filter(Boolean);
    return [...new Set(tags)];
  },
};

router.get(
  "/api/system/settings",
  requireAdmin,
  wrap(async (req, res) => {
    res.json({
      settings: await getPublicSettings(),
      status: {
        backend,
        lineLogin: lineLoginEnabled,
        lineMessaging: lineMessagingEnabled,
        simulate: config.simulate,
        devLogin: config.devLogin,
        addFriendUrl: config.line.addFriendUrl,
        modbus: {
          enabled: modbusStatus.enabled,
          plcs: modbusStatus.plcs,
          connected: modbusStatus.plcs.some((p) => p.connected),
          mappedTags: modbusStatus.mappedTags,
          lastOkAt: modbusStatus.plcs.reduce((max, p) => (p.lastOkAt && (!max || p.lastOkAt > max) ? p.lastOkAt : max), null),
          lastError: modbusStatus.lastError,
        },
      },
    });
  })
);

router.put(
  "/api/system/settings/:key",
  requireAdmin,
  wrap(async (req, res) => {
    const key = String(req.params.key);
    const validate = EDITABLE[key];
    if (!validate) throw badRequest("ค่าตั้งนี้แก้ไขจากหน้าจอไม่ได้");
    const value = validate(req.body?.value);
    const before = await getSetting(key);
    await setSetting(key, value, req.user.emp_code);
    await audit(req, { action: "setting.change", target: key, oldValue: before, newValue: value });
    res.json({ ok: true, key, value });
  })
);

router.get(
  "/api/system/audit",
  requireAdmin,
  wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
    const params = [];
    const where = [];
    if (req.query.action) {
      params.push(`${String(req.query.action)}%`);
      where.push(`a.action LIKE $${params.length}`);
    }
    if (req.query.emp_code) {
      params.push(String(req.query.emp_code));
      where.push(`a.emp_code = $${params.length}`);
    }
    params.push(limit);
    const rows = await many(
      `SELECT a.*, e.full_name FROM audit_log a
         LEFT JOIN employees e ON e.emp_code = a.emp_code
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ entries: rows });
  })
);

/* ================= สำรองข้อมูล (Product.md ข้อ 7) ================= */

router.get(
  "/api/system/backups",
  requireAdmin,
  wrap(async (req, res) => {
    res.json({ backups: await listBackups(), supported: backend === "pglite" });
  })
);

router.post(
  "/api/system/backups",
  requireAdmin,
  wrap(async (req, res) => {
    const name = await runBackup();
    if (!name) throw badRequest(`ยังไม่รองรับการสำรองข้อมูลอัตโนมัติสำหรับฐานข้อมูล ${backend}`);
    await audit(req, { action: "backup.create", target: name });
    res.json({ ok: true, name });
  })
);

// ชื่อไฟล์มาจากรายการที่ listBackups() สร้างให้เท่านั้น (backup-YYYYMMDD-HHMMSS.tar.gz) ป้องกัน path traversal
const BACKUP_NAME_RE = /^backup-\d{8}-\d{6}\.tar\.gz$/;

router.get(
  "/api/system/backups/:name",
  requireAdmin,
  wrap(async (req, res, next) => {
    const name = String(req.params.name);
    if (!BACKUP_NAME_RE.test(name)) throw badRequest("ชื่อไฟล์ไม่ถูกต้อง");
    const full = path.join(BACKUP_DIR, name);
    res.download(full, name, (err) => {
      if (err && !res.headersSent) next(notFound("ไม่พบไฟล์สำรองนี้"));
    });
  })
);

router.get(
  "/api/system/notifications",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const rows = await many(
      `SELECT n.*, e.full_name, a.tag, a.severity, a.condition
         FROM notification_log n
         LEFT JOIN employees e ON e.emp_code = n.emp_code
         LEFT JOIN alarms a ON a.id = n.alarm_id
        ORDER BY n.sent_at DESC LIMIT 200`
    );
    res.json({ log: rows });
  })
);

router.get(
  "/api/system/health",
  wrap(async (req, res) => {
    const latest = await one(`SELECT max(ts) AS ts FROM readings`);
    res.json({
      ok: true,
      backend,
      lastReadingAt: latest?.ts ?? null,
      time: new Date().toISOString(),
    });
  })
);
