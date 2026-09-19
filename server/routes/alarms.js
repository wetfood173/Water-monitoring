import { Router } from "express";
import { many, one, query } from "../db/index.js";
import { wrap, badRequest, notFound, conflict } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";

export const router = Router();

const SELECT_ALARM = `
  SELECT a.id, a.tag, a.severity, a.condition, a.trigger_value, a.threshold,
         a.raised_at, a.cleared_at, a.acked_at, a.acked_by, a.ack_note, a.notify_count,
         s.name AS sensor_name, s.unit, s.decimals, s.pond_id,
         e.full_name AS acked_by_name
    FROM alarms a
    JOIN sensors s ON s.tag = a.tag
    LEFT JOIN employees e ON e.emp_code = a.acked_by
`;

router.get(
  "/api/alarms",
  requireRole("staff"),
  wrap(async (req, res) => {
    const status = String(req.query.status ?? "all");
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    const where = [];
    const params = [];

    if (status === "open") where.push("a.cleared_at IS NULL");
    else if (status === "unacked") where.push("a.cleared_at IS NULL AND a.acked_at IS NULL");
    else if (status === "cleared") where.push("a.cleared_at IS NOT NULL");

    if (req.query.severity) {
      params.push(String(req.query.severity));
      where.push(`a.severity = $${params.length}`);
    }
    if (req.query.tag) {
      params.push(String(req.query.tag));
      where.push(`a.tag = $${params.length}`);
    }
    if (req.query.from) {
      params.push(new Date(String(req.query.from)));
      where.push(`a.raised_at >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(new Date(String(req.query.to)));
      where.push(`a.raised_at <= $${params.length}`);
    }

    params.push(limit);
    const rows = await many(
      `${SELECT_ALARM} ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY a.raised_at DESC LIMIT $${params.length}`,
      params
    );

    const counts = await one(
      `SELECT count(*) FILTER (WHERE cleared_at IS NULL)::int AS open,
              count(*) FILTER (WHERE cleared_at IS NULL AND acked_at IS NULL)::int AS unacked
         FROM alarms`
    );
    res.json({ alarms: rows, counts });
  })
);

router.get(
  "/api/alarms/:id",
  requireRole("staff"),
  wrap(async (req, res) => {
    const row = await one(`${SELECT_ALARM} WHERE a.id = $1`, [Number(req.params.id)]);
    if (!row) throw notFound("ไม่พบการแจ้งเตือนนี้");
    const notifications = await many(
      `SELECT n.sent_at, n.kind, n.status, n.error_detail, n.emp_code, e.full_name
         FROM notification_log n LEFT JOIN employees e ON e.emp_code = n.emp_code
        WHERE n.alarm_id = $1 ORDER BY n.sent_at DESC`,
      [Number(req.params.id)]
    );
    res.json({ alarm: row, notifications });
  })
);

/* รับทราบการแจ้งเตือน — technician ขึ้นไป (ข้อ 4, 8) */
router.post(
  "/api/alarms/:id/ack",
  requireRole("technician"),
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("รหัสการแจ้งเตือนไม่ถูกต้อง");
    const note = req.body?.note ? String(req.body.note).slice(0, 1000) : null;

    const existing = await one(`SELECT id, acked_at, acked_by FROM alarms WHERE id=$1`, [id]);
    if (!existing) throw notFound("ไม่พบการแจ้งเตือนนี้");
    if (existing.acked_at) throw conflict("การแจ้งเตือนนี้มีผู้รับทราบไปแล้ว");

    await query(
      `UPDATE alarms SET acked_at = now(), acked_by = $2, ack_note = $3 WHERE id = $1`,
      [id, req.user.emp_code, note]
    );
    await audit(req, { action: "alarm.ack", target: `alarm:${id}`, newValue: { note } });

    const row = await one(`${SELECT_ALARM} WHERE a.id = $1`, [id]);
    res.json({ ok: true, alarm: row });
  })
);

router.post(
  "/api/alarms/ack-all",
  requireRole("technician"),
  wrap(async (req, res) => {
    const rows = await many(
      `UPDATE alarms SET acked_at = now(), acked_by = $1, ack_note = $2
        WHERE cleared_at IS NULL AND acked_at IS NULL
        RETURNING id`,
      [req.user.emp_code, req.body?.note ? String(req.body.note).slice(0, 1000) : null]
    );
    await audit(req, { action: "alarm.ack_all", newValue: { count: rows.length } });
    res.json({ ok: true, count: rows.length });
  })
);
