import { query, one } from "../db/index.js";
import { DEFAULT_SETTINGS } from "../db/seed.js";

const cache = new Map();

export async function getSetting(key) {
  if (cache.has(key)) return cache.get(key);
  const row = await one(`SELECT value FROM app_settings WHERE key=$1`, [key]);
  const value = row ? row.value : (DEFAULT_SETTINGS[key] ?? null);
  cache.set(key, value);
  return value;
}

export async function setSetting(key, value, empCode = null) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1,$2::jsonb, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [key, JSON.stringify(value), empCode]
  );
  cache.set(key, value);
}

export function invalidateSettings() {
  cache.clear();
}

/** ค่าตั้งทั้งหมดที่ปลอดภัยต่อการแสดงบนหน้า admin (ไม่รวม hash รหัส Admin) */
export async function getPublicSettings() {
  const { rows } = await query(`SELECT key, value, updated_at, updated_by FROM app_settings ORDER BY key`);
  return rows.filter((r) => !r.key.startsWith("admin.code"));
}
