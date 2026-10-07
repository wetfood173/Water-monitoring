import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound, conflict } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { invalidateSensors, activeSensors } from "../services/sensorCache.js";
import { resetDebounce } from "../services/alarmEngine.js";
import { DATA_TYPES } from "../services/modbusClient.js";
import { status as modbusStatus, planBlocks, testRead } from "../services/modbusPoller.js";
import { status as mongoStatus } from "../services/mongoPoller.js";
import { testMongoRead } from "../services/mongoClient.js";
import { getSetting } from "../lib/settings.js";

export const router = Router();

router.get(
  "/api/sensors",
  requireRole("staff"),
  wrap(async (req, res) => {
    const sensors = await many(
      `SELECT s.*, p.name AS pond_name, p.capacity_m3,
              pl.name AS plc_name, pl.host AS plc_host, pl.port AS plc_port,
              ma.name AS mongo_account_name
         FROM sensors s
         LEFT JOIN ponds p ON p.pond_id = s.pond_id
         LEFT JOIN plcs pl ON pl.id = s.plc_id
         LEFT JOIN mongo_accounts ma ON ma.id = s.mongo_account_id
        ORDER BY s.sort_order, s.tag`
    );
    const ponds = await many(`SELECT * FROM ponds ORDER BY sort_order`);
    const plcs = await many(`SELECT * FROM plcs ORDER BY sort_order, id`);
    // uri มี credential ฝังอยู่ จึงไม่ส่งกลับไปที่หน้าเว็บ (ดู server/routes/mongoAccounts.js)
    const mongoAccounts = await many(`SELECT id, name, is_active, sort_order FROM mongo_accounts ORDER BY sort_order, id`);
    const dashboardCards = await getSetting("dashboard.visible_cards");
    const dashboardHiddenTags = await getSetting("dashboard.hidden_tags");
    const dashboardLayout = await getSetting("dashboard.layout");
    const dashboardDiagram = await getSetting("dashboard.diagram");
    // ให้หน้า "ประวัติย้อนหลัง" รู้ว่าข้อมูลดิบเก็บย้อนหลังได้กี่วัน จะได้จำกัดตัวเลือกช่วงวันที่กำหนดเองไม่ให้เกิน
    const retentionRawDays = await getSetting("retention.raw_days");
    res.json({ sensors, ponds, plcs, mongoAccounts, dashboardCards, dashboardHiddenTags, dashboardLayout, dashboardDiagram, retentionRawDays });
  })
);

const NUM_FIELDS = ["range_min", "range_max", "ll", "hh", "ll_critical", "hh_critical"];

