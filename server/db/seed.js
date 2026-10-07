import { query } from "./index.js";
import { hashSecret } from "../lib/hash.js";
import { config } from "../config.js";

/* ค่า LL/HH และความจุทั้งหมดยังเป็นค่าสมมติจาก prototype
   ต้องแทนด้วยค่าจริงจากหน้างานก่อนใช้งานจริง (Product.md ข้อ 11.4, 11.5) */

/* Modbus: อ่านจาก holding register เรียงตาม AI1–AI11 เริ่มที่ 528
   AI1 = บ่อ 1A, AI2 = บ่อ 1B แล้วไล่ตามลำดับบ่อ จากนั้นเป็นเครื่องมือวัดอีก 4 ตัว

   ระดับน้ำ: PLC ส่งมาเป็น 0–1000 (ทศนิยม 1 ตำแหน่ง) จึงคูณ 0.1 ให้เป็น 0–100 %
   เครื่องมือวัดอีก 4 ตัว: ยังไม่ยืนยันตัวคูณ ตั้ง 1 ไว้ก่อน
   ถ้าค่าที่ได้หลุดพิสัยจะถูกบันทึกเป็น quality = 0 และไม่สร้างแจ้งเตือน
   ให้ใช้ปุ่ม "ทดสอบอ่านค่า" ในหน้าจุดวัดเทียบค่าดิบกับหน้าปัดจริงแล้วตั้งตัวคูณให้ถูก */
const AI_BASE = 528;
const LEVEL_SCALE = 0.1;

export const PONDS = [
  { pond_id: "1A",   name: "บ่อ 1A",   capacity_m3: 1200, sort_order: 1, role_note: "จ่ายเข้าสายผลิต",        src_note: "Softener",                     dst_note: "สายการผลิต" },
  { pond_id: "1B",   name: "บ่อ 1B",   capacity_m3: 1200, sort_order: 2, role_note: "รับน้ำจาก Softener + น้ำกลับ",   src_note: "Softener · Cooling Tower",     dst_note: "บ่อ 2" },
  { pond_id: "2",    name: "บ่อ 2",    capacity_m3: 1800, sort_order: 3, role_note: "บ่อกระจายน้ำ",           src_note: "บ่อ 1B · Retort A–E",          dst_note: "บ่อ 3 · บ่อ 4 · Cooling Tower" },
  { pond_id: "3",    name: "บ่อ 3",    capacity_m3: 1800, sort_order: 4, role_note: "รับน้ำจาก Cooling Tower", src_note: "บ่อ 2 · Cooling Tower",        dst_note: "—" },
  { pond_id: "4",    name: "บ่อ 4",    capacity_m3: 2400, sort_order: 5, role_note: "รับน้ำกลับ Retort F–N",  src_note: "บ่อ 2 · Retort F–N",           dst_note: "บ่อ 5" },
  { pond_id: "5",    name: "บ่อ 5",    capacity_m3: 3000, sort_order: 6, role_note: "จุดวัดอุณหภูมิ",         src_note: "บ่อ 4",                        dst_note: "Cooling Tower → บ่อ 1B" },
  { pond_id: "600Q", name: "บ่อ 600Q", capacity_m3: 600,  sort_order: 7, role_note: "บ่ออิสระ",               src_note: "ท่อน้ำเข้า",                    dst_note: "—" },
];

/* PLC ที่หน้างานมีจริง — จุดวัดแต่ละอันเลือกได้จากหน้า "จุดวัดและ setpoint" ว่าจะอ่านผ่านตัวไหน
   เพิ่ม/แก้/ลบ PLC เพิ่มเติมได้จากหน้าจอโดยตรง ไม่ต้องแก้โค้ด */
export const PLCS = [
  { name: "PLC-1", host: "192.168.0.3", port: 502, sort_order: 1 },
  { name: "PLC-2", host: "192.168.0.4", port: 502, sort_order: 2 },
];

