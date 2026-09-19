import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound, conflict } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { invalidatePlcs } from "../services/plcCache.js";
import { invalidateSensors } from "../services/sensorCache.js";

export const router = Router();

function validatePatch(body, { partial }) {
  const patch = {};

  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("ต้องระบุชื่อ PLC");
    patch.name = name;
  }
  if (!partial || "host" in body) {
    const host = String(body.host ?? "").trim();
    if (!host) throw badRequest("ต้องระบุ IP หรือ hostname ของ PLC");
    patch.host = host;
  }
  if (!partial || "port" in body) {
    const port = Number(body.port ?? 502);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest("port ต้องเป็นจำนวนเต็ม 1–65535");
    patch.port = port;
  }
  if (!partial || "poll_sec" in body) {
    const pollSec = Number(body.poll_sec ?? 1);
    if (!Number.isInteger(pollSec) || pollSec < 1 || pollSec > 3600) throw badRequest("ความถี่การอ่านต้องเป็นจำนวนเต็ม 1–3600 วินาที");
    patch.poll_sec = pollSec;
  }
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  if ("sort_order" in body) patch.sort_order = body.sort_order === null ? null : Number(body.sort_order);

  return patch;
}

router.get(
  "/api/plcs",
  requireRole("staff"),
  wrap(async (req, res) => {
    const plcs = await many(`SELECT * FROM plcs ORDER BY sort_order, id`);
    res.json({ plcs });
  })
);

router.post(
  "/api/plcs",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const patch = validatePatch(req.body ?? {}, { partial: false });

    const clash = await one(`SELECT id, name FROM plcs WHERE host=$1 AND port=$2`, [patch.host, patch.port]);
    if (clash) throw conflict(`มี PLC "${clash.name}" ใช้ ${patch.host}:${patch.port} อยู่แล้ว`);

    const created = await one(
      `INSERT INTO plcs (name, host, port, poll_sec, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [patch.name, patch.host, patch.port, patch.poll_sec ?? 1, patch.is_active ?? true, patch.sort_order ?? null]
    );

    invalidatePlcs();
    await audit(req, { action: "plc.create", target: `plc:${created.id}`, newValue: created });
    res.json({ ok: true, plc: created });
  })
);

router.put(
  "/api/plcs/:id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const before = await one(`SELECT * FROM plcs WHERE id=$1`, [id]);
    if (!before) throw notFound("ไม่พบ PLC นี้");

    const patch = validatePatch(req.body ?? {}, { partial: true });
    if (!Object.keys(patch).length) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    if (patch.host || patch.port) {
      const host = patch.host ?? before.host;
      const port = patch.port ?? before.port;
      const clash = await one(`SELECT id, name FROM plcs WHERE host=$1 AND port=$2 AND id<>$3`, [host, port, id]);
      if (clash) throw conflict(`มี PLC "${clash.name}" ใช้ ${host}:${port} อยู่แล้ว`);
    }

    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE plcs SET ${sets} WHERE id = $1`, [id, ...cols.map((c) => patch[c])]);

    invalidatePlcs();
    invalidateSensors(); // sensor listing joins pond info เท่านั้น แต่ modbus poller อ่าน plc จาก cache แยก ให้ sync กันไว้
    await audit(req, {
      action: "plc.update",
      target: `plc:${id}`,
      oldValue: Object.fromEntries(cols.map((c) => [c, before[c]])),
      newValue: patch,
    });

    const after = await one(`SELECT * FROM plcs WHERE id=$1`, [id]);
    res.json({ ok: true, plc: after });
  })
);

router.delete(
  "/api/plcs/:id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const before = await one(`SELECT * FROM plcs WHERE id=$1`, [id]);
    if (!before) throw notFound("ไม่พบ PLC นี้");

    const inUse = await many(`SELECT tag FROM sensors WHERE plc_id=$1`, [id]);
    if (inUse.length) {
      throw conflict(`ลบไม่ได้ — มีจุดวัดผูกกับ PLC นี้อยู่ ${inUse.length} จุด (${inUse.map((s) => s.tag).join(", ")})`);
    }

    await query(`DELETE FROM plcs WHERE id=$1`, [id]);
    invalidatePlcs();
    await audit(req, { action: "plc.delete", target: `plc:${id}`, oldValue: before });
    res.json({ ok: true });
  })
);