/* แก้ค่า LL/HH และพิสัยเครื่องมือวัด — engineer ขึ้นไป (ข้อ 4, 8) */
router.put(
  "/api/sensors/:tag/setpoints",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const tag = String(req.params.tag);
    const before = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    if (!before) throw notFound("ไม่พบจุดวัดนี้");

    const patch = {};
    for (const f of NUM_FIELDS) {
      if (!(f in req.body)) continue;
      const raw = req.body[f];
      if (raw === null || raw === "") {
        patch[f] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`ค่า ${f} ต้องเป็นตัวเลข`);
      patch[f] = n;
    }
    if ("debounce_sec" in req.body) {
      const n = Number(req.body.debounce_sec);
      if (!Number.isInteger(n) || n < 0 || n > 3600) {
        throw badRequest("หน่วงเวลาต้องเป็นจำนวนเต็ม 0–3600 วินาที");
      }
      patch.debounce_sec = n;
    }
    if ("is_active" in req.body) patch.is_active = Boolean(req.body.is_active);
    if (!Object.keys(patch).length) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    const next = { ...before, ...patch };
    // ตรวจว่าอยู่ในพิสัยก่อน เพื่อให้ข้อความบอกสาเหตุที่ตรงที่สุดเมื่อกรอกค่าเกินพิสัย
    const min = next.range_min == null ? null : Number(next.range_min);
    const max = next.range_max == null ? null : Number(next.range_max);
    if (min != null && max != null && min >= max) {
      throw badRequest("พิสัยต่ำสุดต้องน้อยกว่าพิสัยสูงสุด");
    }
    for (const [field, label] of [["ll", "LL"], ["hh", "HH"], ["ll_critical", "LL วิกฤต"], ["hh_critical", "HH วิกฤต"]]) {
      if (next[field] == null) continue;
      const v = Number(next[field]);
      if ((min != null && v < min) || (max != null && v > max)) {
        throw badRequest(`ค่า ${label} ต้องอยู่ในพิสัยของเครื่องมือวัด (${min}–${max})`);
      }
    }
    if (next.ll != null && next.hh != null && Number(next.ll) >= Number(next.hh)) {
      throw badRequest("ค่า LL ต้องน้อยกว่า HH");
    }
    if (next.ll_critical != null && next.ll != null && Number(next.ll_critical) > Number(next.ll)) {
      throw badRequest("ค่า LL วิกฤตต้องไม่สูงกว่า LL");
    }
    if (next.hh_critical != null && next.hh != null && Number(next.hh_critical) < Number(next.hh)) {
      throw badRequest("ค่า HH วิกฤตต้องไม่ต่ำกว่า HH");
    }

    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE sensors SET ${sets} WHERE tag = $1`, [tag, ...cols.map((c) => patch[c])]);

    invalidateSensors();
    resetDebounce(tag);

    const changedBefore = Object.fromEntries(cols.map((c) => [c, before[c]]));
    await audit(req, {
      action: "setpoint.change",
      target: `sensor:${tag}`,
      oldValue: changedBefore,
      newValue: patch,
    });

    const after = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    res.json({ ok: true, sensor: after });
  })
);

/* ================= การตั้งค่า Modbus ต่อจุดวัด ================= */

/** สถานะการเชื่อมต่อ PLC และแผนการอ่าน register */
router.get(
  "/api/modbus/status",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const plcs = await many(`SELECT id, name FROM plcs`);
    const plcName = new Map(plcs.map((p) => [p.id, p.name]));
    const blocks = planBlocks(await activeSensors()).map((b) => ({
      plcId: b.plcId,
      plcName: plcName.get(b.plcId) ?? `PLC #${b.plcId}`,
      unitId: b.unitId,
      fc: b.fc,
      address: b.address,
      quantity: b.quantity,
      tags: b.points.map((p) => p.tag),
    }));
    res.json({ status: modbusStatus, blocks });
  })
);

/** ทดสอบอ่านค่าจาก address ที่กรอก โดยไม่บันทึกลงฐานข้อมูล */
router.post(
  "/api/modbus/test-read",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const plcId = Number(req.body?.plc_id);
    if (!Number.isInteger(plcId)) throw badRequest("ยังไม่ได้เลือก PLC");
    const address = Number(req.body?.address);
    if (!Number.isInteger(address) || address < 0 || address > 65535) {
      throw badRequest("address ต้องเป็นจำนวนเต็ม 0–65535");
    }
    const quantity = Number(req.body?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 125) {
      throw badRequest("จำนวน register ที่อ่านได้ครั้งละ 1–125");
    }
    const result = await testRead({
      plcId,
      address,
      quantity,
      unitId: Number(req.body?.unit_id ?? 1),
      fc: Number(req.body?.fc ?? 3),
      dataType: String(req.body?.data_type ?? "uint16"),
      wordSwap: Boolean(req.body?.word_swap),
    });
    const scale = Number(req.body?.scale ?? 1);
    const offset = Number(req.body?.offset ?? 0);
    res.json({ ...result, scaled: result.raw * scale + offset });
  })
);

/** สถานะการอ่านจาก MongoDB — เหมือน /api/modbus/status ของฝั่ง PLC */
router.get(
  "/api/mongo/status",
  requireRole("engineer"),
  wrap(async (req, res) => {
    res.json({ status: mongoStatus });
  })
);

