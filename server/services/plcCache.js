import { many } from "../db/index.js";

let cache = null;

export async function getPlcs() {
  if (!cache) {
    const rows = await many(`SELECT * FROM plcs ORDER BY sort_order, id`);
    cache = new Map(rows.map((r) => [r.id, r]));
  }
  return cache;
}

export async function getPlc(id) {
  return (await getPlcs()).get(id) ?? null;
}

export async function activePlcs() {
  return [...(await getPlcs()).values()].filter((p) => p.is_active);
}

export function invalidatePlcs() {
  cache = null;
}
