import { many } from "../db/index.js";

let cache = null;

export async function getMongoAccounts() {
  if (!cache) {
    const rows = await many(`SELECT * FROM mongo_accounts ORDER BY sort_order, id`);
    cache = new Map(rows.map((r) => [r.id, r]));
  }
  return cache;
}

export async function getMongoAccount(id) {
  return (await getMongoAccounts()).get(id) ?? null;
}

export async function activeMongoAccounts() {
  return [...(await getMongoAccounts()).values()].filter((a) => a.is_active);
}

export function invalidateMongoAccounts() {
  cache = null;
}
