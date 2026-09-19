import fs from "node:fs";
import { config } from "../config.js";

/**
 * ชั้นเข้าถึงฐานข้อมูล
 *
 * ใช้ SQL ของ PostgreSQL ล้วน ๆ ทั้งระบบ แล้วเลือก driver ตอนรัน
 *   - มี DATABASE_URL  → node-postgres ต่อ PostgreSQL จริง
 *   - ไม่มี            → PGlite (PostgreSQL คอมไพล์เป็น WASM รันในตัวแอป)
 * ทั้งสองตัวใช้ placeholder $1 $2 เหมือนกัน โค้ดเรียกใช้จึงเขียนครั้งเดียว
 */

let driver = null;
export let backend = config.databaseUrl ? "postgres" : "pglite";

async function initPostgres() {
  const { default: pg } = await import("pg");
  // ให้ NUMERIC กลับมาเป็น number แทน string เพื่อให้ JSON ฝั่ง client ใช้ได้ทันที
  pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  await pool.query("SELECT 1");
  return {
    query: (text, params) => pool.query(text, params),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (t, p) => client.query(t, p) });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    // ยังไม่รองรับ backup อัตโนมัติสำหรับ PostgreSQL จริง — ใช้ pg_dump/pg_basebackup ของระบบแทน
    backup: async () => null,
  };
}

async function initPglite() {
  const { PGlite } = await import("@electric-sql/pglite");
  fs.mkdirSync(config.pgliteDir, { recursive: true });
  const pg = await PGlite.create({ dataDir: config.pgliteDir });
  const toNumbers = (result) => {
    if (!result?.rows?.length || !result.fields) return result;
    // PGlite คืน NUMERIC/BIGINT เป็น string เช่นเดียวกับ pg — แปลงให้ตรงกัน
    const numeric = result.fields
      .filter((f) => f.dataTypeID === 1700 || f.dataTypeID === 20)
      .map((f) => f.name);
    if (!numeric.length) return result;
    for (const row of result.rows) {
      for (const name of numeric) {
        if (typeof row[name] === "string") row[name] = Number(row[name]);
        else if (typeof row[name] === "bigint") row[name] = Number(row[name]);
      }
    }
    return result;
  };
  return {
    query: async (text, params) => toNumbers(await pg.query(text, params)),
    exec: (sql) => pg.exec(sql),
    transaction: (fn) =>
      pg.transaction(async (t) => fn({ query: async (s, p) => toNumbers(await t.query(s, p)) })),
    close: () => pg.close(),
    // สำรองข้อมูลจากในตัว process เดียวกันผ่าน API ของ PGlite เอง (ไม่ต้องเปิด process/connection ที่สองมาแตะไฟล์
    // data dir พร้อมกัน — เคยทำให้ฐานข้อมูลเสียหายมาแล้วเมื่อรัน migrate script แยกตอนเซิร์ฟเวอร์ยังรันอยู่)
    backup: async () => Buffer.from(await (await pg.dumpDataDir("gzip")).arrayBuffer()),
  };
}

export async function connect() {
  if (driver) return driver;
  driver = config.databaseUrl ? await initPostgres() : await initPglite();
  return driver;
}

function requireDriver() {
  if (!driver) throw new Error("ยังไม่ได้เรียก connect() ก่อนใช้ฐานข้อมูล");
  return driver;
}

export const query = (text, params) => requireDriver().query(text, params);
export const exec = (sql) => requireDriver().exec(sql);
export const transaction = (fn) => requireDriver().transaction(fn);
export const close = () => (driver ? driver.close() : Promise.resolve());
/** คืน Buffer ของไฟล์สำรอง (.tar.gz) หรือ null ถ้า backend ปัจจุบันไม่รองรับ */
export const backup = () => requireDriver().backup();

/** คืนแถวแรก หรือ null */
export async function one(text, params) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

/** คืนอาร์เรย์ของแถว */
export async function many(text, params) {
  const { rows } = await query(text, params);
  return rows;
}
