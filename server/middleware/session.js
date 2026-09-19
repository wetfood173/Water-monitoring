import crypto from "node:crypto";
import { config } from "../config.js";
import { query, one } from "../db/index.js";
import { clientIp } from "../lib/http.js";

const COOKIE = config.session.cookieName;

function sign(sid) {
  return crypto.createHmac("sha256", config.sessionSecret).update(sid).digest("base64url");
}

function encode(sid) {
  return `${sid}.${sign(sid)}`;
}

function decode(raw) {
  if (typeof raw !== "string") return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const sid = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(sid);
  if (mac.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? sid : null;
}

const IDLE_MS = config.session.idleDays * 24 * 3600 * 1000;

// ไม่เขียน DB ทุก request — เลื่อนวันหมดอายุเมื่อผ่านไปแล้วอย่างน้อย 1 ชั่วโมงนับจากครั้งก่อน
// หน้าจอเฝ้าระวังยิง API ทุกไม่กี่วินาที ถ้าเลื่อนทุกครั้งจะกลายเป็น UPDATE รัวใส่ PGlite
// ผลข้างเคียงที่ยอมรับได้: เวลาหลุดจริงอยู่ระหว่าง 30 วัน ถึง 30 วันลบ 1 ชั่วโมง
// กัน IDLE_MS ที่สั้นกว่า 2 ชั่วโมง (ตั้งค่าผิดหรือใช้ทดสอบ) ไม่ให้เงื่อนไขเลื่อนเป็นจริงไม่ได้เลย
const SLIDE_AFTER_MS = Math.min(3600 * 1000, Math.floor(IDLE_MS / 2));

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: IDLE_MS,
  };
}

export async function createSession(res, req, { empCode = null, lineUserId = null, pendingLink = false }) {
  const sid = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + IDLE_MS);
  await query(
    `INSERT INTO sessions (sid, emp_code, line_user_id, pending_link, ip_address, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sid, empCode, lineUserId, pendingLink, clientIp(req), req.headers["user-agent"] || null, expires]
  );
  res.cookie(COOKIE, encode(sid), cookieOptions());
  return sid;
}

export async function destroySession(res, sid) {
  if (sid) await query(`DELETE FROM sessions WHERE sid=$1`, [sid]);
  res.clearCookie(COOKIE, { path: "/" });
}

/** ผูกรหัสพนักงานเข้ากับ session ที่รอผูกอยู่ */
export async function attachEmployee(sid, empCode) {
  await query(`UPDATE sessions SET emp_code=$1, pending_link=FALSE WHERE sid=$2`, [empCode, sid]);
}

export async function elevateAdmin(sid) {
  const until = new Date(Date.now() + config.session.adminIdleMinutes * 60 * 1000);
  await query(`UPDATE sessions SET admin_until=$1 WHERE sid=$2`, [until, sid]);
  return until;
}

export async function revokeSessionsFor(empCode) {
  await query(`DELETE FROM sessions WHERE emp_code=$1`, [empCode]);
}

/**
 * อ่าน session จาก cookie แล้วแนบ req.session / req.user
 * ต่ออายุแบบ idle สองชั้น:
 *   - session: ทุกการใช้งานเลื่อนวันหมดอายุออกไปอีก 30 วัน
 *   - สิทธิ์ admin: ทุกครั้งที่ยังอยู่ในช่วง 30 นาที จะเลื่อนเวลาออกไปอีก 30 นาที
 */
export async function loadSession(req, res, next) {
  req.session = null;
  req.user = null;
  try {
    const sid = decode(req.cookies?.[COOKIE]);
    if (!sid) return next();

    const row = await one(
      `SELECT s.sid, s.emp_code, s.line_user_id, s.pending_link, s.admin_until, s.expires_at,
              e.full_name, e.position, e.department, e.role, e.is_admin, e.is_active,
              l.line_user_id AS linked_line_id, l.display_name, l.is_oa_friend, l.notify_enabled
         FROM sessions s
         LEFT JOIN employees e ON e.emp_code = s.emp_code
         LEFT JOIN user_line_links l ON l.emp_code = s.emp_code
        WHERE s.sid = $1`,
      [sid]
    );

    if (!row) return next();
    if (new Date(row.expires_at) <= new Date()) {
      await query(`DELETE FROM sessions WHERE sid=$1`, [sid]);
      res.clearCookie(COOKIE, { path: "/" });
      return next();
    }
    // พนักงานที่ถูกปิดใช้งานต้องใช้งานต่อไม่ได้ แม้ session ยังไม่หมดอายุ (ข้อ 3.3)
    if (row.emp_code && row.is_active === false) {
      await query(`DELETE FROM sessions WHERE sid=$1`, [sid]);
      res.clearCookie(COOKIE, { path: "/" });
      return next();
    }

    const now = Date.now();
    let adminActive = false;
    if (row.admin_until && new Date(row.admin_until).getTime() > now) {
      adminActive = true;
      const until = new Date(now + config.session.adminIdleMinutes * 60 * 1000);
      await query(`UPDATE sessions SET admin_until=$1 WHERE sid=$2`, [until, sid]);
      row.admin_until = until;
    } else if (row.admin_until) {
      await query(`UPDATE sessions SET admin_until=NULL WHERE sid=$1`, [sid]);
      row.admin_until = null;
    }

    // เลื่อนวันหมดอายุออกไปอีก 30 วันนับจากการใช้งานครั้งนี้ ทั้งฝั่ง DB และ cookie
    if (new Date(row.expires_at).getTime() - now < IDLE_MS - SLIDE_AFTER_MS) {
      const expires = new Date(now + IDLE_MS);
      await query(`UPDATE sessions SET expires_at=$1 WHERE sid=$2`, [expires, sid]);
      row.expires_at = expires;
      res.cookie(COOKIE, encode(sid), cookieOptions());
    }

    req.session = {
      sid,
      pendingLink: row.pending_link,
      lineUserId: row.line_user_id,
      adminActive,
      adminUntil: adminActive ? row.admin_until : null,
      expiresAt: row.expires_at,
    };

    if (row.emp_code) {
      req.user = {
        emp_code: row.emp_code,
        full_name: row.full_name,
        position: row.position,
        department: row.department,
        role: row.role,
        is_admin: row.is_admin,
        display_name: row.display_name,
        is_oa_friend: row.is_oa_friend ?? false,
        notify_enabled: row.notify_enabled ?? true,
        line_linked: Boolean(row.linked_line_id),
        adminActive,
      };
    }
  } catch (err) {
    console.error("[session] อ่าน session ไม่สำเร็จ:", err.message);
  }
  next();
}

/** ลบ session ที่หมดอายุ เรียกเป็นระยะจาก scheduler */
export async function purgeExpiredSessions() {
  const res = await query(`DELETE FROM sessions WHERE expires_at <= now()`);
  return res.rowCount ?? res.affectedRows ?? 0;
}
