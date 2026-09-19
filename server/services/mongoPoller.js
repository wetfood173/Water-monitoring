import { getClient } from "./mongoClient.js";
import { activeSensors } from "./sensorCache.js";
import { ingest } from "./ingest.js";

/**
 * จุดวัดที่ data_source = "mongodb" รับค่าจาก MongoDB Atlas แทนการอ่านผ่าน Modbus — ทุก ๆ
 * mongo_poll_sec วินาที (ตั้งได้ต่อจุดวัดจากหน้า "จุดวัดและ setpoint") จะอ่าน document ล่าสุดจาก
 * collection ที่ตั้งไว้ (mongo_db/mongo_collection) แปลงค่าดิบ (ฟิลด์ value) ด้วย scale/offset ของ
 * จุดวัดนั้น แล้วส่งเข้า ingest() เหมือนค่าจาก Modbus ทุกประการ เพื่อให้หน้า Dashboard/Setpoints
 * อ่านจากตาราง readings เดียวกันได้
 */

// เช็คทุก 30 วินาทีว่ามีจุดวัดเพิ่ม/ลด หรือมีการแก้ db/collection/ความถี่ ไม่ต้องรีสตาร์ตเซิร์ฟเวอร์
const RECONCILE_MS = 30_000;

// tag -> { timer, mongoDb, mongoCollection, pollSec, lastTs }
const watchers = new Map();

async function pollTag(tag) {
  const w = watchers.get(tag);
  if (!w) return;

  try {
    const client = await getClient();
    const coll = client.db(w.mongoDb).collection(w.mongoCollection);
    const [doc] = await coll.find().sort({ ts: -1 }).limit(1).toArray();
    if (!doc || !Number.isFinite(doc.value)) return;

    const ts = doc.ts ? new Date(doc.ts).getTime() : null;
    if (ts !== null && ts === w.lastTs) return; // ยังไม่มี document ใหม่ ข้ามรอบนี้
    w.lastTs = ts;

    const sensor = (await activeSensors()).find((s) => s.tag === tag);
    if (!sensor) return;

    const scale = Number(sensor.modbus_scale ?? 1);
    const offset = Number(sensor.modbus_offset ?? 0);
    const value = doc.value * scale + offset;

    await ingest({
      ts: doc.ts ?? new Date().toISOString(),
      readings: [{ tag, value, quality: doc.quality === 0 ? 0 : 1 }],
    });
  } catch (err) {
    console.error(`[mongo-poller] ${tag} ดึงข้อมูลไม่สำเร็จ:`, err.message);
  }
}

function startWatcher(sensor) {
  const w = {
    mongoDb: sensor.mongo_db,
    mongoCollection: sensor.mongo_collection,
    pollSec: Number(sensor.mongo_poll_sec ?? 5),
    lastTs: null,
    timer: null,
  };
  w.timer = setInterval(() => pollTag(sensor.tag), w.pollSec * 1000);
  watchers.set(sensor.tag, w);
  console.log(
    `[mongo-poller] เริ่มดึง ${sensor.tag} จาก ${sensor.mongo_db}.${sensor.mongo_collection} ทุก ${w.pollSec} วินาที`
  );
  pollTag(sensor.tag); // อ่านค่าล่าสุดทันที ไม่ต้องรอรอบแรกของ interval
}

function stopWatcher(tag) {
  const w = watchers.get(tag);
  if (!w) return;
  clearInterval(w.timer);
  watchers.delete(tag);
}

async function reconcile() {
  const sensors = (await activeSensors()).filter(
    (s) => s.data_source === "mongodb" && s.mongo_db && s.mongo_collection
  );
  const wanted = new Map(sensors.map((s) => [s.tag, s]));

  for (const tag of watchers.keys()) {
    if (!wanted.has(tag)) stopWatcher(tag);
  }

  for (const s of sensors) {
    const w = watchers.get(s.tag);
    const pollSec = Number(s.mongo_poll_sec ?? 5);
    const changed = !w || w.mongoDb !== s.mongo_db || w.mongoCollection !== s.mongo_collection || w.pollSec !== pollSec;
    if (changed) {
      if (w) stopWatcher(s.tag);
      startWatcher(s);
    }
  }
}

let reconcileTimer = null;

export async function startMongoPoller() {
  if (reconcileTimer) return;
  await reconcile().catch((err) => console.error("[mongo-poller]", err.message));
  reconcileTimer = setInterval(() => {
    reconcile().catch((err) => console.error("[mongo-poller]", err.message));
  }, RECONCILE_MS);
}

export async function stopMongoPoller() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  for (const tag of [...watchers.keys()]) stopWatcher(tag);
}
