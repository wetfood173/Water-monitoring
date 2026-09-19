import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

/** สร้าง hash รูปแบบ scrypt$N$r$p$salt$key (base64url) */
export async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain.normalize("NFKC"), salt, KEYLEN, { N, r, p });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** ตรวจรหัสกับ hash แบบเทียบเวลาคงที่ */
export async function verifySecret(plain, stored) {
  try {
    const [scheme, sN, sr, sp, salt, key] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(key, "base64url");
    const actual = await scrypt(plain.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
      N: Number(sN),
      r: Number(sr),
      p: Number(sp),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