/** ทดสอบอ่านค่าจาก MongoDB database/collection ที่กรอก โดยไม่บันทึกลงฐานข้อมูล */
router.post(
  "/api/mongo/test-read",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const accountId = Number(req.body?.account_id);
    if (!Number.isInteger(accountId)) throw badRequest("ยังไม่ได้เลือกบัญชี MongoDB");
    const db = String(req.body?.db ?? "").trim();
    const collection = String(req.body?.collection ?? "").trim();
    if (!db || !collection) throw badRequest("ต้องระบุทั้ง database และ collection");
    try {
      const result = await testMongoRead(accountId, db, collection);
      res.json(result);
    } catch (err) {
      throw badRequest(err.message);
    }
  })
);

/* ================= จัดการบ่อ (เพิ่ม/แก้/ลบ) — engineer ขึ้นไป ================= */

function validatePondPatch(body, { partial }) {
  const patch = {};
  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("ต้องระบุชื่อบ่อ");
    patch.name = name;
  }
  if (!partial || "capacity_m3" in body) {
    const raw = body.capacity_m3;
    if (raw === null || raw === "" || raw === undefined) {
      patch.capacity_m3 = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) throw badRequest("ความจุต้องเป็นตัวเลขมากกว่า 0");
      patch.capacity_m3 = n;
    }
  }
  if ("sort_order" in body) patch.sort_order = body.sort_order === null ? null : Number(body.sort_order);
  if ("is_active" in body) patch.is_active = Boolean(body.is_active);
  return patch;
}

