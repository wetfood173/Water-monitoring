import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound, conflict } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { invalidateMongoAccounts } from "../services/mongoAccountCache.js";
import { invalidateSensors } from "../services/sensorCache.js";
import { invalidateMongoClient, testConnect } from "../services/mongoClient.js";
import { syncMongoPoller } from "../services/mongoPoller.js";

export const router = Router();

// uri มี credential ฝังอยู่ จึงไม่คืนค่านี้กลับไปที่หน้าเว็บ (ไม่ใส่ใน SELECT/response/audit log)
const PUBLIC_COLS = "id, name, is_active, sort_order";

function validatePatch(body, { partial }) {
  const patch = {};

  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("ต้องระบุชื่อบัญชี MongoDB");
    patch.name = name;
  }
  if (!partial || "uri" in body) {
    const uri = String(body.uri ?? "").trim();
    if (!uri) throw badRequest("ต้องระบุ connection string (URI)");
    if (!/^mongodb(\+srv)?:\/\//.test(uri)) throw badRequest("URI ต้องขึ้นต้นด้วย mongodb:// หรือ mongodb+srv://");
    patch.uri = uri;
  }
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  if ("sort_order" in body) patch.sort_order = body.sort_order === null ? null : Number(body.sort_order);

  return patch;
}

router.get(
  "/api/mongo-accounts",
  requireRole("staff"),
  wrap(async (req, res) => {
    const accounts = await many(`SELECT ${PUBLIC_COLS} FROM mongo_accounts ORDER BY sort_order, id`);
    res.json({ accounts });
  })
);

/** ทดสอบเชื่อมต่อด้วย URI ที่กรอกในฟอร์ม ก่อนกดบันทึกจริง — ไม่บันทึกอะไรลงฐานข้อมูล */
router.post(
  "/api/mongo-accounts/test-connect",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const uri = String(req.body?.uri ?? "").trim();
    if (!uri) throw badRequest("ต้องระบุ connection string (URI)");
    try {
      const result = await testConnect(uri);
      res.json(result);
    } catch (err) {
      throw badRequest(err.message);
    }
  })
);

router.post(
  "/api/mongo-accounts",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const patch = validatePatch(req.body ?? {}, { partial: false });
    const created = await one(
      `INSERT INTO mongo_accounts (name, uri, is_active, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING ${PUBLIC_COLS}`,
      [patch.name, patch.uri, patch.is_active ?? true, patch.sort_order ?? null]
    );

    invalidateMongoAccounts();
    await syncMongoPoller();
    await audit(req, { action: "mongo_account.create", target: `mongo_account:${created.id}`, newValue: { name: created.name } });
    res.json({ ok: true, account: created });
  })
);

router.put(
  "/api/mongo-accounts/:id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const before = await one(`SELECT ${PUBLIC_COLS} FROM mongo_accounts WHERE id=$1`, [id]);
    if (!before) throw notFound("ไม่พบบัญชี MongoDB นี้");

    const patch = validatePatch(req.body ?? {}, { partial: true });
    if (!Object.keys(patch).length) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE mongo_accounts SET ${sets} WHERE id = $1`, [id, ...cols.map((c) => patch[c])]);

    if (patch.uri) invalidateMongoClient(id); // URI เปลี่ยน ต้องทิ้งการเชื่อมต่อเดิมแล้วต่อใหม่
    invalidateMongoAccounts();
    invalidateSensors(); // sensor listing ไม่ได้ join บัญชีนี้ แต่ mongo poller อ่านจาก cache แยก ให้ sync กันไว้
    await syncMongoPoller();

    const auditCols = cols.filter((c) => c !== "uri"); // ไม่ log ค่า uri (มี credential ฝังอยู่)
    await audit(req, {
      action: "mongo_account.update",
      target: `mongo_account:${id}`,
      oldValue: Object.fromEntries(auditCols.map((c) => [c, before[c]])),
      newValue: Object.fromEntries(auditCols.map((c) => [c, patch[c]])),
    });

    const after = await one(`SELECT ${PUBLIC_COLS} FROM mongo_accounts WHERE id=$1`, [id]);
    res.json({ ok: true, account: after });
  })
);

router.delete(
  "/api/mongo-accounts/:id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const before = await one(`SELECT ${PUBLIC_COLS} FROM mongo_accounts WHERE id=$1`, [id]);
    if (!before) throw notFound("ไม่พบบัญชี MongoDB นี้");

    const inUse = await many(`SELECT tag FROM sensors WHERE mongo_account_id=$1`, [id]);
    if (inUse.length) {
      throw conflict(`ลบไม่ได้ — มีจุดวัดผูกกับบัญชีนี้อยู่ ${inUse.length} จุด (${inUse.map((s) => s.tag).join(", ")})`);
    }

    await query(`DELETE FROM mongo_accounts WHERE id=$1`, [id]);
    invalidateMongoClient(id);
    invalidateMongoAccounts();
    await audit(req, { action: "mongo_account.delete", target: `mongo_account:${id}`, oldValue: before });
    res.json({ ok: true });
  })
);
