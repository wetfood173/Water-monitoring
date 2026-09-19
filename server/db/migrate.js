import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, query, exec, close, backend } from "./index.js";
import { seed } from "./seed.js";
import { config } from "../config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const pad = (n) => String(n).padStart(2, "0");
const monthStart = (y, m) => `${y}-${pad(m + 1)}-01T00:00:00Z`;

/**
 * สร้าง partition รายเดือนของ readings ล่วงหน้า
 * เรียกตอนบูตและวันละครั้ง เพื่อไม่ให้ insert ล้มเมื่อขึ้นเดือนใหม่
 */
export async function ensurePartitions({ monthsBack = 1, monthsAhead = 3 } = {}) {
  const now = new Date();
  for (let offset = -monthsBack; offset <= monthsAhead; offset++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth();
    const name = `readings_${y}_${pad(m + 1)}`;
    await exec(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF readings
       FOR VALUES FROM ('${monthStart(y, m)}') TO ('${monthStart(
         m === 11 ? y + 1 : y,
         m === 11 ? 0 : m + 1
       )}')`
    );
  }
}

/** ลบ partition ที่เก่ากว่าระยะเก็บข้อมูลดิบที่ตั้งไว้ */
export async function dropExpiredPartitions(retentionMonths) {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  const { rows } = await query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'readings' AND c.relname ~ '^readings_[0-9]{4}_[0-9]{2}$'`
  );
  const dropped = [];
  for (const { name } of rows) {
    const [, y, m] = name.match(/^readings_(\d{4})_(\d{2})$/);
    const end = new Date(Date.UTC(Number(y), Number(m), 1));
    if (end <= cutoff) {
      await exec(`DROP TABLE IF EXISTS ${name}`);
      dropped.push(name);
    }
  }
  return dropped;
}

/**
 * ลบข้อมูลดิบที่เก่ากว่า N วัน ให้ readings เหลือแค่ข้อมูลล่าสุดตามที่ตั้งไว้ (retention.raw_days)
 * ทำงานคู่กับ dropExpiredPartitions — ตัวนี้ตัดแบบละเอียดถึงระดับวัน ส่วน partition drop จัดการ partition
 * เก่าที่ว่างเปล่าทิ้งอีกที ใช้ index (ts DESC) จึงไม่ต้องสแกนทั้งตาราง แม้ readings จะมีหลักล้านแถว
 */
export async function trimOldReadings(days) {
  const { rowCount } = await query(
    `DELETE FROM readings WHERE ts < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return rowCount ?? 0;
}

export async function migrate({ withSeed = true } = {}) {
  const sql = fs.readFileSync(path.join(HERE, "schema.sql"), "utf8");
  await exec(sql);
  await ensurePartitions();
  if (withSeed) await seed();
}

async function reset() {
  const tables = [
    "notification_log", "export_log", "audit_log", "alarms", "readings_hourly",
    "readings", "sessions", "user_line_links", "sensors", "ponds", "employees", "app_settings",
  ];
  await exec(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
}

// รันตรงจาก CLI: node server/db/migrate.js [--reset] [--seed]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  await connect();
  console.log(`ฐานข้อมูล: ${backend}${backend === "pglite" ? ` (${config.pgliteDir})` : ""}`);
  if (args.includes("--reset")) {
    await reset();
    console.log("ลบตารางเดิมแล้ว");
  }
  await migrate({ withSeed: true });
  console.log("สร้าง schema และข้อมูลตั้งต้นเรียบร้อย");
  const { rows } = await query("SELECT count(*)::int AS n FROM employees");
  console.log(`พนักงานในระบบ: ${rows[0].n} คน`);
  await close();
}
