import { MongoClient } from "mongodb";
import { getMongoAccount } from "./mongoAccountCache.js";

/**
 * เชื่อมต่อ MongoDB Atlas ได้หลายบัญชี/คลัสเตอร์พร้อมกัน (ตาราง mongo_accounts) — จุดวัดแต่ละอัน
 * เลือกได้ว่าจะอ่านจากบัญชีไหนและ database/collection ไหนจากหน้าเว็บ — อ่านอย่างเดียว ไม่มีการเขียน
 * ค่ากลับไปที่ Mongo คงการเชื่อมต่อไว้ต่อบัญชี (คีย์ด้วย account id) แทนที่จะเปิด-ปิดใหม่ทุกครั้ง
 */

// account id -> { client, connecting, connected, lastError }
const clients = new Map();

function entryFor(id) {
  let entry = clients.get(id);
  if (!entry) {
    entry = { client: null, connecting: null, connected: false, lastError: null };
    clients.set(id, entry);
  }
  return entry;
}

export async function getClient(accountId) {
  const id = Number(accountId);
  if (!Number.isInteger(id)) throw new Error("ยังไม่ได้เลือกบัญชี MongoDB");
  const account = await getMongoAccount(id);
  if (!account) throw new Error("ไม่พบบัญชี MongoDB นี้ — อาจถูกลบไปแล้ว");

  const entry = entryFor(id);
  if (entry.client) return entry.client;
  if (!entry.connecting) {
    entry.connecting = MongoClient.connect(account.uri, { serverSelectionTimeoutMS: 8000 })
      .then((c) => {
        entry.client = c;
        entry.connected = true;
        entry.lastError = null;
        return c;
      })
      .catch((err) => {
        entry.connected = false;
        entry.lastError = err.message;
        throw err;
      })
      .finally(() => {
        entry.connecting = null;
      });
  }
  return entry.connecting;
}

/** สถานะการเชื่อมต่อล่าสุดของบัญชีนี้ — ใช้แสดงในหน้า "จุดวัดและ setpoint" */
export function getConnectionInfo(accountId) {
  const entry = clients.get(Number(accountId));
  return { connected: Boolean(entry?.connected), lastError: entry?.lastError ?? null };
}

/** เชื่อมต่อใหม่ตอนแก้ URI ของบัญชีนี้ — ตัวเก่าที่ค้างอยู่ (ถ้ามี) ใช้ URI เดิม ต้องทิ้งไปเชื่อมใหม่ */
export function invalidateMongoClient(accountId) {
  const id = Number(accountId);
  const entry = clients.get(id);
  if (entry?.client) entry.client.close().catch(() => {});
  clients.delete(id);
}

/** ทดสอบอ่านค่าจาก database/collection ที่กรอก โดยไม่บันทึกอะไรลงฐานข้อมูล */
export async function testMongoRead(accountId, dbName, collectionName) {
  if (!dbName || !collectionName) throw new Error("ต้องระบุทั้ง database และ collection");
  const c = await getClient(accountId);
  const coll = c.db(dbName).collection(collectionName);
  const count = await coll.estimatedDocumentCount();
  const sample = await coll.find().sort({ $natural: -1 }).limit(1).toArray();
  return { count, sample: sample[0] ?? null };
}

/** ทดสอบเชื่อมต่อด้วย URI ที่กรอกตรง ๆ (ยังไม่บันทึกเป็นบัญชี) — ใช้ตอนเพิ่ม/แก้บัญชีในหน้าเว็บ */
export async function testConnect(uri) {
  const c = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await c.db("admin").command({ ping: 1 });
  } finally {
    await c.close();
  }
  return { ok: true };
}

export async function closeMongo() {
  for (const entry of clients.values()) {
    if (entry.client) await entry.client.close();
  }
  clients.clear();
}
