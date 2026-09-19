import { query } from "../db/index.js";
import { clientIp } from "./http.js";

/**
 * บันทึกลง audit_log — ใครทำอะไร กับอะไร จากค่าเดิมเป็นค่าใหม่ เมื่อไหร่
 * ตั้งใจไม่ throw ต่อ เพราะการเขียน log ล้มไม่ควรทำให้งานหลักล้มตาม
 */
export async function audit(req, { action, target = null, oldValue = null, newValue = null, empCode }) {
  const emp = empCode ?? req?.user?.emp_code ?? null;
  try {
    await query(
      `INSERT INTO audit_log (emp_code, action, target, old_value, new_value, ip_address)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
      [
        emp,
        action,
        target,
        oldValue === null ? null : JSON.stringify(oldValue),
        newValue === null ? null : JSON.stringify(newValue),
        req ? clientIp(req) : null,
      ]
    );
  } catch (err) {
    console.error("[audit] เขียน audit_log ไม่สำเร็จ:", err.message);
  }
}
