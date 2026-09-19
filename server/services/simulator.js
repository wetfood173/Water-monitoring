import { config } from "../config.js";
import { many } from "../db/index.js";
import { activeSensors } from "./sensorCache.js";
import { ingest } from "./ingest.js";

/**
 * ตัวสร้างค่าจำลองแทน PLC gateway สำหรับตอนพัฒนา
 * เดินค่าแบบ random walk ในช่วงใช้งานของแต่ละจุดวัด
 * ปิดด้วย SIMULATE=false เมื่อ gateway จริงเริ่มส่งเข้า POST /api/ingest
 */

const state = new Map();
let timer = null;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function seedStateFromDb(sensors) {
  // จุดวัดทุกตัวมีสถานะแล้ว (ปกติหลัง step() แรก) ไม่ต้องเสียเวลาถาม DB ซ้ำทุกรอบ
  if (sensors.every((s) => state.has(s.tag))) return;

  // ห้ามสแกนทั้งตาราง readings (หลักล้านแถว) — ใช้ LATERAL ดึงแถวล่าสุดทีละ tag ผ่านดัชนี (tag, ts) แทน
  const latest = await many(
    `SELECT s.tag, r.value
       FROM sensors s
       LEFT JOIN LATERAL (
         SELECT value FROM readings WHERE tag = s.tag ORDER BY ts DESC LIMIT 1
       ) r ON true
      WHERE s.is_active`
  );
  const known = new Map(latest.filter((r) => r.value != null).map((r) => [r.tag, Number(r.value)]));
  for (const s of sensors) {
    if (state.has(s.tag)) continue;
    const min = Number(s.range_min ?? 0);
    const max = Number(s.range_max ?? 100);
    state.set(s.tag, known.get(s.tag) ?? min + (max - min) * (0.45 + Math.random() * 0.25));
  }
}

async function step() {
  const sensors = await activeSensors();
  await seedStateFromDb(sensors);

  const values = {};
  for (const s of sensors) {
    const min = Number(s.range_min ?? 0);
    const max = Number(s.range_max ?? 100);
    const stepSize = (max - min) * 0.012;
    const next = clamp(state.get(s.tag) + (Math.random() - 0.5) * 2 * stepSize, min, max);
    state.set(s.tag, next);
    values[s.tag] = Number(next.toFixed(3));
  }
  await ingest({ ts: new Date().toISOString(), values });
}

/** เติมข้อมูลย้อนหลังเพื่อให้กราฟมีเส้นตั้งแต่เปิดใช้ครั้งแรก */
export async function backfill(hours = 48, intervalMinutes = 5) {
  const sensors = await activeSensors();
  const existing = await many(`SELECT count(*)::int AS n FROM readings`);
  if (existing[0]?.n > 0) return 0;

  const points = Math.floor((hours * 60) / intervalMinutes);
  const local = new Map();
  for (const s of sensors) {
    const min = Number(s.range_min ?? 0);
    const max = Number(s.range_max ?? 100);
    local.set(s.tag, min + (max - min) * (0.45 + Math.random() * 0.25));
  }

  const now = Date.now();
  let written = 0;
  for (let i = points; i >= 0; i--) {
    const ts = new Date(now - i * intervalMinutes * 60_000).toISOString();
    const values = {};
    for (const s of sensors) {
      const min = Number(s.range_min ?? 0);
      const max = Number(s.range_max ?? 100);
      const stepSize = (max - min) * 0.02;
      const next = clamp(local.get(s.tag) + (Math.random() - 0.5) * 2 * stepSize, min, max);
      local.set(s.tag, next);
      values[s.tag] = Number(next.toFixed(3));
    }
    // เขียนข้อมูลย้อนหลังโดยไม่ผ่านตรรกะแจ้งเตือน เพื่อไม่ให้เกิดแจ้งเตือนย้อนหลังปลอม
    await ingest({ ts, values }, { evaluateAlarms: false }).catch(() => {});
    written += sensors.length;
  }
  return written;
}

export function startSimulator() {
  if (!config.simulate || timer) return;
  timer = setInterval(() => {
    step().catch((err) => console.error("[simulator]", err.message));
  }, config.simulateIntervalMs);
  step().catch((err) => console.error("[simulator]", err.message));
  console.log(`[simulator] สร้างค่าจำลองทุก ${config.simulateIntervalMs} มิลลิวินาที`);
}

export function stopSimulator() {
  if (timer) clearInterval(timer);
  timer = null;
}
