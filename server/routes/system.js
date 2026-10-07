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
import { status as mongoStatus } from "../services/mongoPoller.js";
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
  // ตาราง layout ของหน้า Dashboard (12 คอลัมน์) — null = กลับไปใช้ layout เริ่มต้น
  "dashboard.layout": (v) => {
    if (v === null) return null;
    if (!v || !Array.isArray(v.items)) throw badRequest("รูปแบบ layout ไม่ถูกต้อง");
    if (v.items.length > 80) throw badRequest("วางบล็อกได้ไม่เกิน 80 บล็อก");
    const TYPES = ["diagram", "tank", "bar", "dial", "value", "chart", "alarms"];
    const int = (n, lo, hi, label) => {
      const x = Number(n);
      if (!Number.isInteger(x) || x < lo || x > hi) throw badRequest(`ค่า ${label} ของบล็อกต้องเป็นจำนวนเต็ม ${lo}–${hi}`);
      return x;
    };
    const str = (s, max) => (s == null || s === "" ? undefined : String(s).trim().slice(0, max) || undefined);
    const hex = (c) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);
    const ids = new Set();
    const items = v.items.map((it) => {
      if (!TYPES.includes(it?.type)) throw badRequest(`ไม่รู้จักบล็อกชนิด ${it?.type}`);
      const id = str(it.id, 40);
      if (!id || ids.has(id)) throw badRequest("รหัสบล็อกว่างหรือซ้ำกัน");
      ids.add(id);
      const w = int(it.w, 1, 12, "ความกว้าง");
      const x = int(it.x, 0, 12 - w, "ตำแหน่งแนวนอน");
      return {
        id,
        type: it.type,
        x,
        y: int(it.y, 0, 1000, "ตำแหน่งแนวตั้ง"),
        w,
        h: int(it.h, 1, 40, "ความสูง"),
        tag: str(it.tag, 40),
        pond: str(it.pond, 20),
        series: str(it.series, 40),
        title: str(it.title, 60),
        titleSize: it.titleSize == null || it.titleSize === "" ? undefined : int(it.titleSize, 8, 72, "ขนาดตัวอักษรหัวบล็อก"),
        titleBold: typeof it.titleBold === "boolean" ? it.titleBold : undefined,
        hidden: it.hidden === true ? true : undefined,
        titleColor: hex(it.titleColor),
        valueColor: hex(it.valueColor),
        valueSize: it.valueSize == null || it.valueSize === "" ? undefined : int(it.valueSize, 6, 300, "ขนาดตัวเลข"),
        valueBold: typeof it.valueBold === "boolean" ? it.valueBold : undefined,
      };
    });
    if (items.filter((i) => i.type === "diagram").length > 1) throw badRequest("ผังบ่อวางได้บล็อกเดียว");
    if (items.filter((i) => i.type === "alarms").length > 1) throw badRequest("บันทึกการแจ้งเตือนวางได้บล็อกเดียว");
    return { items };
  },
  // ผังบ่อที่แอดมินจัดเอง (แคนวาส 1120 × 684) — null = กลับไปใช้ผังเริ่มต้น
  "dashboard.diagram": (v) => {
    if (v === null) return null;
    if (!v || !Array.isArray(v.items) || !Array.isArray(v.pipes)) throw badRequest("รูปแบบผังบ่อไม่ถูกต้อง");
    if (v.items.length > 200 || v.pipes.length > 200) throw badRequest("ผังบ่อมีชิ้นหรือเส้นท่อได้ไม่เกิน 200");
    const KINDS = ["tank", "equip", "softener", "tap", "dial", "bar"];
    const num = (n, lo, hi) => {
      const x = Number(n);
      if (!Number.isFinite(x)) throw badRequest("ตำแหน่งหรือขนาดในผังต้องเป็นตัวเลข");
      return Math.max(lo, Math.min(hi, Math.round(x)));
    };
    const str = (s, max) => (s == null || s === "" ? undefined : String(s).trim().slice(0, max) || undefined);
    const color = (c) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);
    const ids = new Set();
    const uniqueId = (id) => {
      const s = str(id, 40);
      if (!s || ids.has(s)) throw badRequest("รหัสชิ้นในผังว่างหรือซ้ำกัน");
      ids.add(s);
      return s;
    };
    const items = v.items.map((it) => {
      if (!KINDS.includes(it?.kind)) throw badRequest(`ไม่รู้จักชิ้นในผังชนิด ${it?.kind}`);
      const out = {
        id: uniqueId(it.id),
        kind: it.kind,
        x: num(it.x, -1120, 2240),
        y: num(it.y, -684, 1368),
        w: num(it.w, 10, 1120),
      };
      if (it.hidden === true) out.hidden = true;
      if (["tank", "equip", "softener"].includes(it.kind)) out.h = num(it.h, 10, 684);
      if (it.kind === "tank") out.pond = str(it.pond, 20);
      // ข้อความหลายบรรทัดได้ (เก็บ \n ไว้) และขนาดตัวอักษรที่ตั้งเอง (ไม่ตั้ง = ย่อ/ขยายตามขนาดชิ้น)
      if (["tank", "equip", "softener", "tap"].includes(it.kind)) {
        out.label = str(it.label, 60);
        if (it.fontSize != null && it.fontSize !== "") out.fontSize = num(it.fontSize, 6, 120);
        if (typeof it.bold === "boolean") out.bold = it.bold;
        out.textColor = color(it.textColor);
      }
      // รูปแบบตัวเลขค่าที่อ่านได้จากสัญญาณ
      if (["tank", "tap", "dial", "bar"].includes(it.kind)) {
        if (it.valueSize != null && it.valueSize !== "") out.valueSize = num(it.valueSize, 6, 300);
        if (typeof it.valueBold === "boolean") out.valueBold = it.valueBold;
        out.valueColor = color(it.valueColor);
      }
      if (["tap", "dial", "bar"].includes(it.kind)) out.tag = str(it.tag, 40);
      out.color = color(it.color);
      return out;
    });
    const pipes = v.pipes.map((p) => {
      if (!Array.isArray(p?.pts) || p.pts.length < 2 || p.pts.length > 60) throw badRequest("เส้นท่อต้องมี 2–60 จุด");
      return {
        id: uniqueId(p.id),
        style: p.style === "dashed" ? "dashed" : "flow",
        hidden: p.hidden === true ? true : undefined,
        pts: p.pts.map((pt) => [num(pt?.[0], -1120, 2240), num(pt?.[1], -684, 1368)]),
      };
    });
    return { items, pipes };
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
        mongo: {
          accounts: mongoStatus.accounts,
          watchers: mongoStatus.watchers,
          connected: mongoStatus.accounts.some((a) => a.connected),
          lastError: mongoStatus.lastError,
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
    // แบ่งหน้า — production จริงมีแนวโน้มมีหลายพันแถว ไม่ส่งทั้งหมดมาในเรียกเดียว
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const offset = (page - 1) * limit;
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
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await one(`SELECT count(*)::int AS n FROM audit_log a ${whereSql}`, params)).n;
    params.push(limit, offset);
    const rows = await many(
      `SELECT a.*, e.full_name FROM audit_log a
         LEFT JOIN employees e ON e.emp_code = a.emp_code
        ${whereSql}
        ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ entries: rows, total, page, limit });
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
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const page = Math.max(1, Number(req.query.page ?? 1));
    const offset = (page - 1) * limit;
    const total = (await one(`SELECT count(*)::int AS n FROM notification_log`)).n;
    const rows = await many(
      `SELECT n.*, e.full_name, a.tag, a.severity, a.condition
         FROM notification_log n
         LEFT JOIN employees e ON e.emp_code = n.emp_code
         LEFT JOIN alarms a ON a.id = n.alarm_id
        ORDER BY n.sent_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ log: rows, total, page, limit });
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