export const SENSORS = [
  { tag: "LT-1A",   pond_id: "1A",   name: "ระดับน้ำ บ่อ 1A",          metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 22, hh: 88, ll_critical: 10, hh_critical: 95, decimals: 1, sort_order: 1,  modbus_address: AI_BASE + 0,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-1B",   pond_id: "1B",   name: "ระดับน้ำ บ่อ 1B",          metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 22, hh: 88, ll_critical: 10, hh_critical: 95, decimals: 1, sort_order: 2,  modbus_address: AI_BASE + 1,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-2",    pond_id: "2",    name: "ระดับน้ำ บ่อ 2",           metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 25, hh: 90, ll_critical: 12, hh_critical: 96, decimals: 1, sort_order: 3,  modbus_address: AI_BASE + 2,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-3",    pond_id: "3",    name: "ระดับน้ำ บ่อ 3",           metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 25, hh: 90, ll_critical: 12, hh_critical: 96, decimals: 1, sort_order: 4,  modbus_address: AI_BASE + 3,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-4",    pond_id: "4",    name: "ระดับน้ำ บ่อ 4",           metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 30, hh: 90, ll_critical: 15, hh_critical: 96, decimals: 1, sort_order: 5,  modbus_address: AI_BASE + 4,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-5",    pond_id: "5",    name: "ระดับน้ำ บ่อ 5",           metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 35, hh: 92, ll_critical: 18, hh_critical: 97, decimals: 1, sort_order: 6,  modbus_address: AI_BASE + 5,  modbus_scale: LEVEL_SCALE },
  { tag: "LT-600Q", pond_id: "600Q", name: "ระดับน้ำ บ่อ 600Q",        metric: "level",       unit: "%",    range_min: 0,  range_max: 100, ll: 20, hh: 85, ll_critical: 8,  hh_critical: 94, decimals: 1, sort_order: 7,  modbus_address: AI_BASE + 6,  modbus_scale: LEVEL_SCALE },
  { tag: "FT-600Q", pond_id: "600Q", name: "อัตราการไหลขาเข้า บ่อ 600Q", metric: "flow",      unit: "m³/h", range_min: 0,  range_max: 200, ll: 40, hh: 180, ll_critical: 15, hh_critical: 195, decimals: 0, sort_order: 9,  modbus_address: AI_BASE + 8,  modbus_scale: 1 },
  { tag: "PT-AIR",  pond_id: null,   name: "แรงดันลม",                 metric: "pressure",    unit: "bar",  range_min: 0,  range_max: 10,  ll: 4.5, hh: 8.5, ll_critical: 3.0, hh_critical: 9.4, decimals: 2, sort_order: 10, modbus_address: AI_BASE + 9,  modbus_scale: 1 },
  { tag: "PT-STM",  pond_id: null,   name: "แรงดันไอน้ำ",              metric: "pressure",    unit: "bar",  range_min: 0,  range_max: 12,  ll: 5.0, hh: 9.5, ll_critical: 3.5, hh_critical: 11.0, decimals: 2, sort_order: 11, modbus_address: AI_BASE + 10, modbus_scale: 1 },
];

export const EMPLOYEES = [
  { emp_code: "0008136", full_name: "นาย กมล แก้วพัด",          position: "วิศวกร 4 ซ่อมบำรุง (เทียบเท่า)", department: "WF06", role: "engineer",   is_admin: true },
  { emp_code: "0007904", full_name: "นาย ภูริทรรศน์ สิรินานนท์", position: "วิศวกร 4 ซ่อมบำรุง (เทียบเท่า)", department: "WF05", role: "engineer",   is_admin: true },
  { emp_code: "0013649", full_name: "นาย นิธิ มูลตระกูล",        position: "วิศวกร ซ่อมบำรุง",              department: "WF06", role: "engineer",   is_admin: false },
  { emp_code: "0019229", full_name: "นาย ธนวัฒน์ มะลิฉ่ำ",       position: "วิศวกร ซ่อมบำรุง",              department: "WF06", role: "engineer",   is_admin: false },
  { emp_code: "0019656", full_name: "นาย อโนชา พงษ์สัจจา",       position: "วิศวกร ซ่อมบำรุง",              department: "WF06", role: "engineer",   is_admin: true },
  { emp_code: "0014476", full_name: "นาย วิทยา ใจบุญ",           position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0015655", full_name: "นาย นนทศักดิ์ ปัทมนาวิน",   position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0018025", full_name: "นาย สืบวงศ์ มูลตรีภักดี",   position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0014216", full_name: "นาย พิทักษ์ ผลาเลิศ",       position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0016685", full_name: "นาย ธนพล ศรีวิลัย",         position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0013481", full_name: "นาย ทิวาทร สุดรัมย์",       position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0015572", full_name: "นาย ณัฐพงษ์ ช่างสอน",       position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0014478", full_name: "นาย ธีรพนธ์ แก้วกาหลง",     position: "ช่างเทคนิค ชำนาญการ",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0020827", full_name: "นาย กฤษฎา ธรรมมิยะ",        position: "ช่างไฟฟ้า ซ่อมบำรุง",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0019351", full_name: "นาย ธีรศักดิ์ วิเศษจันทร์",  position: "ช่างไฟฟ้า ซ่อมบำรุง",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0019393", full_name: "นาย ไชยา บุพศิริ",          position: "ช่างไฟฟ้า ซ่อมบำรุง",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0017977", full_name: "นาย สุทัศน์ สุระพล",        position: "ช่างไฟฟ้า ซ่อมบำรุง",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0021982", full_name: "นาย ธนากร ม่วงเขียว",       position: "ช่างไฟฟ้า ซ่อมบำรุง",           department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0005782", full_name: "นาย ปิยะศักดิ์ แจ่มสกุล",   position: "ช่างเครื่องกล ซ่อมบำรุง",       department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0022555", full_name: "นาย พัสกร มงคลวัจน์",       position: "ช่างเครื่องกล ซ่อมบำรุง",       department: "WF06", role: "technician", is_admin: false },
  { emp_code: "0022608", full_name: "นาย ธนากร สุราช",           position: "ช่างเครื่องกล ซ่อมบำรุง",       department: "WF06", role: "technician", is_admin: false },
];

export const DEFAULT_SETTINGS = {
  "notify.recipients": {
    warning: { roles: ["technician", "engineer", "admin"], departments: "all" },
    critical: { roles: ["technician", "engineer", "admin", "staff"], departments: "all" },
  },
  "notify.repeat_minutes": 30,
  "notify.quiet_hours": { enabled: false, from: "22:00", to: "06:00" },
  "alarm.no_signal_sec": 300,
  "retention.raw_months": 12,
  // ตัดข้อมูลดิบที่เก่ากว่า N วันทิ้งทุกวัน ให้เหลือแค่ข้อมูลล่าสุดตามที่ตั้งไว้ (0 = ปิด ใช้แค่ retention.raw_months)
  "retention.raw_days": 30,
  // แอดมินเลือกได้ว่าการ์ดไหนบนหน้า Dashboard จะแสดง — มีผลกับทุกคนที่เข้าดู (ตั้งจากหน้า Dashboard โดยตรง)
  "dashboard.visible_cards": { diagram: true, instruments: true, chart: true, alarms: true },
  // ซ่อนเครื่องมือวัดรายจุด (เช่น แรงดันลม/ไอน้ำ) โดยไม่ต้องปิดทั้งการ์ด — เก็บเป็นรายการ tag ที่ซ่อน
  "dashboard.hidden_tags": [],
  // layout ตารางของหน้า Dashboard ที่แอดมินจัดเอง — null = ใช้ layout เริ่มต้นที่หน้าเว็บสร้างจาก visible_cards
  "dashboard.layout": null,
  // ผังบ่อ (ถัง อุปกรณ์ เกจ เส้นท่อ) ที่แอดมินจัดเอง — null = ใช้ผังเริ่มต้นใน public/js/diagram.js
  "dashboard.diagram": null,
};

async function upsertPonds() {
  for (const p of PONDS) {
    await query(
      `INSERT INTO ponds (pond_id, name, capacity_m3, sort_order, role_note, src_note, dst_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (pond_id) DO UPDATE SET
         name=EXCLUDED.name, capacity_m3=EXCLUDED.capacity_m3, sort_order=EXCLUDED.sort_order,
         role_note=EXCLUDED.role_note, src_note=EXCLUDED.src_note, dst_note=EXCLUDED.dst_note`,
      [p.pond_id, p.name, p.capacity_m3, p.sort_order, p.role_note, p.src_note, p.dst_note]
    );
  }
}

// สร้างให้เฉพาะตอนยังไม่มี PLC ที่ host:port นี้ — ชื่อ/ลำดับแก้ได้จากหน้าเว็บแล้ว ไม่ให้ seed เขียนทับซ้ำ
async function upsertPlcs() {
  for (const p of PLCS) {
    await query(
      `INSERT INTO plcs (name, host, port, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (host, port) DO NOTHING`,
      [p.name, p.host, p.port, p.sort_order]
    );
  }
}

/** จุดวัดเก่าที่ยังไม่เคยเลือก PLC (มาจากตอนระบบรองรับ PLC เดียว) ให้ผูกกับ PLC ตัวแรกเป็นค่าเริ่มต้น
    เพื่อไม่ให้หยุดอ่านค่าไปเฉย ๆ หลังอัปเกรด — แก้เป็นตัวอื่นได้จากหน้าจอ */
async function backfillSensorPlc() {
  await query(
    `UPDATE sensors SET plc_id = (SELECT id FROM plcs ORDER BY sort_order, id LIMIT 1)
      WHERE plc_id IS NULL AND modbus_address IS NOT NULL`
  );
}

/** ผู้ดูแลระบบตั้ง MongoDB Atlas ไว้แล้วสำหรับบ่อ 600Q (Tank600Q.Level Water) — เติม default ให้
    เฉพาะตอนที่ยังไม่เคยตั้งจากหน้าเว็บ เพื่อไม่ต้องพิมพ์ซ้ำตอนเปิดใช้ "แหล่งข้อมูล: MongoDB Atlas" ครั้งแรก */
async function backfillMongoDefaults() {
  await query(
    `UPDATE sensors SET mongo_db = 'Tank600Q', mongo_collection = 'Level Water'
      WHERE tag IN ('LT-600Q','FT-600Q') AND mongo_db IS NULL AND mongo_collection IS NULL`
  );
}

/** ระบบเดิมรองรับ MongoDB Atlas คลัสเตอร์เดียวจาก MONGODB_URI ใน .env — ย้ายมาเป็นบัญชีแรกใน
    mongo_accounts ให้อัตโนมัติครั้งเดียวตอนอัปเกรด (ตาราง mongo_accounts ยังว่างอยู่) จากนั้นเพิ่ม/แก้/ลบ
    บัญชีอื่นได้จากหน้าเว็บโดยตรง ไม่ต้องแก้ .env อีก */
async function backfillMongoAccountFromEnv() {
  if (config.mongo.uri) {
    const { rows: existing } = await query(`SELECT count(*)::int AS n FROM mongo_accounts`);
    if (existing[0].n === 0) {
      await query(
        `INSERT INTO mongo_accounts (name, uri, is_active, sort_order) VALUES ($1,$2,TRUE,1)`,
        ["MongoDB Atlas", config.mongo.uri]
      );
    }
  }
  // จุดวัดเก่าที่ยังไม่เคยเลือกบัญชี (มาจากตอนระบบรองรับ MongoDB คลัสเตอร์เดียว) ให้ผูกกับบัญชีแรกเป็นค่าเริ่มต้น
  // เพื่อไม่ให้หยุดอ่านค่าไปเฉย ๆ หลังอัปเกรด — แก้เป็นบัญชีอื่นได้จากหน้าจอ (รันซ้ำได้ทุกครั้งที่ seed เหมือน backfillSensorPlc ด้านบน)
  await query(
    `UPDATE sensors SET mongo_account_id = (SELECT id FROM mongo_accounts ORDER BY sort_order, id LIMIT 1)
      WHERE data_source='mongodb' AND mongo_account_id IS NULL
        AND EXISTS (SELECT 1 FROM mongo_accounts)`
  );
}

async function upsertSensors() {
  for (const s of SENSORS) {
    // setpoint และการตั้งค่า Modbus ที่แก้ไว้จากหน้าจอต้องไม่ถูกเขียนทับตอน seed ซ้ำ
    // จึงอัปเดตเฉพาะข้อมูลนิยาม ส่วน address เติมให้เฉพาะตอนที่ยังว่างอยู่จริง ๆ "และ" ยังใช้แหล่งข้อมูลเป็น modbus อยู่
    // (address เป็น null ได้สองแบบ: ยังไม่เคยตั้ง กับตั้งใจเคลียร์ทิ้งเพราะสลับไปใช้แหล่งอื่นแล้ว เช่น MongoDB — ต้องไม่ไปเติมคืนให้แบบหลัง)
    await query(
      `INSERT INTO sensors (tag, pond_id, name, metric, unit, range_min, range_max,
                            ll, hh, ll_critical, hh_critical, decimals, sort_order,
                            modbus_address, modbus_scale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (tag) DO UPDATE SET
         pond_id=EXCLUDED.pond_id, name=EXCLUDED.name, metric=EXCLUDED.metric,
         unit=EXCLUDED.unit, range_min=EXCLUDED.range_min, range_max=EXCLUDED.range_max,
         decimals=EXCLUDED.decimals, sort_order=EXCLUDED.sort_order,
         modbus_address=CASE WHEN sensors.data_source = 'modbus'
                             THEN COALESCE(sensors.modbus_address, EXCLUDED.modbus_address)
                             ELSE sensors.modbus_address END,
         modbus_scale=CASE WHEN sensors.data_source = 'modbus' AND sensors.modbus_address IS NULL
                           THEN EXCLUDED.modbus_scale ELSE sensors.modbus_scale END`,
      [s.tag, s.pond_id, s.name, s.metric, s.unit, s.range_min, s.range_max,
       s.ll, s.hh, s.ll_critical, s.hh_critical, s.decimals, s.sort_order,
       s.modbus_address ?? null, s.modbus_scale ?? 1]
    );
  }
}

async function upsertEmployees() {
  for (const e of EMPLOYEES) {
    await query(
      `INSERT INTO employees (emp_code, full_name, position, department, role, is_admin)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (emp_code) DO NOTHING`,
      [e.emp_code, e.full_name, e.position, e.department, e.role, e.is_admin]
    );
  }
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }

  // รหัส Admin ตั้งต้นจาก Product.md ข้อ 3.4 เก็บเป็น hash ไม่ใช่ข้อความธรรมดา
  const existing = await query(`SELECT 1 FROM app_settings WHERE key='admin.code_hashes'`);
  if (existing.rows.length === 0) {
    const hashes = await Promise.all(["Admin173", "Admin1173"].map(hashSecret));
    await query(`INSERT INTO app_settings (key, value) VALUES ('admin.code_hashes', $1::jsonb)`, [
      JSON.stringify(hashes),
    ]);
  }
}

export async function seed() {
  await upsertPonds();
  await upsertPlcs();
  await upsertSensors();
  await backfillSensorPlc();
  await backfillMongoDefaults();
  await backfillMongoAccountFromEnv();
  await upsertEmployees();
  await seedSettings();
}
