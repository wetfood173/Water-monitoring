import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { BACKUP_DIR } from "../services/backup.js";

/**
 * ทดสอบกู้คืนไฟล์สำรอง (Product.md ข้อ 7 — ทดสอบกู้คืนอย่างน้อยไตรมาสละครั้ง)
 *
 * โหลด backup ขึ้น PGlite แบบ **ในหน่วยความจำล้วน ๆ** (ไม่ระบุ dataDir) จึงไม่แตะไฟล์ใด ๆ
 * บนดิสก์เลยนอกจากอ่านไฟล์สำรองที่ให้มา — ไม่กระทบข้อมูลจริงหรือเซิร์ฟเวอร์ที่กำลังรันอยู่ไม่ว่ากรณีใด
 *
 * ใช้: node server/db/restore.js [ชื่อไฟล์ หรือ path เต็ม] (ไม่ใส่ = ใช้ backup ล่าสุด)
 */
// ตารางหลักตาม schema.sql — นับจริงด้วย count(*) แทนสถิติ pg_stat_user_tables เพราะ instance
// ที่เพิ่งโหลดจาก backup ยังไม่เคย ANALYZE จึงมี n_live_tup ค้างที่ 0 เสมอ ไม่สะท้อนข้อมูลจริง
const TABLES = [
  "employees", "user_line_links", "ponds", "plcs", "sensors", "readings",
  "readings_hourly", "alarms", "notification_log", "export_log", "audit_log",
  "app_settings", "sessions",
];

export async function verifyRestore(filePath) {
  const buf = fs.readFileSync(filePath);
  const blob = new Blob([buf]);
  const pg = await PGlite.create({ loadDataDir: blob });
  try {
    const tables = [];
    for (const name of TABLES) {
      const { rows } = await pg.query(`SELECT count(*)::int AS n FROM ${name}`);
      tables.push({ relname: name, rows: rows[0].n });
    }
    const employeeCount = tables.find((t) => t.relname === "employees")?.rows ?? 0;
    return { tables, employeeCount };
  } finally {
    await pg.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  let file;
  if (arg) {
    file = arg.includes(path.sep) || fs.existsSync(arg) ? path.resolve(arg) : path.join(BACKUP_DIR, arg);
  } else {
    const files = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".tar.gz")).sort().reverse()
      : [];
    if (!files.length) {
      console.error("ไม่พบไฟล์สำรองใน", BACKUP_DIR);
      process.exit(1);
    }
    file = path.join(BACKUP_DIR, files[0]);
  }

  console.log(`กำลังทดสอบกู้คืน: ${file}`);
  try {
    const result = await verifyRestore(file);
    console.log(`กู้คืนสำเร็จ — พนักงาน ${result.employeeCount} คน`);
    console.log("ตาราง:", result.tables.map((t) => `${t.relname}(${t.rows})`).join(", "));
    process.exit(0);
  } catch (err) {
    console.error("กู้คืนไม่สำเร็จ:", err.message);
    process.exit(1);
  }
}
