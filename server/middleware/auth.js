import { unauthorized, forbidden } from "../lib/http.js";

export const ROLE_RANK = { staff: 1, technician: 2, engineer: 3, admin: 4 };

export const ROLE_LABEL = {
  staff: "พนักงาน",
  technician: "ช่างเทคนิค",
  engineer: "วิศวกร",
  admin: "ผู้ดูแลระบบ",
};

/** สิทธิ์ที่มีผลจริง = สิทธิ์ตามตำแหน่ง หรือ admin ชั่วคราวจากการยืนยันรหัส Admin */
export function effectiveRole(user, session) {
  if (!user) return null;
  if (user.role === "admin") return "admin";
  if (session?.adminActive) return "admin";
  return user.role;
}

export function hasRole(user, session, minimum) {
  const role = effectiveRole(user, session);
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.session?.pendingLink) {
    return next(forbidden("ยังไม่ได้ผูกรหัสพนักงาน", "LINK_REQUIRED"));
  }
  next();
}

/** ตรวจสิทธิ์ขั้นต่ำที่ฝั่งเซิร์ฟเวอร์ — การซ่อนปุ่มบนหน้าจอไม่ใช่การรักษาความปลอดภัย (ข้อ 8) */
export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.session?.pendingLink) {
      return next(forbidden("ยังไม่ได้ผูกรหัสพนักงาน", "LINK_REQUIRED"));
    }
    if (!hasRole(req.user, req.session, minimum)) {
      return next(forbidden(`ต้องมีสิทธิ์ระดับ ${ROLE_LABEL[minimum]} ขึ้นไป`));
    }
    next();
  };
}

export const requireAdmin = requireRole("admin");
