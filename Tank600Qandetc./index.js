import { MongoClient } from "mongodb";
import { config } from "./config.js";
import { ModbusTcpClient, decodeRegisters, registerSize } from "./modbusClient.js";

/**
 * บริดจ์ Modbus TCP -> MongoDB Atlas สำหรับบ่อ 600Q
 *
 * รันแยกเป็นเอกเทศบน Raspberry Pi อีกตัวที่หน้างานบ่อ 600Q ไม่มีหน้าเว็บ ไม่ผูกกับ Postgres
 * ของโปรเจกต์หลัก — อ่านค่าจาก PLC (AI1 = ระดับน้ำ 600Q, AI2 = Flowrate 600Q) ทุก MODBUS_POLL_MS
 * มิลลิวินาที แล้วส่งค่าที่แปลงแล้วเข้า MongoDB Atlas ตรง ๆ:
 *   AI1 -> db "Tank600Q" collection "Level Water"
 *   AI2 -> db "Tank600Q" collection "Flowrate"
 *
 * เอกสารที่บันทึกแต่ละรายการ: { ts, tag, value, quality } — เก็บเฉพาะฟิลด์ที่ฝั่งเว็บใช้จริง
 * ตามตาราง readings ของโปรเจกต์หลัก (server/services/ingest.js) เพื่อให้เข้ากันได้ถ้าฝั่งเว็บ
 * จะอ่านค่าจากคอลเลกชันนี้ในอนาคต
 */

const channels = [config.ai1, config.ai2];

const plc = new ModbusTcpClient({
  host: config.plc.host,
  port: config.plc.port,
  timeoutMs: config.plc.timeoutMs,
  reconnectMs: config.plc.reconnectMs,
});

plc.on("connect", () => console.log(`[modbus] เชื่อมต่อ PLC ${config.plc.host}:${config.plc.port} สำเร็จ`));
plc.on("disconnect", () => console.warn(`[modbus] การเชื่อมต่อ PLC ${config.plc.host}:${config.plc.port} หลุด กำลังต่อใหม่`));
plc.on("error", (err) => console.error(`[modbus] error: ${err.message}`));
plc.connect();

const mongo = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 8000 });
let mongoConnected = false;

/**
 * ตั้ง TTL index บนฟิลด์ ts ของ Level Water / Flowrate ให้ MongoDB ลบเอกสารที่เก่ากว่า
 * retentionDays ทิ้งเองทุกรอบ (MongoDB เช็ก TTL ทุก ~60 วินาทีในเบื้องหลัง ไม่ต้องมี job แยก)
 * เรียกครั้งเดียวตอนต่อ MongoDB สำเร็จ — createIndex ซ้ำด้วยพารามิเตอร์เดิมไม่มีผลข้างเคียง
 */
async function ensureTtlIndexes() {
  const days = config.mongo.retentionDays;
  if (!days || days <= 0) return;
  const seconds = days * 24 * 60 * 60;

  for (const ch of channels) {
    const coll = mongo.db(ch.mongoDb).collection(ch.mongoCollection);
    try {
      await coll.createIndex({ ts: 1 }, { expireAfterSeconds: seconds, name: "ts_ttl" });
    } catch (err) {
      // เคยตั้ง retentionDays ไว้ค่าอื่นมาก่อน ต้องลบ index เดิมแล้วสร้างใหม่ให้ตรงค่าล่าสุด
      if (err.codeName === "IndexOptionsConflict" || err.code === 85 || err.code === 86) {
        await coll.dropIndex("ts_ttl").catch(() => {});
        await coll.createIndex({ ts: 1 }, { expireAfterSeconds: seconds, name: "ts_ttl" });
      } else {
        throw err;
      }
    }
  }
  console.log(`[mongo] ตั้ง TTL index เก็บข้อมูลย้อนหลัง ${days} วัน (${channels.map((c) => c.mongoCollection).join(", ")})`);
}

async function ensureMongo() {
  if (mongoConnected) return;
  await mongo.connect();
  mongoConnected = true;
  console.log("[mongo] เชื่อมต่อ MongoDB Atlas สำเร็จ");
  await ensureTtlIndexes();
}

async function readChannel(ch) {
  const quantity = registerSize(ch.dataType);
  const data = await plc.readRegisters(config.plc.unitId, ch.address, quantity, ch.fc);
  const raw = decodeRegisters(data, 0, ch.dataType, ch.wordSwap);
  const value = raw * ch.scale + ch.offset;
  return { raw, value };
}

let polling = false;

async function pollOnce() {
  if (polling) return;
  if (!plc.connected) return; // ยังไม่ต่อ/กำลังต่อใหม่ ข้ามรอบนี้ไปก่อน
  polling = true;
  const ts = new Date();

  try {
    await ensureMongo();

    for (const ch of channels) {
      try {
        const { value } = await readChannel(ch);
        const finite = Number.isFinite(value);
        const quality = finite ? 1 : 0;

        await mongo
          .db(ch.mongoDb)
          .collection(ch.mongoCollection)
          .insertOne({ ts, tag: ch.tag, value: finite ? value : 0, quality });

        console.log(finite ? value : "N/A");
      } catch (err) {
        console.error(`[${ch.tag}] อ่านหรือบันทึกไม่สำเร็จ:`, err.message);
      }
    }
  } catch (err) {
    console.error("[poll] ล้มเหลว:", err.message);
  } finally {
    polling = false;
  }
}

const timer = setInterval(() => {
  pollOnce().catch((err) => console.error("[poll]", err.message));
}, config.plc.pollMs);

console.log(
  `[bridge] เริ่มอ่านค่าจาก PLC ${config.plc.host}:${config.plc.port} ทุก ${config.plc.pollMs} มิลลิวินาที ` +
    `(AI1 -> ${config.ai1.mongoDb}.${config.ai1.mongoCollection}, AI2 -> ${config.ai2.mongoDb}.${config.ai2.mongoCollection})`
);

async function shutdown(signal) {
  console.log(`\n[bridge] ได้รับ ${signal} กำลังปิดการเชื่อมต่อ...`);
  clearInterval(timer);
  plc.close();
  if (mongoConnected) await mongo.close();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
