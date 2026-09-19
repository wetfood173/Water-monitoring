import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound, conflict } from "../lib/http.js";
import { requireAdmin, ROLE_RANK } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { revokeSessionsFor } from "../middleware/session.js";

export const router = Router();

const SELECT_EMPLOYEE = `
  SELECT e.emp_code, e.full_name, e.position, e.department, e.role,
         e.is_admin, e.is_active, e.created_at, e.updated_at,
         l.line_user_id, l.display_name AS line_display_name,
         l.is_oa_friend, l.notify_enabled, l.linked_at, l.last_login_at
    FROM employees e
    LEFT JOIN user_line_links l ON l.emp_code = e.emp_code
`;

router.get(
  "/api/employees",
  requireAdmin,
  wrap(async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.q) {
      params.push(`%${String(req.query.q).trim()}%`);
      where.push(`(e.emp_code ILIKE $${params.length} OR e.full_name ILIKE $${params.length})`);
    }
    if (req.query.role) {
      params.push(String(req.query.role));
      where.push(`e.role = $${params.length}`);
    }
    if (req.query.department) {
      params.push(String(req.query.department));
      where.push(`e.department = $${params.length}`);
    }
    if (req.query.status === "active") where.push("e.is_active = TRUE");
    else if (req.query.status === "inactive") where.push("e.is_active = FALSE");
    if (req.query.linked === "yes") where.push("l.line_user_id IS NOT NULL");
    else if (req.query.linked === "no") where.push("l.line_user_id IS NULL");

    const rows = await many(
      `${SELECT_EMPLOYEE} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY e.emp_code`,
      params
    );
    const departments = await many(
      `SELECT DISTINCT department FROM employees WHERE department IS NOT NULL ORDER BY department`
    );
    res.json({ employees: rows, departments: departments.map((d) => d.department) });
  })
);

function validateEmployee(body, { partial = false } = {}) {
  const out = {};
  const need = (field) => !partial || field in body;

  if (need("emp_code") && !partial) {
    const code = String(body.emp_code ?? "").trim();
    if (!/^\d{7}$/.test(code)) throw badRequest("รหัสพนักงานต้องเป็นตัวเลข 7 หลัก");
    out.emp_code = code;
  }
  if (need("full_name")) {
    const name = String(body.full_name ?? "").trim();
    if (!name) throw badRequest("ต้องระบุชื่อ-นามสกุล");
    out.full_name = name;
  }
  if (need("position")) out.position = body.position ? String(body.position).trim() : null;
  if (need("department")) out.department = body.department ? String(body.department).trim() : null;
  if (need("role")) {
    const role = String(body.role ?? "");
    if (!(role in ROLE_RANK)) throw badRequest("ระดับสิทธิ์ไม่ถูกต้อง");
    out.role = role;
  }
  if ("is_admin" in body) out.is_admin = Boolean(body.is_admin);
  if ("is_active" in body) out.is_active = Boolean(body.is_active);
  return out;
}

