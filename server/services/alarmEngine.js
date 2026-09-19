import { query, one, many } from "../db/index.js";
import { getSetting } from "../lib/settings.js";
import { activeSensors, getSensor } from "./sensorCache.js";
import { notifyAlarm } from "./notifier.js";

/**
 * ตรรกะแจ้งเตือนตามข้อ 5.2
 *   - เทียบค่ากับ LL/HH และระดับวิกฤต
 *   - หน่วงเวลา (debounce) ค่าต้องหลุดช่วงต่อเนื่องตาม debounce_sec จึงจะสร้างแจ้งเตือน
 *   - ไม่ส่งซ้ำ: หนึ่ง tag+condition มีแจ้งเตือนที่ยังไม่คืนสภาพได้ครั้งละหนึ่งรายการ
 *   - ส่งข้อความปิดเรื่องเมื่อค่ากลับเข้าช่วง
 */

const SEVERITY_OF = {
  HH: "warning",
  LL: "warning",
  HH_CRIT: "critical",
  LL_CRIT: "critical",
  NO_SIGNAL: "critical",
};

// สถานะ debounce ต่อ tag — อยู่ในหน่วยความจำเพราะเป็นสถานะชั่วคราวระหว่างการวัด
const pending = new Map();

function classify(sensor, value) {
  const n = Number(value);
  if (sensor.hh_critical != null && n >= Number(sensor.hh_critical)) {
    return { condition: "HH_CRIT", threshold: Number(sensor.hh_critical) };
  }
  if (sensor.ll_critical != null && n <= Number(sensor.ll_critical)) {
    return { condition: "LL_CRIT", threshold: Number(sensor.ll_critical) };
  }
  if (sensor.hh != null && n >= Number(sensor.hh)) {
    return { condition: "HH", threshold: Number(sensor.hh) };
  }
  if (sensor.ll != null && n <= Number(sensor.ll)) {
    return { condition: "LL", threshold: Number(sensor.ll) };
  }
  return { condition: null, threshold: null };
}

async function openAlarm(tag, condition, triggerValue, threshold, ts) {
  const row = await one(
    `INSERT INTO alarms (tag, severity, condition, trigger_value, threshold, raised_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tag, condition) WHERE cleared_at IS NULL DO NOTHING
     RETURNING id`,
    [tag, SEVERITY_OF[condition], condition, triggerValue, threshold, ts]
  );
  return row?.id ?? null;
}

async function clearAlarms(tag, { except = null, at = new Date() } = {}) {
  const rows = await many(
    `UPDATE alarms SET cleared_at = $2
      WHERE tag = $1 AND cleared_at IS NULL
        AND ($3::text IS NULL OR condition <> $3)
      RETURNING id`,
    [tag, at, except]
  );
  return rows.map((r) => r.id);
}

/**
 * ประเมินค่าที่วัดได้หนึ่งจุด
 * quality = 0 (ค่าที่น่าสงสัย) จะไม่นำมาสร้างแจ้งเตือน เพื่อไม่ให้เกิดแจ้งเตือนลวง (ข้อ 9)
 */
export async function evaluate(tag, value, ts, quality = 1) {
  const sensor = await getSensor(tag);
  if (!sensor || !sensor.is_active) return;

  // ค่าใหม่เข้ามาแล้ว → ปิดแจ้งเตือนขาดสัญญาณถ้ามีค้างอยู่
  const clearedNoSignal = await clearAlarmsByCondition(tag, "NO_SIGNAL", ts);
  for (const id of clearedNoSignal) notifyAlarm(id, "clear").catch(logNotifyError);

  if (quality === 0) return;

  const { condition, threshold } = classify(sensor, value);
  const now = new Date(ts).getTime();
  const state = pending.get(tag);

  if (!condition) {
    pending.delete(tag);
    const cleared = await clearAlarms(tag, { at: ts });
    for (const id of cleared) notifyAlarm(id, "clear").catch(logNotifyError);
    return;
  }

  if (!state || state.condition !== condition) {
    // เริ่มจับเวลาหน่วงใหม่เมื่อเงื่อนไขเปลี่ยน
    pending.set(tag, { condition, since: now, value, threshold });
    return;
  }

  state.value = value;
  const debounceMs = (sensor.debounce_sec ?? 60) * 1000;
  if (now - state.since < debounceMs) return;

  // ยืนยันแล้ว: ปิดแจ้งเตือนเงื่อนไขอื่นของ tag เดียวกัน แล้วเปิดรายการใหม่ถ้ายังไม่มี
  const cleared = await clearAlarms(tag, { except: condition, at: ts });
  for (const id of cleared) notifyAlarm(id, "clear").catch(logNotifyError);

  const id = await openAlarm(tag, condition, value, threshold, ts);
  if (id) notifyAlarm(id, "raise").catch(logNotifyError);
}