router.post(
  "/api/ponds",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const pond_id = String(req.body?.pond_id ?? "").trim();
    if (!pond_id || pond_id.length > 8) throw badRequest("รหัสบ่อห้ามว่างและยาวไม่เกิน 8 ตัวอักษร");
    const existing = await one(`SELECT pond_id FROM ponds WHERE pond_id=$1`, [pond_id]);
    if (existing) throw conflict(`มีบ่อรหัส ${pond_id} อยู่แล้ว`);

    const patch = validatePondPatch(req.body ?? {}, { partial: false });
    const created = await one(
      `INSERT INTO ponds (pond_id, name, capacity_m3, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [pond_id, patch.name, patch.capacity_m3, patch.sort_order ?? null]
    );

    invalidateSensors();
    await audit(req, { action: "pond.create", target: `pond:${pond_id}`, newValue: created });
    res.json({ ok: true, pond: created });
  })
);

router.put(
  "/api/ponds/:pond_id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const pond_id = String(req.params.pond_id);
    const before = await one(`SELECT * FROM ponds WHERE pond_id=$1`, [pond_id]);
    if (!before) throw notFound("ไม่พบบ่อนี้");

    const patch = validatePondPatch(req.body ?? {}, { partial: true });

    let newId = pond_id;
    if ("pond_id" in (req.body ?? {}) && String(req.body.pond_id).trim() !== pond_id) {
      newId = String(req.body.pond_id).trim();
      if (!newId || newId.length > 8) throw badRequest("รหัสบ่อห้ามว่างและยาวไม่เกิน 8 ตัวอักษร");
      const clash = await one(`SELECT pond_id FROM ponds WHERE pond_id=$1`, [newId]);
      if (clash) throw conflict(`มีบ่อรหัส ${newId} อยู่แล้ว`);
      const inUse = await many(`SELECT tag FROM sensors WHERE pond_id=$1`, [pond_id]);
      if (inUse.length) {
        throw conflict(`เปลี่ยนรหัสบ่อไม่ได้ — มีจุดวัดผูกอยู่ ${inUse.length} จุด (${inUse.map((s) => s.tag).join(", ")}) ย้ายออกก่อน`);
      }
    }

    if (!Object.keys(patch).length && newId === pond_id) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    if (newId !== pond_id) await query(`UPDATE ponds SET pond_id=$2 WHERE pond_id=$1`, [pond_id, newId]);
    if (Object.keys(patch).length) {
      const cols = Object.keys(patch);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await query(`UPDATE ponds SET ${sets} WHERE pond_id = $1`, [newId, ...cols.map((c) => patch[c])]);
    }

    invalidateSensors();
    await audit(req, {
      action: "pond.update",
      target: `pond:${pond_id}`,
      oldValue: { pond_id, ...Object.fromEntries(Object.keys(patch).map((c) => [c, before[c]])) },
      newValue: { pond_id: newId, ...patch },
    });

    const after = await one(`SELECT * FROM ponds WHERE pond_id=$1`, [newId]);
    res.json({ ok: true, pond: after });
  })
);

router.delete(
  "/api/ponds/:pond_id",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const pond_id = String(req.params.pond_id);
    const before = await one(`SELECT * FROM ponds WHERE pond_id=$1`, [pond_id]);
    if (!before) throw notFound("ไม่พบบ่อนี้");

    const inUse = await many(`SELECT tag FROM sensors WHERE pond_id=$1`, [pond_id]);
    if (inUse.length) {
      throw conflict(`ลบไม่ได้ — มีจุดวัดผูกอยู่ ${inUse.length} จุด (${inUse.map((s) => s.tag).join(", ")})`);
    }

    await query(`DELETE FROM ponds WHERE pond_id=$1`, [pond_id]);
    invalidateSensors();
    await audit(req, { action: "pond.delete", target: `pond:${pond_id}`, oldValue: before });
    res.json({ ok: true });
  })
);

/* ================= จัดการจุดวัด (เพิ่ม/แก้ข้อมูลทั่วไป/ลบ) — engineer ขึ้นไป =================
 * รหัสย่อ (tag) เปลี่ยนได้เฉพาะตอนที่ยังไม่มีข้อมูลย้อนหลัง (ค่าที่อ่านได้/แจ้งเตือน) ผูกอยู่
 * เพื่อกันไม่ให้ประวัติเก่าอ้างอิงรหัสที่ไม่มีอยู่จริง — ถ้ามีข้อมูลแล้วต้องลบจุดวัดนี้แล้วเพิ่มใหม่แทน
 */

const TAG_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** มีค่าที่อ่านได้จริงบันทึกไว้หรือไม่ (ไม่นับแจ้งเตือน "ขาดสัญญาณ" ที่ alarm engine สร้างเองอัตโนมัติ
    ให้ทุกจุดวัดที่ยังไม่ได้ตั้งแหล่งข้อมูล — นับแบบนั้นจะทำให้จุดวัดที่เพิ่งสร้างแล้วยังไม่ทันตั้งค่า ลบ/เปลี่ยนรหัสไม่ได้ทันที) */
async function tagHasReadings(tag) {
  const row = await one(
    `SELECT 1 AS x FROM readings WHERE tag=$1
     UNION ALL SELECT 1 FROM readings_hourly WHERE tag=$1
     LIMIT 1`,
    [tag]
  );
  return Boolean(row);
}

/** ลบแจ้งเตือน (และ log การแจ้งเตือนที่อ้างถึง) ของจุดวัดนี้ทิ้ง — ใช้ก่อนลบ/เปลี่ยนรหัสย่อ
    เมื่อไม่มีค่าที่อ่านได้จริงแล้ว (เหลือแค่แจ้งเตือน "ขาดสัญญาณ" อัตโนมัติซึ่งไม่มีความหมายอีกต่อไป) */
async function clearSensorAlarms(tag) {
  await query(`DELETE FROM notification_log WHERE alarm_id IN (SELECT id FROM alarms WHERE tag=$1)`, [tag]);
  await query(`DELETE FROM alarms WHERE tag=$1`, [tag]);
}

router.post(
  "/api/sensors",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const tag = String(req.body?.tag ?? "").trim().toUpperCase();
    if (!TAG_RE.test(tag)) throw badRequest("รหัสย่อต้องเป็นตัวอักษร/ตัวเลข/-/_ ยาวไม่เกิน 20 ตัว");
    const existing = await one(`SELECT tag FROM sensors WHERE tag=$1`, [tag]);
    if (existing) throw conflict(`มีจุดวัดรหัส ${tag} อยู่แล้ว`);

    const name = String(req.body?.name ?? "").trim();
    if (!name) throw badRequest("ต้องระบุชื่อจุดวัด");
    const metric = String(req.body?.metric ?? "").trim();
    if (!metric) throw badRequest("ต้องระบุประเภทค่าที่วัด");
    const unit = String(req.body?.unit ?? "").trim();
    if (!unit) throw badRequest("ต้องระบุหน่วย");

    let pond_id = req.body?.pond_id ? String(req.body.pond_id).trim() : null;
    if (pond_id) {
      const pond = await one(`SELECT pond_id FROM ponds WHERE pond_id=$1`, [pond_id]);
      if (!pond) throw badRequest("ไม่พบบ่อที่เลือก");
    }

    const decimals = Number(req.body?.decimals ?? 1);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) throw badRequest("ทศนิยมต้องเป็นจำนวนเต็ม 0–6");

    const created = await one(
      `INSERT INTO sensors (tag, pond_id, name, metric, unit, decimals, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tag, pond_id, name, metric, unit, decimals, req.body?.sort_order ?? null]
    );

    invalidateSensors();
    await audit(req, { action: "sensor.create", target: `sensor:${tag}`, newValue: { tag, name, metric, unit, pond_id } });
    res.json({ ok: true, sensor: created });
  })
);

