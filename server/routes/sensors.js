import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { invalidateSensors, activeSensors } from "../services/sensorCache.js";
import { resetDebounce } from "../services/alarmEngine.js";
import { DATA_TYPES } from "../services/modbusClient.js";
import { status as modbusStatus, planBlocks, testRead } from "../services/modbusPoller.js";
import { testMongoRead } from "../services/mongoClient.js";
import { getSetting } from "../lib/settings.js";

export const router = Router();

router.get(
  "/api/sensors",
  requireRole("staff"),
  wrap(async (req, res) => {
    const sensors = await many(
      `SELECT s.*, p.name AS pond_name, p.capacity_m3,
              pl.name AS plc_name, pl.host AS plc_host, pl.port AS plc_port
         FROM sensors s
         LEFT JOIN ponds p ON p.pond_id = s.pond_id
         LEFT JOIN plcs pl ON pl.id = s.plc_id
        ORDER BY s.sort_order, s.tag`
    );
    const ponds = await many(`SELECT * FROM ponds ORDER BY sort_order`);
    const plcs = await many(`SELECT * FROM plcs ORDER BY sort_order, id`);
    const dashboardCards = await getSetting("dashboard.visible_cards");
    const dashboardHiddenTags = await getSetting("dashboard.hidden_tags");
    // ให้หน้า "ประวัติย้อนหลัง" รู้ว่าข้อมูลดิบเก็บย้อนหลังได้กี่วัน จะได้จำกัดตัวเลือกช่วงวันที่กำหนดเองไม่ให้เกิน
    const retentionRawDays = await getSetting("retention.raw_days");
    res.json({ sensors, ponds, plcs, dashboardCards, dashboardHiddenTags, retentionRawDays });
  })
);

const NUM_FIELDS = ["ll", "hh", "ll_critical", "hh_critical"];

/* แก้ค่า LL/HH — engineer ขึ้นไป (ข้อ 4, 8) */
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

/** ทดสอบอ่านค่าจาก MongoDB database/collection ที่กรอก โดยไม่บันทึกลงฐานข้อมูล */
router.post(
  "/api/mongo/test-read",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const db = String(req.body?.db ?? "").trim();
    const collection = String(req.body?.collection ?? "").trim();
    if (!db || !collection) throw badRequest("ต้องระบุทั้ง database และ collection");
    try {
      const result = await testMongoRead(db, collection);
      res.json(result);
    } catch (err) {
      throw badRequest(err.message);
    }
  })
);

/* แก้ความจุบ่อ — engineer ขึ้นไป (ไม่มีหน้าจอแก้ค่านี้มาก่อน ตั้งได้แค่ตอน seed) */
router.put(
  "/api/ponds/:pond_id/capacity",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const pond_id = String(req.params.pond_id);
    const before = await one(`SELECT * FROM ponds WHERE pond_id=$1`, [pond_id]);
    if (!before) throw notFound("ไม่พบบ่อนี้");

    const n = Number(req.body?.capacity_m3);
    if (!Number.isFinite(n) || n <= 0) throw badRequest("ความจุต้องเป็นตัวเลขมากกว่า 0");

    await query(`UPDATE ponds SET capacity_m3=$1 WHERE pond_id=$2`, [n, pond_id]);
    invalidateSensors();
    await audit(req, {
      action: "pond.capacity.change",
      target: `pond:${pond_id}`,
      oldValue: before.capacity_m3,
      newValue: n,
    });

    const after = await one(`SELECT * FROM ponds WHERE pond_id=$1`, [pond_id]);
    res.json({ ok: true, pond: after });
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
