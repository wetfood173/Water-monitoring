import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { query, one } from "../db/index.js";
import { wrap, badRequest, unauthorized, forbidden, conflict, tooMany } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { verifySecret, hashSecret } from "../lib/hash.js";
import { getSetting, setSetting } from "../lib/settings.js";
import { createLimiter } from "../lib/rateLimit.js";
import { requireAuth, effectiveRole } from "../middleware/auth.js";
import {
  createSession,
  destroySession,
  attachEmployee,
  elevateAdmin,
} from "../middleware/session.js";
import * as line from "../services/lineClient.js";

export const router = Router();

const STATE_COOKIE = "wm_oauth";

// กรอกรหัส Admin ผิดเกิน 5 ครั้งใน 15 นาที → ระงับ 30 นาที (ข้อ 3.4)
const adminCodeLimiter = createLimiter({ max: 5, windowMs: 15 * 60_000, blockMs: 30 * 60_000 });
// จำกัดการเดารหัสพนักงานตอนผูกบัญชี (ข้อ 10)
const linkLimiter = createLimiter({ max: 8, windowMs: 15 * 60_000, blockMs: 30 * 60_000 });

/* ================= สถานะผู้ใช้ปัจจุบัน ================= */

router.get(
  "/api/me",
  wrap(async (req, res) => {
    if (!req.user && !req.session) {
      return res.json({ authenticated: false, devLogin: config.devLogin, lineLogin: line.lineLoginEnabled });
    }
    if (req.session?.pendingLink) {
      return res.json({
        authenticated: false,
        pendingLink: true,
        lineDisplayName: req.session.lineDisplayName ?? null,
        devLogin: config.devLogin,
        lineLogin: line.lineLoginEnabled,
      });
    }
    if (!req.user) {
      return res.json({ authenticated: false, devLogin: config.devLogin, lineLogin: line.lineLoginEnabled });
    }
    res.json({
      authenticated: true,
      user: {
        ...req.user,
        effectiveRole: effectiveRole(req.user, req.session),
        adminActive: req.session.adminActive,
        adminUntil: req.session.adminUntil,
      },
      lineMessaging: line.lineMessagingEnabled,
      addFriendUrl: config.line.addFriendUrl,
      oaQrUrl: config.line.oaQrUrl,
      sessionExpiresAt: req.session.expiresAt,
    });
  })
);

/* ================= LINE Login ================= */

router.get("/auth/line/login", (req, res) => {
  if (!line.lineLoginEnabled) {
    return res.redirect("/login?error=line_disabled");
  }
  const state = crypto.randomBytes(16).toString("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ state, nonce })).toString("base64url");
  const mac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  res.cookie(STATE_COOKIE, `${payload}.${mac}`, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(line.buildAuthorizeUrl(state, nonce));
});

router.get(
  "/auth/line/callback",
  wrap(async (req, res) => {
    const raw = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: "/" });
    if (!raw) return res.redirect("/login?error=state_missing");

    const dot = raw.lastIndexOf(".");
    const payload = raw.slice(0, dot);
    const mac = raw.slice(dot + 1);
    const expected = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
      return res.redirect("/login?error=state_invalid");
    }
    const { state, nonce } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    if (req.query.error) return res.redirect(`/login?error=${encodeURIComponent(req.query.error)}`);
    if (!req.query.code || req.query.state !== state) return res.redirect("/login?error=state_mismatch");

    let lineUserId;
    let displayName = null;
    try {
      const token = await line.exchangeCode(String(req.query.code));
      const claims = await line.verifyIdToken(token.id_token, nonce);
      lineUserId = claims.sub;
      displayName = claims.name || null;
      if (!displayName && token.access_token) {
        displayName = (await line.fetchProfile(token.access_token).catch(() => null))?.displayName ?? null;
      }
      // ไม่เก็บ access token ลงฐานข้อมูล (ข้อ 10)
    } catch (err) {
      console.error("[auth] LINE callback ล้มเหลว:", err.message);
      return res.redirect("/login?error=line_failed");
    }

    const link = await one(
      `SELECT l.emp_code, e.is_active
         FROM user_line_links l JOIN employees e ON e.emp_code = l.emp_code
        WHERE l.line_user_id = $1`,
      [lineUserId]
    );

    if (link && link.is_active === false) {
      await audit(req, { action: "auth.login_denied", target: link.emp_code, empCode: link.emp_code,
        newValue: { reason: "inactive" } });
      return res.redirect("/login?error=inactive");
    }

    if (link) {
      // ถาม LINE ตรง ๆ ว่ายังเป็นเพื่อนกับ OA อยู่ไหม เผื่อ webhook ส่งมาไม่ถึง (เช่นตอนรันบน localhost)
      const friend = await line.checkFriendship(lineUserId);
      await query(
        `UPDATE user_line_links
            SET last_login_at = now(),
                display_name = COALESCE($2, display_name),
                is_oa_friend = COALESCE($3, is_oa_friend)
          WHERE line_user_id = $1`,
        [lineUserId, displayName, friend]
      );
      await createSession(res, req, { empCode: link.emp_code, lineUserId });
      await audit(req, { action: "auth.login", target: link.emp_code, empCode: link.emp_code });
      return res.redirect("/");
    }

    // ยังไม่เคยผูก → สร้าง session ที่รอผูกรหัสพนักงาน
    await createSession(res, req, { lineUserId, pendingLink: true });
    res.redirect("/link");
  })
);