/** แก้ข้อมูลทั่วไป (ชื่อ, บ่อ, ประเภทค่า, หน่วย, ทศนิยม, ลำดับ) และเปลี่ยนรหัสย่อ (tag) ได้ถ้ายังไม่มีข้อมูลย้อนหลัง */
router.put(
  "/api/sensors/:tag/info",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const tag = String(req.params.tag);
    const before = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    if (!before) throw notFound("ไม่พบจุดวัดนี้");

    const patch = {};
    if ("name" in req.body) {
      const v = String(req.body.name ?? "").trim();
      if (!v) throw badRequest("ต้องระบุชื่อจุดวัด");
      patch.name = v;
    }
    if ("metric" in req.body) {
      const v = String(req.body.metric ?? "").trim();
      if (!v) throw badRequest("ต้องระบุประเภทค่าที่วัด");
      patch.metric = v;
    }
    if ("unit" in req.body) {
      const v = String(req.body.unit ?? "").trim();
      if (!v) throw badRequest("ต้องระบุหน่วย");
      patch.unit = v;
    }
    if ("decimals" in req.body) {
      const n = Number(req.body.decimals);
      if (!Number.isInteger(n) || n < 0 || n > 6) throw badRequest("ทศนิยมต้องเป็นจำนวนเต็ม 0–6");
      patch.decimals = n;
    }
    if ("sort_order" in req.body) patch.sort_order = req.body.sort_order === null ? null : Number(req.body.sort_order);
    if ("pond_id" in req.body) {
      const v = req.body.pond_id ? String(req.body.pond_id).trim() : null;
      if (v) {
        const pond = await one(`SELECT pond_id FROM ponds WHERE pond_id=$1`, [v]);
        if (!pond) throw badRequest("ไม่พบบ่อที่เลือก");
      }
      patch.pond_id = v;
    }

    let newTag = tag;
    if ("tag" in req.body && String(req.body.tag).trim().toUpperCase() !== tag) {
      newTag = String(req.body.tag).trim().toUpperCase();
      if (!TAG_RE.test(newTag)) throw badRequest("รหัสย่อต้องเป็นตัวอักษร/ตัวเลข/-/_ ยาวไม่เกิน 20 ตัว");
      const clash = await one(`SELECT tag FROM sensors WHERE tag=$1`, [newTag]);
      if (clash) throw conflict(`มีจุดวัดรหัส ${newTag} อยู่แล้ว`);
      if (await tagHasReadings(tag)) {
        throw conflict("เปลี่ยนรหัสย่อไม่ได้ — มีค่าที่อ่านได้ย้อนหลังผูกกับจุดวัดนี้อยู่แล้ว");
      }
      await clearSensorAlarms(tag); // เหลือแค่แจ้งเตือน "ขาดสัญญาณ" อัตโนมัติ ไม่มีความหมายต่อหลังเปลี่ยนรหัส
    }

    if (!Object.keys(patch).length && newTag === tag) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    if (newTag !== tag) await query(`UPDATE sensors SET tag=$2 WHERE tag=$1`, [tag, newTag]);
    if (Object.keys(patch).length) {
      const cols = Object.keys(patch);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await query(`UPDATE sensors SET ${sets} WHERE tag = $1`, [newTag, ...cols.map((c) => patch[c])]);
    }

    invalidateSensors();
    await audit(req, {
      action: "sensor.info.change",
      target: `sensor:${tag}`,
      oldValue: { tag, ...Object.fromEntries(Object.keys(patch).map((c) => [c, before[c]])) },
      newValue: { tag: newTag, ...patch },
    });

    const after = await one(`SELECT * FROM sensors WHERE tag=$1`, [newTag]);
    res.json({ ok: true, sensor: after });
  })
);

