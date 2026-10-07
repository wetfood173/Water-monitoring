import { getClient, getConnectionInfo } from "./mongoClient.js";
import { getMongoAccounts } from "./mongoAccountCache.js";
import { activeSensors } from "./sensorCache.js";
import { ingest } from "./ingest.js";

/**
 * จุดวัดที่ data_source = "mongodb" รับค่าจาก MongoDB Atlas แทนการอ่านผ่าน Modbus — ทุก ๆ
 * mongo_poll_sec วินาที (ตั้งได้ต่อจุดวัดจากหน้า "จุดวัดและ setpoint") จะอ่าน document ล่าสุดจาก
 * collection ที่ตั้งไว้ (mongo_db/mongo_collection) ของบัญชีที่จุดวัดนั้นเลือก (mongo_account_id)
 * แปลงค่าดิบ (ฟิลด์ value) ด้วย scale/offset ของจุดวัดนั้น แล้วส่งเข้า ingest() เหมือนค่าจาก Modbus
 * ทุกประการ เพื่อให้หน้า Dashboard/Setpoints อ่านจากตาราง readings เดียวกันได้
 *
 * รองรับหลายบัญชี/คลัสเตอร์พร้อมกัน (ตาราง mongo_accounts) — เปิด/ปิดทั้งบัญชีทำได้จากปุ่มในหน้า
 * "จุดวัดและ setpoint" (PUT /api/mongo-accounts/:id) มีผลทันที ไม่ต้องรีสตาร์ตเซิร์ฟเวอร์ จุดวัดที่ยัง
 * ไม่ได้เลือกบัญชี หรือเลือกบัญชีที่ถูกปิดไว้ จะไม่ถูกอ่าน
 */

// เช็คทุก 30 วินาทีว่ามีจุดวัดเพิ่ม/ลด หรือมีการแก้บัญชี/db/collection/ความถี่ ไม่ต้องรีสตาร์ตเซิร์ฟเวอร์
const RECONCILE_MS = 30_000;

// tag -> { timer, accountId, accountName, mongoDb, mongoCollection, pollSec, lastTs, lastError }
const watchers = new Map();

export const status = {
  accounts: [],
  watchers: [],
  lastError: null,
};

function refreshStatus(accounts) {
  status.accounts = [...accounts.values()]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
    .map((a) => ({
      id: a.id,
      name: a.name,
      isActive: a.is_active,
      mappedTags: [...watchers.values()].filter((w) => w.accountId === a.id).length,
      ...getConnectionInfo(a.id),
    }));
  status.watchers = [...watchers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, w]) => ({
      tag,
      accountId: w.accountId,
      accountName: w.accountName,
      mongoDb: w.mongoDb,
      mongoCollection: w.mongoCollection,
      pollSec: w.pollSec,
      lastTs: w.lastTs,
      lastError: w.lastError,
    }));
}

async function pollTag(tag) {
  const w = watchers.get(tag);
  if (!w) return;

  try {
    const client = await getClient(w.accountId);
    const coll = client.db(w.mongoDb).collection(w.mongoCollection);
    const [doc] = await coll.find().sort({ ts: -1 }).limit(1).toArray();
    if (!doc || !Number.isFinite(doc.value)) return;

    const ts = doc.ts ? new Date(doc.ts).getTime() : null;
    if (ts !== null && ts === w.lastTs) return; // ยังไม่มี document ใหม่ ข้ามรอบนี้
    w.lastTs = ts;
    w.lastError = null;

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
    w.lastError = err.message;
    status.lastError = err.message;
    console.error(`[mongo-poller] ${tag} ดึงข้อมูลไม่สำเร็จ:`, err.message);
  } finally {
    refreshStatus(await getMongoAccounts());
  }
}

function startWatcher(sensor, account) {
  const w = {
    accountId: account.id,
    accountName: account.name,
    mongoDb: sensor.mongo_db,
    mongoCollection: sensor.mongo_collection,
    pollSec: Number(sensor.mongo_poll_sec ?? 5),
    lastTs: null,
    lastError: null,
    timer: null,
  };
  w.timer = setInterval(() => pollTag(sensor.tag), w.pollSec * 1000);
  watchers.set(sensor.tag, w);
  console.log(
    `[mongo-poller] เริ่มดึง ${sensor.tag} จาก ${account.name}: ${sensor.mongo_db}.${sensor.mongo_collection} ทุก ${w.pollSec} วินาที`
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
  const accounts = await getMongoAccounts();
  const sensors = (await activeSensors()).filter(
    (s) =>
      s.data_source === "mongodb" &&
      s.mongo_account_id != null &&
      s.mongo_db &&
      s.mongo_collection &&
      accounts.get(s.mongo_account_id)?.is_active
  );
  const wanted = new Map(sensors.map((s) => [s.tag, s]));

  for (const tag of watchers.keys()) {
    if (!wanted.has(tag)) stopWatcher(tag);
  }

  for (const s of sensors) {
    const account = accounts.get(s.mongo_account_id);
    const w = watchers.get(s.tag);
    const pollSec = Number(s.mongo_poll_sec ?? 5);
    const changed =
      !w ||
      w.accountId !== account.id ||
      w.mongoDb !== s.mongo_db ||
      w.mongoCollection !== s.mongo_collection ||
      w.pollSec !== pollSec;
    if (changed) {
      if (w) stopWatcher(s.tag);
      startWatcher(s, account);
    }
  }
  refreshStatus(accounts);
}

let reconcileTimer = null;

export async function startMongoPoller() {
  if (reconcileTimer) return;

  await reconcile().catch((err) => console.error("[mongo-poller]", err.message));
  reconcileTimer = setInterval(() => {
    reconcile().catch((err) => console.error("[mongo-poller]", err.message));
  }, RECONCILE_MS);
}

/** เรียกทันทีหลังแก้/เปิด-ปิดบัญชีจากหน้าเว็บ เพื่อไม่ต้องรอรอบ reconcile ถัดไป (สูงสุด RECONCILE_MS) */
export async function syncMongoPoller() {
  await reconcile();
}

export async function stopMongoPoller() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  for (const tag of [...watchers.keys()]) stopWatcher(tag);
  status.accounts = [];
  status.watchers = [];
}
