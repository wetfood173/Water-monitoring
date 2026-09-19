import { many } from "../db/index.js";

let cache = null;

export async function getSensors() {
  if (!cache) {
    const rows = await many(
      `SELECT s.*, p.name AS pond_name, p.capacity_m3
         FROM sensors s LEFT JOIN ponds p ON p.pond_id = s.pond_id
        ORDER BY s.sort_order, s.tag`
    );
    cache = new Map(rows.map((r) => [r.tag, r]));
  }
  return cache;
}

export async function getSensor(tag) {
  return (await getSensors()).get(tag) ?? null;
}

export async function activeSensors() {
  return [...(await getSensors()).values()].filter((s) => s.is_active);
}

export function invalidateSensors() {
  cache = null;
}