router.delete(
  "/api/sensors/:tag",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const tag = String(req.params.tag);
    const before = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    if (!before) throw notFound("ไม่พบจุดวัดนี้");

    if (await tagHasReadings(tag)) {
      throw conflict("ลบไม่ได้ — มีค่าที่อ่านได้ย้อนหลังผูกกับจุดวัดนี้อยู่แล้ว");
    }
    await clearSensorAlarms(tag); // เหลือแค่แจ้งเตือน "ขาดสัญญาณ" อัตโนมัติ ไม่มีความหมายต่อหลังลบจุดวัด

    await query(`DELETE FROM sensors WHERE tag=$1`, [tag]);
    invalidateSensors();
    await audit(req, { action: "sensor.delete", target: `sensor:${tag}`, oldValue: before });
    res.json({ ok: true });
  })
);

router.put(
  "/api/sensors/:tag/modbus",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const tag = String(req.params.tag);
    const before = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    if (!before) throw notFound("ไม่พบจุดวัดนี้");

    const DATA_SOURCES = ["modbus", "mongodb"];
    const patch = {};
    if ("data_source" in req.body) {
      const t = String(req.body.data_source);
      if (!DATA_SOURCES.includes(t)) throw badRequest(`แหล่งข้อมูลต้องเป็น ${DATA_SOURCES.join(", ")}`);
      patch.data_source = t;
      // สลับไปแหล่งอื่นแล้วต้องเลิกผูก PLC ทันที กัน poller อ่านซ้ำซ้อนกับแหล่งใหม่
      if (t !== "modbus") {
        patch.plc_id = null;
        patch.modbus_address = null;
      }
    }
    // สลับไปแหล่งอื่นแล้ว plc_id/modbus_address ถูกบังคับเป็น null ไว้ข้างบนแล้ว ไม่ต้องอ่านค่าจาก body ซ้ำ
    const switchingAwayFromModbus = patch.data_source && patch.data_source !== "modbus";
    if (!switchingAwayFromModbus && "plc_id" in req.body) {
      const raw = req.body.plc_id;
      if (raw === null || raw === "") {
        patch.plc_id = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n)) throw badRequest("plc_id ไม่ถูกต้อง");
        const plc = await one(`SELECT id FROM plcs WHERE id=$1`, [n]);
        if (!plc) throw badRequest("ไม่พบ PLC ที่เลือก");
        patch.plc_id = n;
      }
    }
    if (!switchingAwayFromModbus && "modbus_address" in req.body) {
      const raw = req.body.modbus_address;
      if (raw === null || raw === "") {
        patch.modbus_address = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 65535) {
          throw badRequest("address ต้องเป็นจำนวนเต็ม 0–65535");
        }
        patch.modbus_address = n;
      }
    }
    if ("modbus_unit_id" in req.body) {
      const n = Number(req.body.modbus_unit_id);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw badRequest("Unit-Id ต้องอยู่ระหว่าง 0–255");
      patch.modbus_unit_id = n;
    }
    if ("modbus_fc" in req.body) {
      const n = Number(req.body.modbus_fc);
      if (n !== 3 && n !== 4) throw badRequest("รองรับเฉพาะ FC3 (holding) และ FC4 (input)");
      patch.modbus_fc = n;
    }
    if ("modbus_data_type" in req.body) {
      const t = String(req.body.modbus_data_type);
      if (!DATA_TYPES.includes(t)) throw badRequest(`ชนิดข้อมูลต้องเป็น ${DATA_TYPES.join(", ")}`);
      patch.modbus_data_type = t;
    }
    for (const field of ["modbus_scale", "modbus_offset"]) {
      if (!(field in req.body)) continue;
      const n = Number(req.body[field]);
      if (!Number.isFinite(n)) throw badRequest(`ค่า ${field} ต้องเป็นตัวเลข`);
      patch[field] = n;
    }
    if ("modbus_word_swap" in req.body) patch.modbus_word_swap = Boolean(req.body.modbus_word_swap);
    if ("mongo_account_id" in req.body) {
      const raw = req.body.mongo_account_id;
      if (raw === null || raw === "") {
        patch.mongo_account_id = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n)) throw badRequest("บัญชี MongoDB ไม่ถูกต้อง");
        const account = await one(`SELECT id FROM mongo_accounts WHERE id=$1`, [n]);
        if (!account) throw badRequest("ไม่พบบัญชี MongoDB ที่เลือก");
        patch.mongo_account_id = n;
      }
    }
    if ("mongo_db" in req.body) {
      const v = String(req.body.mongo_db ?? "").trim();
      patch.mongo_db = v || null;
    }
    if ("mongo_collection" in req.body) {
      const v = String(req.body.mongo_collection ?? "").trim();
      patch.mongo_collection = v || null;
    }
    if ("mongo_poll_sec" in req.body) {
      const n = Number(req.body.mongo_poll_sec);
      if (!Number.isInteger(n) || n < 1 || n > 3600) {
        throw badRequest("ดึงข้อมูลทุกกี่วินาทีต้องเป็นจำนวนเต็ม 1–3600");
      }
      patch.mongo_poll_sec = n;
    }
    if (!Object.keys(patch).length) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    if (patch.modbus_scale === 0) throw badRequest("scale เป็น 0 จะทำให้ทุกค่ากลายเป็น 0");

    // address ซ้ำกันได้ในทางเทคนิคถ้าอยู่คนละ PLC แต่ถ้าอยู่ PLC เดียวกันมักเป็นการกรอกผิด จึงเตือนไว้
    let warning = null;
    const nextPlcId = "plc_id" in patch ? patch.plc_id : before.plc_id;
    if (patch.modbus_address != null && nextPlcId != null) {
      const clash = await one(
        `SELECT tag FROM sensors
          WHERE tag <> $1 AND plc_id = $2 AND modbus_address = $3
            AND modbus_unit_id = $4 AND modbus_fc = $5`,
        [
          tag,
          nextPlcId,
          patch.modbus_address,
          patch.modbus_unit_id ?? before.modbus_unit_id,
          patch.modbus_fc ?? before.modbus_fc,
        ]
      );
      if (clash) warning = `address นี้ตรงกับจุดวัด ${clash.tag} ใน PLC เดียวกันอยู่แล้ว`;
    }

    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE sensors SET ${sets} WHERE tag = $1`, [tag, ...cols.map((c) => patch[c])]);

    invalidateSensors();
    resetDebounce(tag);
    await audit(req, {
      action: "modbus.change",
      target: `sensor:${tag}`,
      oldValue: Object.fromEntries(cols.map((c) => [c, before[c]])),
      newValue: patch,
    });

    const after = await one(`SELECT * FROM sensors WHERE tag=$1`, [tag]);
    res.json({ ok: true, sensor: after, warning });
  })
);