router.post(
  "/api/employees",
  requireAdmin,
  wrap(async (req, res) => {
    const data = validateEmployee(req.body);
    const exists = await one(`SELECT emp_code FROM employees WHERE emp_code=$1`, [data.emp_code]);
    if (exists) throw conflict("มีรหัสพนักงานนี้ในระบบแล้ว");

    await query(
      `INSERT INTO employees (emp_code, full_name, position, department, role, is_admin, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        data.emp_code,
        data.full_name,
        data.position ?? null,
        data.department ?? null,
        data.role,
        data.is_admin ?? false,
        data.is_active ?? true,
      ]
    );
    await audit(req, { action: "employee.create", target: data.emp_code, newValue: data });
    const row = await one(`${SELECT_EMPLOYEE} WHERE e.emp_code=$1`, [data.emp_code]);
    res.status(201).json({ ok: true, employee: row });
  })
);

router.patch(
  "/api/employees/:code",
  requireAdmin,
  wrap(async (req, res) => {
    const code = String(req.params.code);
    const before = await one(`SELECT * FROM employees WHERE emp_code=$1`, [code]);
    if (!before) throw notFound("ไม่พบพนักงานคนนี้");

    const patch = validateEmployee(req.body, { partial: true });
    if (!Object.keys(patch).length) throw badRequest("ไม่มีข้อมูลที่จะแก้ไข");

    // กันไม่ให้ผู้ดูแลถอดสิทธิ์ตัวเองจนไม่มีใครเข้าโหมด admin ได้
    if (code === req.user.emp_code && patch.is_admin === false && before.is_admin) {
      const others = await one(
        `SELECT count(*)::int AS n FROM employees
          WHERE is_active AND emp_code <> $1 AND (is_admin OR role='admin')`,
        [code]
      );
      if (!others?.n) throw badRequest("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งคน");
    }

    const cols = Object.keys(patch);
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
    await query(`UPDATE employees SET ${sets}, updated_at = now() WHERE emp_code = $1`, [
      code,
      ...cols.map((c) => patch[c]),
    ]);

    // ปิดใช้งานแล้วต้องออกจากระบบทันที ไม่รอ session หมดอายุ (ข้อ 3.3)
    if (patch.is_active === false) await revokeSessionsFor(code);

    await audit(req, {
      action: "employee.update",
      target: code,
      oldValue: Object.fromEntries(cols.map((c) => [c, before[c]])),
      newValue: patch,
    });
    const row = await one(`${SELECT_EMPLOYEE} WHERE e.emp_code=$1`, [code]);
    res.json({ ok: true, employee: row });
  })
);

/* ยกเลิกการผูก LINE เพื่อให้ผูกใหม่ได้ (ข้อ 4 หน้าจัดการพนักงาน) */
router.delete(
  "/api/employees/:code/line-link",
  requireAdmin,
  wrap(async (req, res) => {
    const code = String(req.params.code);
    const link = await one(`SELECT * FROM user_line_links WHERE emp_code=$1`, [code]);
    if (!link) throw notFound("พนักงานคนนี้ยังไม่ได้ผูกบัญชี LINE");

    await query(`DELETE FROM user_line_links WHERE emp_code=$1`, [code]);
    await revokeSessionsFor(code);
    await audit(req, {
      action: "employee.unlink_line",
      target: code,
      oldValue: { line_user_id: link.line_user_id, display_name: link.display_name },
    });
    res.json({ ok: true });
  })
);

/**
 * ลบพนักงานถาวร — ปกติแนะนำให้ "ปิดใช้งาน" แทน (ข้อ 7 การจัดการข้อมูล) เพื่อไม่ให้ audit_log /
 * ประวัติรับทราบแจ้งเตือนขาดการอ้างอิง เส้นทางนี้มีไว้สำหรับกรณีที่แอดมินยืนยันแล้วว่าต้องการลบถาวรจริง ๆ
 * (เช่น บัญชีทดสอบ) — ลบ session/การผูก LINE ที่เป็นสถานะปัจจุบันให้ก่อน ส่วนตารางประวัติ
 * (alarms.acked_by, notification_log, export_log) ปล่อยให้ foreign key กันไว้ ถ้ามีประวัติอยู่จริง
 * จะลบไม่ได้และแจ้งเหตุผลกลับไป แทนที่จะเงียบ ๆ ไปลบ/ล้างประวัติเหล่านั้นทิ้งโดยไม่ถาม
 */
router.delete(
  "/api/employees/:code",
  requireAdmin,
  wrap(async (req, res) => {
    const code = String(req.params.code);
    const before = await one(`SELECT * FROM employees WHERE emp_code=$1`, [code]);
    if (!before) throw notFound("ไม่พบพนักงานคนนี้");

    // กันไม่ให้ลบผู้ดูแลระบบคนสุดท้ายที่ใช้งานได้ (เหมือนกฎตอนถอดสิทธิ์ admin ใน PATCH)
    if (before.is_admin || before.role === "admin") {
      const others = await one(
        `SELECT count(*)::int AS n FROM employees
          WHERE is_active AND emp_code <> $1 AND (is_admin OR role='admin')`,
        [code]
      );
      if (!others?.n) throw badRequest("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งคน");
    }

    // ลบเฉพาะสถานะปัจจุบัน (ไม่ใช่ประวัติ) ก่อน — session ที่ล็อกอินค้าง และการผูก LINE
    await query(`DELETE FROM sessions WHERE emp_code=$1`, [code]);
    await query(`DELETE FROM user_line_links WHERE emp_code=$1`, [code]);

    try {
      await query(`DELETE FROM employees WHERE emp_code=$1`, [code]);
    } catch (err) {
      if (err.code === "23503") {
        throw conflict(
          "ลบไม่ได้ — พนักงานคนนี้มีประวัติอ้างอิงอยู่ (เช่น เคยรับทราบแจ้งเตือน หรือเคยได้รับ/ส่ง LINE แจ้งเตือน หรือเคย export ข้อมูล) การลบถาวรจะทำให้ประวัตินั้นขาดการอ้างอิง แนะนำให้ปิดใช้งานแทน"
        );
      }
      throw err;
    }

    await audit(req, { action: "employee.delete", target: code, oldValue: before });
    res.json({ ok: true });
  })
);

/* นำเข้ารายชื่อจาก CSV — เพิ่มคนใหม่และอัปเดตคนเดิม ไม่ลบใคร */
router.post(
  "/api/employees/import",
  requireAdmin,
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) throw badRequest("ต้องส่ง rows[] ที่แปลงจากไฟล์ CSV แล้ว");
    if (rows.length > 2000) throw badRequest("นำเข้าได้ครั้งละไม่เกิน 2000 แถว");

    const result = { created: 0, updated: 0, errors: [] };
    for (const [i, raw] of rows.entries()) {
      try {
        const data = validateEmployee(raw);
        const exists = await one(`SELECT emp_code FROM employees WHERE emp_code=$1`, [data.emp_code]);
        if (exists) {
          await query(
            `UPDATE employees SET full_name=$2, position=$3, department=$4, role=$5,
                                  is_admin=COALESCE($6, is_admin), updated_at=now()
              WHERE emp_code=$1`,
            [data.emp_code, data.full_name, data.position ?? null, data.department ?? null,
             data.role, "is_admin" in raw ? data.is_admin : null]
          );
          result.updated++;
        } else {
          await query(
            `INSERT INTO employees (emp_code, full_name, position, department, role, is_admin)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [data.emp_code, data.full_name, data.position ?? null, data.department ?? null,
             data.role, data.is_admin ?? false]
          );
          result.created++;
        }
      } catch (err) {
        result.errors.push({ row: i + 1, message: err.message });
      }
    }
    await audit(req, { action: "employee.import", newValue: result });
    res.json(result);
  })
);