/* ================= เข้าสู่ระบบสำหรับพัฒนา (ไม่ผ่าน LINE) ================= */

router.post(
  "/auth/dev-login",
  wrap(async (req, res) => {
    if (!config.devLogin) throw forbidden("ปิดการเข้าสู่ระบบแบบพัฒนาไว้");
    const empCode = String(req.body?.emp_code ?? "").trim();
    const emp = await one(`SELECT emp_code, is_active FROM employees WHERE emp_code=$1`, [empCode]);
    if (!emp) throw badRequest("ไม่พบรหัสพนักงานนี้");
    if (!emp.is_active) throw forbidden("บัญชีนี้ถูกปิดใช้งาน");
    await createSession(res, req, { empCode: emp.emp_code });
    await audit(req, { action: "auth.dev_login", target: emp.emp_code, empCode: emp.emp_code });
    res.json({ ok: true });
  })
);

/* ================= ผูกรหัสพนักงาน ================= */

router.post(
  "/auth/link-employee",
  wrap(async (req, res) => {
    if (!req.session) throw unauthorized("ต้องเข้าสู่ระบบด้วย LINE ก่อน");
    if (!req.session.pendingLink) throw conflict("บัญชี LINE นี้ผูกรหัสพนักงานไว้แล้ว");

    const key = req.session.lineUserId || req.session.sid;
    const blocked = linkLimiter.check(key);
    if (blocked) throw tooMany(`พยายามผูกบัญชีบ่อยเกินไป ลองใหม่ในอีก ${Math.ceil(blocked / 60)} นาที`);

    const empCode = String(req.body?.emp_code ?? "").trim();
    if (!/^\d{7}$/.test(empCode)) throw badRequest("รหัสพนักงานต้องเป็นตัวเลข 7 หลัก");

    const emp = await one(
      `SELECT emp_code, full_name, is_active FROM employees WHERE emp_code=$1`,
      [empCode]
    );
    if (!emp || !emp.is_active) {
      linkLimiter.fail(key);
      throw badRequest("ไม่พบรหัสพนักงานนี้ หรือบัญชีถูกปิดใช้งาน");
    }

    const taken = await one(`SELECT line_user_id FROM user_line_links WHERE emp_code=$1`, [empCode]);
    if (taken) {
      linkLimiter.fail(key);
      await audit(req, {
        action: "auth.link_conflict",
        target: empCode,
        newValue: { line_user_id: req.session.lineUserId },
      });
      throw conflict("รหัสพนักงานนี้ถูกผูกกับบัญชี LINE อื่นแล้ว ติดต่อผู้ดูแลระบบเพื่อยกเลิกการผูก");
    }

    const friend = await line.checkFriendship(req.session.lineUserId);
    await query(
      `INSERT INTO user_line_links (line_user_id, emp_code, display_name, is_oa_friend, last_login_at)
       VALUES ($1,$2,$3,$4, now())`,
      [req.session.lineUserId, empCode, req.body?.display_name ?? null, friend ?? false]
    );
    await attachEmployee(req.session.sid, empCode);
    linkLimiter.reset(key);
    await audit(req, {
      action: "auth.link_employee",
      target: empCode,
      empCode,
      newValue: { line_user_id: req.session.lineUserId },
    });
    res.json({ ok: true, emp_code: empCode, full_name: emp.full_name });
  })
);

/* ================= ยืนยันรหัส Admin ================= */

