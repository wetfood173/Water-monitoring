import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("./", import.meta.url)));

// โหลด .env เองเพื่อไม่ต้องพึ่ง dependency เพิ่ม (แบบเดียวกับ server/config.js ของโปรเจกต์หลัก)
function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const bool = (v, dflt = false) => (v === undefined || v === "" ? dflt : /^(1|true|yes|on)$/i.test(v));
const int = (v, dflt) => (v === undefined || v === "" ? dflt : Number.parseInt(v, 10));
const num = (v, dflt) => (v === undefined || v === "" ? dflt : Number(v));

/** อ่านค่าตั้งค่าของ 1 ช่องสัญญาณ (AI1 หรือ AI2) จากตัวแปรที่ขึ้นต้นด้วย prefix เช่น AI1_ADDRESS */
function channel(prefix, defaults) {
  return {
    tag: process.env[`${prefix}_TAG`] || defaults.tag,
    fc: int(process.env[`${prefix}_FC`], defaults.fc),
    address: int(process.env[`${prefix}_ADDRESS`], defaults.address),
    dataType: process.env[`${prefix}_DATA_TYPE`] || defaults.dataType,
    wordSwap: bool(process.env[`${prefix}_WORD_SWAP`], false),
    scale: num(process.env[`${prefix}_SCALE`], defaults.scale),
    offset: num(process.env[`${prefix}_OFFSET`], defaults.offset),
    mongoDb: process.env[`${prefix}_MONGO_DB`] || defaults.mongoDb,
    mongoCollection: process.env[`${prefix}_MONGO_COLLECTION`] || defaults.mongoCollection,
  };
}

export const config = {
  plc: {
    host: process.env.PLC_HOST || "192.168.0.5",
    port: int(process.env.PLC_PORT, 502),
    unitId: int(process.env.MODBUS_UNIT_ID, 1),
    pollMs: int(process.env.MODBUS_POLL_MS, 1000),
    timeoutMs: int(process.env.MODBUS_TIMEOUT_MS, 3000),
    reconnectMs: int(process.env.MODBUS_RECONNECT_MS, 5000),
  },

  mongo: {
    uri: process.env.MONGODB_URI || "",
    // เก็บข้อมูลดิบใน Level Water / Flowrate ไว้กี่วัน เกินกว่านี้ MongoDB จะลบทิ้งอัตโนมัติผ่าน TTL index
    // (ดู ensureTtlIndexes ใน index.js) — 0 = ปิด เก็บไว้ตลอดไป
    retentionDays: int(process.env.MONGO_RETENTION_DAYS, 30),
  },

  // ค่าเริ่มต้น FC4 (Read Input Registers) address 0/1 แบบ raw uint16 ตามข้อ 6.2 ของ
  // docs/plc-wiring-logo-am2.md (ยืนยันแล้วว่าใช้ได้กับ LOGO!+AM2 รุ่นที่หน้างานอื่นใช้อยู่)
  // แต่ address/scale/offset ของ PLC ตัวนี้ (192.168.0.5) เป็นอุปกรณ์คนละตัว ต้องยืนยันกับหน้างานจริง
  // ก่อนใช้งานจริง แล้วปรับผ่าน .env (AI1_*/AI2_*) ได้โดยไม่ต้องแก้โค้ด
  ai1: channel("AI1", {
    tag: "AI1",
    fc: 4,
    address: 0,
    dataType: "uint16",
    scale: 1,
    offset: 0,
    mongoDb: "Tank600Q",
    mongoCollection: "Level Water",
  }),
  ai2: channel("AI2", {
    tag: "AI2",
    fc: 4,
    address: 1,
    dataType: "uint16",
    scale: 1,
    offset: 0,
    mongoDb: "Tank600Q",
    mongoCollection: "Flowrate",
  }),
};

if (!config.mongo.uri) {
  throw new Error("ยังไม่ได้ตั้งค่า MONGODB_URI ใน .env");
}