async function clearAlarmsByCondition(tag, condition, at) {
  const rows = await many(
    `UPDATE alarms SET cleared_at = $3
      WHERE tag = $1 AND condition = $2 AND cleared_at IS NULL
      RETURNING id`,
    [tag, condition, at]
  );
  return rows.map((r) => r.id);
}

function logNotifyError(err) {
  console.error("[alarm] ส่งแจ้งเตือนไม่สำเร็จ:", err.message);
}

const bootedAt = Date.now();

/** ไม่มีข้อมูลใหม่เกินเวลาที่กำหนด → แจ้งเตือน NO_SIGNAL ระดับ critical (ข้อ 5.2, 9) */
export async function checkNoSignal() {
  const limitSec = (await getSetting("alarm.no_signal_sec")) ?? 300;
  // หลังรีสตาร์ต ต้องรอให้ gateway มีโอกาสส่งค่าครบรอบก่อน
  // ไม่อย่างนั้นจะเกิดแจ้งเตือนขาดสัญญาณลวงทุกครั้งที่เริ่มระบบ
  if (Date.now() - bootedAt < limitSec * 1000) return;
  const sensors = await activeSensors();
  // ห้ามสแกนทั้งตาราง readings (หลักล้านแถว) — ใช้ LATERAL ดึงแถวล่าสุดทีละ tag ผ่านดัชนี (tag, ts) แทน
  const latest = await many(
    `SELECT s.tag, r.ts
       FROM sensors s
       LEFT JOIN LATERAL (
         SELECT ts FROM readings WHERE tag = s.tag ORDER BY ts DESC LIMIT 1
       ) r ON true
      WHERE s.is_active`
  );
  const lastByTag = new Map(latest.filter((r) => r.ts).map((r) => [r.tag, new Date(r.ts).getTime()]));
  const now = Date.now();

  for (const s of sensors) {
    const last = lastByTag.get(s.tag);
    const stale = last === undefined || now - last > limitSec * 1000;
    if (!stale) continue;
    const id = await openAlarm(s.tag, "NO_SIGNAL", null, null, new Date());
    if (!id) continue;

    // เมื่ออ่านค่าไม่ได้แล้ว แจ้งเตือนที่อิงค่าล่าสุดของจุดวัดนี้เชื่อถือไม่ได้อีกต่อไป
    // ปิดทิ้งโดยไม่ส่งข้อความ "กลับสู่ปกติ" เพราะค่าไม่ได้กลับเข้าช่วง เพียงแต่วัดไม่ได้
    await clearAlarms(s.tag, { except: "NO_SIGNAL" });
    notifyAlarm(id, "raise").catch(logNotifyError);
  }
}

/** ส่งข้อความย้ำทุก N นาที หากแจ้งเตือนยังไม่มีใครรับทราบ (ข้อ 5.2) */
export async function repeatUnacked() {
  const minutes = (await getSetting("notify.repeat_minutes")) ?? 30;
  const rows = await many(
    `SELECT id FROM alarms
      WHERE cleared_at IS NULL AND acked_at IS NULL
        AND last_notified_at IS NOT NULL
        AND last_notified_at < now() - ($1 || ' minutes')::interval`,
    [String(minutes)]
  );
  for (const { id } of rows) {
    await notifyAlarm(id, "repeat").catch(logNotifyError);
  }
  return rows.length;
}

/** โหลดสถานะ debounce ใหม่หลังแก้ setpoint เพื่อให้ประเมินด้วยค่าใหม่ทันที */
export function resetDebounce(tag = null) {
  if (tag) pending.delete(tag);
  else pending.clear();
}

export async function openAlarmCount() {
  const row = await one(
    `SELECT count(*) FILTER (WHERE acked_at IS NULL)::int AS unacked,
            count(*)::int AS open
       FROM alarms WHERE cleared_at IS NULL`
  );
  return row ?? { unacked: 0, open: 0 };
}