router.post(
  "/auth/admin-code",
  requireAuth,
  wrap(async (req, res) => {
    const key = req.user.emp_code;
    const blocked = adminCodeLimiter.check(key);
    if (blocked) {
      throw tooMany(`ยืนยันรหัสผิดหลายครั้ง ลองใหม่ในอีก ${Math.ceil(blocked / 60)} นาที`);
    }

    // ธง is_admin จำกัดว่าใครใช้รหัสร่วมนี้ได้ ลดข้อเสียของรหัสที่ใช้ร่วมกัน (ข้อ 3.4)
    if (!req.user.is_admin && req.user.role !== "admin") {
      await audit(req, { action: "admin.login_denied", newValue: { reason: "not_allowed" } });
      throw forbidden("บัญชีนี้ไม่ได้รับอนุญาตให้เข้าโหมดผู้ดูแลระบบ");
    }

    const code = String(req.body?.code ?? "");
    const hashes = (await getSetting("admin.code_hashes")) || [];
    let ok = false;
    for (const h of hashes) {
      if (await verifySecret(code, h)) {
        ok = true;
        break;
      }
    }

    if (!ok) {
      adminCodeLimiter.fail(key);
      await audit(req, { action: "admin.login_failed" });
      throw unauthorized("รหัส Admin ไม่ถูกต้อง");
    }

    adminCodeLimiter.reset(key);
    const until = await elevateAdmin(req.session.sid);
    await audit(req, { action: "admin.login", newValue: { until } });
    res.json({ ok: true, adminUntil: until });
  })
);

router.post(
  "/auth/admin-code/change",
  requireAuth,
  wrap(async (req, res) => {
    if (!req.session.adminActive && req.user.role !== "admin") throw forbidden();
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 8) throw badRequest("รหัสใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร");

    const hashes = (await getSetting("admin.code_hashes")) || [];
    let matched = false;
    for (const h of hashes) {
      if (await verifySecret(current, h)) {
        matched = true;
        break;
      }
    }
    if (!matched) throw unauthorized("รหัส Admin เดิมไม่ถูกต้อง");

    await setSetting("admin.code_hashes", [await hashSecret(next)], req.user.emp_code);
    await audit(req, { action: "admin.code_change", target: "admin.code_hashes" });
    res.json({ ok: true });
  })
);

router.post(
  "/auth/admin-code/exit",
  requireAuth,
  wrap(async (req, res) => {
    await query(`UPDATE sessions SET admin_until=NULL WHERE sid=$1`, [req.session.sid]);
    await audit(req, { action: "admin.logout" });
    res.json({ ok: true });
  })
);

/* ================= ออกจากระบบ ================= */

router.post(
  "/auth/logout",
  wrap(async (req, res) => {
    if (req.session) {
      await audit(req, { action: "auth.logout" });
      await destroySession(res, req.session.sid);
    }
    res.json({ ok: true });
  })
);

/* ================= ตั้งค่าส่วนตัว ================= */

router.patch(
  "/api/me/notify",
  requireAuth,
  wrap(async (req, res) => {
    const enabled = Boolean(req.body?.notify_enabled);
    const result = await query(
      `UPDATE user_line_links SET notify_enabled=$2 WHERE emp_code=$1`,
      [req.user.emp_code, enabled]
    );
    const changed = result.rowCount ?? result.affectedRows ?? 0;
    if (!changed) throw badRequest("ยังไม่ได้ผูกบัญชี LINE จึงตั้งค่าการแจ้งเตือนไม่ได้");
    await audit(req, { action: "me.notify_toggle", newValue: { notify_enabled: enabled } });
    res.json({ ok: true, notify_enabled: enabled });
  })
);

/**
 * ตรวจสถานะการเป็นเพื่อนกับ OA ใหม่ตามคำสั่งผู้ใช้
 * ปกติสถานะมาจาก webhook follow/unfollow แต่ถ้า webhook ยังส่งมาไม่ถึง
 * (เช่นรันบน localhost) ผู้ใช้กดปุ่มนี้เพื่อให้ระบบถาม LINE ตรง ๆ ได้
 */
router.post(
  "/api/me/check-friend",
  requireAuth,
  wrap(async (req, res) => {
    if (!req.user.line_linked) throw badRequest("ยังไม่ได้ผูกบัญชี LINE");
    if (!line.lineMessagingEnabled) throw badRequest("ยังไม่ได้ตั้งค่า LINE Messaging API บนเซิร์ฟเวอร์นี้");

    const lineUserId = await one(`SELECT line_user_id FROM user_line_links WHERE emp_code=$1`, [
      req.user.emp_code,
    ]);
    const friend = await line.checkFriendship(lineUserId?.line_user_id);
    if (friend === null) throw badRequest("ถาม LINE ไม่สำเร็จ ลองใหม่อีกครั้ง");

    await query(`UPDATE user_line_links SET is_oa_friend=$2 WHERE emp_code=$1`, [
      req.user.emp_code,
      friend,
    ]);
    res.json({ ok: true, is_oa_friend: friend });
  })
);
