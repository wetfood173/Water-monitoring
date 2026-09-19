import { query } from "../db/index.js";
import { getSensors } from "./sensorCache.js";
import { evaluate } from "./alarmEngine.js";
import { badRequest } from "../lib/http.js";

/**
 * รับค่าจาก PLC gateway
 * รูปแบบที่รองรับ:
 *   { ts, readings: [{ tag, value, quality }] }
 *   { ts, values: { "LT-2": 91.4, "TT-05": 38.2 } }
 */
export async function ingest(payload, { evaluateAlarms = true } = {}) {
  const sensors = await getSensors();
  const ts = payload?.ts ? new Date(payload.ts) : new Date();
  if (Number.isNaN(ts.getTime())) throw badRequest("ค่า ts ไม่ใช่เวลาที่ถูกต้อง");

  let items = [];
  if (Array.isArray(payload?.readings)) {
    items = payload.readings.map((r) => ({
      tag: String(r.tag),
      value: Number(r.value),
      quality: r.quality === 0 ? 0 : 1,
      ts: r.ts ? new Date(r.ts) : ts,
    }));
  } else if (payload?.values && typeof payload.values === "object") {
    items = Object.entries(payload.values).map(([tag, value]) => ({
      tag,
      value: Number(value),
      quality: 1,
      ts,
    }));
  } else {
    throw badRequest("ต้องส่ง readings[] หรือ values{}");
  }

  const accepted = [];
  const rejected = [];
  for (const item of items) {
    if (!sensors.has(item.tag)) {
      rejected.push({ tag: item.tag, reason: "ไม่รู้จักจุดวัดนี้" });
      continue;
    }
    if (!Number.isFinite(item.value)) {
      rejected.push({ tag: item.tag, reason: "ค่าไม่ใช่ตัวเลข" });
      continue;
    }
    accepted.push(item);
  }

  if (accepted.length) {
    const values = [];
    const params = [];
    accepted.forEach((r, i) => {
      const b = i * 4;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      params.push(r.ts, r.tag, r.value, r.quality);
    });
    await query(
      `INSERT INTO readings (ts, tag, value, quality) VALUES ${values.join(",")}
       ON CONFLICT (tag, ts) DO UPDATE SET value = EXCLUDED.value, quality = EXCLUDED.quality`,
      params
    );
  }

  // ประเมินแจ้งเตือนหลังบันทึกสำเร็จ เพื่อไม่ให้แจ้งเตือนอ้างถึงค่าที่ยังไม่ได้เก็บ
  if (evaluateAlarms) {
    for (const r of accepted) {
      await evaluate(r.tag, r.value, r.ts, r.quality).catch((err) =>
        console.error(`[ingest] ประเมินแจ้งเตือน ${r.tag} ไม่สำเร็จ:`, err.message)
      );
    }
  }

  return { accepted: accepted.length, rejected };
}
