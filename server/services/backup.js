import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import { backup as dbBackup } from "../db/index.js";
import { uploadBackupToCloud } from "./backupCloud.js";

/**
 * สำรองข้อมูลรายวัน (Product.md ข้อ 7) — เรียก dbBackup() ซึ่งดึง snapshot จากในตัว process
 * ของ PGlite เอง (ไม่เปิด connection/process ที่สองมาแตะ data dir พร้อมกัน ป้องกันข้อมูลเสียหาย
 * แบบที่เคยเจอมาแล้วตอนรัน migrate script แยกทั้งที่เซิร์ฟเวอร์ยังรันอยู่)
 *
 * เก็บไว้ที่ data/backups/backup-YYYYMMDD-HHMMSS.tar.gz แล้วลบไฟล์เก่าเกิน KEEP ไฟล์ล่าสุดทิ้ง
 * ทดสอบกู้คืนได้ด้วย server/db/restore.js (Product.md ข้อ 7 — ทดสอบกู้คืนอย่างน้อยไตรมาสละครั้ง)
 *
 * ถ้าตั้งค่า R2_* ไว้ใน .env จะอัปโหลดสำเนาขึ้น Cloudflare R2 ต่อทันที กันกรณีเครื่อง/ดิสก์
 * ที่รันเซิร์ฟเวอร์เสียหายพร้อมกับไฟล์ backup ในเครื่อง — อัปโหลดไม่สำเร็จก็ไม่ทำให้ backup
 * ในเครื่องเสียตาม แค่ log error ไว้เตือน
 */

export const BACKUP_DIR = path.join(ROOT, "data", "backups");
const KEEP = 14;

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes()
  )}${pad(d.getUTCSeconds())}`;

/** รันสำรองข้อมูลหนึ่งครั้ง คืนชื่อไฟล์ที่สร้าง หรือ null ถ้า backend ปัจจุบันไม่รองรับ (เช่น PostgreSQL จริง) */
export async function runBackup() {
  const buf = await dbBackup();
  if (!buf) return null;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `backup-${stamp(new Date())}.tar.gz`;
  fs.writeFileSync(path.join(BACKUP_DIR, name), buf);

  await pruneOldBackups();

  try {
    await uploadBackupToCloud(name, buf);
  } catch (e) {
    console.error(`[backup] อัปโหลดขึ้น cloud ไม่สำเร็จ (${name}):`, e.message);
  }

  return name;
}

async function pruneOldBackups() {
  const files = (await listBackups()).slice(KEEP);
  for (const f of files) fs.rmSync(path.join(BACKUP_DIR, f.name), { force: true });
}

/** รายชื่อไฟล์สำรอง เรียงใหม่สุดก่อน */
export async function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((name) => {
      const { size, mtime } = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size, createdAt: mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
