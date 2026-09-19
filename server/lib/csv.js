/**
 * สร้างไฟล์ CSV ตามข้อกำหนดข้อ 6
 *   - UTF-8 with BOM เพื่อให้ Excel ภาษาไทยอ่านได้ถูกต้อง
 *   - คั่นด้วยคอมมา ขึ้นบรรทัดใหม่แบบ CRLF
 *   - วันเวลาเป็น ISO 8601 พร้อม timezone +07:00
 */

const BOM = "﻿";

function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // ป้องกัน CSV injection เมื่อเปิดใน Excel
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** แปลงเวลาเป็น ISO 8601 โซนเวลาไทย เช่น 2026-09-07T14:32:00+07:00 */
export function isoBangkok(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const shifted = new Date(d.getTime() + 7 * 3600 * 1000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+07:00");
}

export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return BOM + lines.join("\r\n") + "\r\n";
}

/** water_readings_20260801_20260907.csv */
export function csvFilename(prefix, from, to) {
  const stamp = (d) => isoBangkok(d).slice(0, 10).replace(/-/g, "");
  return `${prefix}_${stamp(from)}_${stamp(to)}.csv`;
}
