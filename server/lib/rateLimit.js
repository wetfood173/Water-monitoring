/**
 * ตัวนับความพยายามแบบ sliding window เก็บในหน่วยความจำ
 * ใช้กับการผูกรหัสพนักงานและการยืนยันรหัส Admin (Product.md ข้อ 3.4, 10)
 * ถ้าขยายเป็นหลาย instance ต้องย้ายไปเก็บใน Redis หรือฐานข้อมูลแทน
 */
export function createLimiter({ max, windowMs, blockMs }) {
  const hits = new Map();

  const prune = (now) => {
    for (const [key, entry] of hits) {
      if (entry.blockedUntil > now) continue;
      entry.stamps = entry.stamps.filter((t) => now - t < windowMs);
      if (!entry.stamps.length) hits.delete(key);
    }
  };

  return {
    /** คืนจำนวนวินาทีที่ยังถูกระงับ หรือ 0 ถ้ายังใช้ได้ */
    check(key) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry) return 0;
      if (entry.blockedUntil > now) return Math.ceil((entry.blockedUntil - now) / 1000);
      return 0;
    },
    /** บันทึกความพยายามที่ล้มเหลว คืน true ถ้าทำให้ถูกระงับ */
    fail(key) {
      const now = Date.now();
      prune(now);
      const entry = hits.get(key) || { stamps: [], blockedUntil: 0 };
      entry.stamps = entry.stamps.filter((t) => now - t < windowMs);
      entry.stamps.push(now);
      if (entry.stamps.length >= max) {
        entry.blockedUntil = now + blockMs;
        entry.stamps = [];
      }
      hits.set(key, entry);
      return entry.blockedUntil > now;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
