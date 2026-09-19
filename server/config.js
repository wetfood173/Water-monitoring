import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

// โหลด .env เองเพื่อไม่ต้องพึ่ง dependency เพิ่ม
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

const bool = (v, dflt = false) =>
  v === undefined || v === "" ? dflt : /^(1|true|yes|on)$/i.test(v);
const int = (v, dflt) => (v === undefined || v === "" ? dflt : Number.parseInt(v, 10));

const isProd = process.env.NODE_ENV === "production";
// อ่านจาก PLC จริงเมื่อไหร่ ตัวจำลองต้องหยุดเสมอ ไม่อย่างนั้นค่าปลอมจะปนกับค่าจริง
// รายชื่อ PLC (host/port) ตั้งจากหน้าเว็บ ("จุดวัดและ setpoint") เก็บในตาราง plcs ไม่ได้มาจาก .env อีกต่อไป
const modbusEnabled = bool(process.env.MODBUS_ENABLED, false);

export const config = {
  env: process.env.NODE_ENV || "development",
  isProd,
  port: int(process.env.PORT, 3000),
  baseUrl: (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),

  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  ingestToken: process.env.INGEST_TOKEN || "",

  databaseUrl: process.env.DATABASE_URL || "",
  pgliteDir: path.resolve(ROOT, process.env.PGLITE_DIR || "./data/pglite"),

  line: {
    loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID || "",
    loginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET || "",
    loginCallbackUrl:
      process.env.LINE_LOGIN_CALLBACK_URL ||
      `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/auth/line/callback`,
    messagingChannelSecret: process.env.LINE_MESSAGING_CHANNEL_SECRET || "",
    messagingAccessToken: process.env.LINE_MESSAGING_ACCESS_TOKEN || "",
    addFriendUrl: process.env.LINE_OA_ADD_FRIEND_URL || "",
    // QR สำหรับเพิ่มเพื่อน OA (Product.md ข้อ 5.1) ใช้ไฟล์ใน public/img ถ้ามี
    oaQrUrl: process.env.LINE_OA_QR_URL || (fs.existsSync(path.join(ROOT, "public", "img", "QRcodeLine.png")) ? "/img/QRcodeLine.png" : ""),
    liffId: process.env.LINE_LIFF_ID || "",
  },

  // อ่านค่าจาก PLC ผ่าน Modbus TCP โดยตรง ไม่ผ่าน Node-RED
  // host/port ของแต่ละ PLC ตั้งจากหน้าเว็บ (ตาราง plcs) รองรับหลาย PLC พร้อมกัน
  modbus: {
    enabled: bool(process.env.MODBUS_ENABLED, false),
    pollMs: int(process.env.MODBUS_POLL_MS, 1000),
    timeoutMs: int(process.env.MODBUS_TIMEOUT_MS, 3000),
    reconnectMs: int(process.env.MODBUS_RECONNECT_MS, 5000),
  },

  // จุดวัดบางอันรับค่าจาก MongoDB Atlas แทน PLC — เชื่อมต่อคลัสเตอร์เดียว
  // แต่เลือกได้ว่าจุดวัดแต่ละอันจะอ่านจาก database/collection ไหนจากหน้าเว็บ (ไม่ผูกกับ .env)
  mongo: {
    uri: process.env.MONGODB_URI || "",
  },

  devLogin: bool(process.env.DEV_LOGIN, !isProd),
  simulate: bool(process.env.SIMULATE, !isProd) && !modbusEnabled,
  simulateIntervalMs: int(process.env.SIMULATE_INTERVAL_MS, 5000),

  // อัปโหลด backup ขึ้น Cloudflare R2 (S3-compatible) หลังสำรองข้อมูลเสร็จทุกครั้ง
  // ถ้าไม่ตั้งค่าไว้ (ไม่มี bucket) จะข้ามขั้นตอนนี้ไป เก็บไว้แค่ในเครื่องตามเดิม
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    prefix: process.env.R2_PREFIX || "backups/",
  },

  session: {
    // หมดอายุเมื่อไม่มีการใช้งานติดต่อกัน 30 วัน
    // ทุก request จะเลื่อนวันหมดอายุออกไปอีก 30 วัน ใช้งานอยู่เรื่อย ๆ จึงไม่ต้องล็อกอินใหม่
    // รับค่าทศนิยมได้ เช่น 0.5 = 12 ชั่วโมง สะดวกตอนทดสอบและปรับจูน
    idleDays: Number(process.env.SESSION_IDLE_DAYS) || 30,
    // สิทธิ์ admin ยังหมดอายุตามเดิม การล็อกอินค้างไว้กับการถือสิทธิ์แก้ค่าเป็นคนละความเสี่ยง
    adminIdleMinutes: 30,
    cookieName: "wm_sid",
  },
};

export const lineLoginEnabled = Boolean(
  config.line.loginChannelId && config.line.loginChannelSecret
);
export const lineMessagingEnabled = Boolean(
  config.line.messagingAccessToken && config.line.messagingChannelSecret
);

if (isProd) {
  const missing = [];
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.INGEST_TOKEN) missing.push("INGEST_TOKEN");
  if (!lineLoginEnabled) missing.push("LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET");
  if (missing.length) {
    throw new Error(`ขาดค่า environment ที่จำเป็นสำหรับ production: ${missing.join(", ")}`);
  }
  if (config.devLogin) {
    throw new Error("DEV_LOGIN ต้องปิดใน production");
  }
}
