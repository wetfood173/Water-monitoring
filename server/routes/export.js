import { Router } from "express";
import { many, query } from "../db/index.js";
import { wrap, badRequest, forbidden } from "../lib/http.js";
import { requireRole, hasRole } from "../middleware/auth.js";
import { buildCsv, csvFilename, isoBangkok } from "../lib/csv.js";
import { audit } from "../lib/audit.js";
import { conditionText } from "../services/lineClient.js";

export const router = Router();

const MAX_DAYS = 90;

function parseRange(req) {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw badRequest("ช่วงวันที่ไม่ถูกต้อง");
  }
  if (from >= to) throw badRequest("เวลาเริ่มต้นต้องอยู่ก่อนเวลาสิ้นสุด");
  const days = (to - from) / 86_400_000;
  if (days > MAX_DAYS) {
    throw badRequest(
      `ช่วงเวลาสูงสุดต่อครั้งคือ ${MAX_DAYS} วัน กรุณาแบ่งช่วงหรือขอให้ประมวลผลเบื้องหลัง`
    );
  }
  return { from, to };
}

function send(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

/** ระดับสถานะของค่าหนึ่งค่าเทียบกับ setpoint ของจุดวัดนั้น */
function statusOf(value, s) {
  const n = Number(value);
  if (s.hh_critical != null && n >= Number(s.hh_critical)) return "HH_CRIT";
  if (s.ll_critical != null && n <= Number(s.ll_critical)) return "LL_CRIT";
  if (s.hh != null && n >= Number(s.hh)) return "HH";
  if (s.ll != null && n <= Number(s.ll)) return "LL";
  return "NORMAL";
}

router.get(
  "/api/export/log",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const rows = await many(
      `SELECT x.*, e.full_name FROM export_log x
         JOIN employees e ON e.emp_code = x.emp_code
        ORDER BY x.created_at DESC LIMIT 100`
    );
    res.json({ log: rows });
  })
);

/* Export ทั้งหมดจำกัดที่ engineer ขึ้นไป (ข้อ 6) */
router.get(
  "/api/export/:file",
  requireRole("engineer"),
  wrap(async (req, res) => {
    const dataset = String(req.params.file).replace(/\.csv$/i, "");
    const { from, to } = parseRange(req);
    let headers = [];
    let rows = [];
    let prefix = dataset;

    if (dataset === "readings") {
      prefix = "water_readings";
      const tagFilter = String(req.query.tag ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const sensors = await many(`SELECT * FROM sensors`);
      const byTag = new Map(sensors.map((s) => [s.tag, s]));

      const params = [from, to];
      let where = "r.ts BETWEEN $1 AND $2";
      if (tagFilter.length) {
        params.push(tagFilter);
        where += ` AND r.tag = ANY($${params.length})`;
      }
      const data = await many(
        `SELECT r.ts, r.tag, r.value, r.quality, s.pond_id, s.metric, s.unit
           FROM readings r JOIN sensors s ON s.tag = r.tag
          WHERE ${where} ORDER BY r.ts, r.tag`,
        params
      );
      headers = ["timestamp", "tag", "pond", "metric", "value", "unit", "quality", "status"];
      rows = data.map((r) => [
        isoBangkok(r.ts),
        r.tag,
        r.pond_id ?? "",
        r.metric,
        Number(r.value),
        r.unit,
        r.quality,
        statusOf(r.value, byTag.get(r.tag) ?? {}),
      ]);
    } else if (dataset === "alarms") {
      prefix = "water_alarms";
      const data = await many(
        `SELECT a.*, s.name AS sensor_name, s.unit, s.pond_id, e.full_name AS acked_by_name
           FROM alarms a
           JOIN sensors s ON s.tag = a.tag
           LEFT JOIN employees e ON e.emp_code = a.acked_by
          WHERE a.raised_at BETWEEN $1 AND $2
          ORDER BY a.raised_at`,
        [from, to]
      );
      headers = [
        "alarm_id", "raised_at", "cleared_at", "tag", "pond", "sensor_name", "severity",
        "condition", "condition_text", "trigger_value", "threshold", "unit",
        "acked_at", "acked_by", "acked_by_name", "ack_note", "notify_count",
      ];
      rows = data.map((a) => [
        a.id, isoBangkok(a.raised_at), isoBangkok(a.cleared_at), a.tag, a.pond_id ?? "",
        a.sensor_name, a.severity, a.condition, conditionText(a.condition),
        a.trigger_value == null ? "" : Number(a.trigger_value),
        a.threshold == null ? "" : Number(a.threshold),
        a.unit, isoBangkok(a.acked_at), a.acked_by ?? "", a.acked_by_name ?? "",
        a.ack_note ?? "", a.notify_count,
      ]);
    } else if (dataset === "daily") {
      prefix = "water_daily_summary";
      const data = await many(
        `WITH day_stats AS (
           SELECT date_trunc('day', r.ts AT TIME ZONE 'Asia/Bangkok') AS day, r.tag,
                  min(r.value) AS min_val, max(r.value) AS max_val, avg(r.value) AS avg_val,
                  count(*)::int AS n
             FROM readings r
            WHERE r.ts BETWEEN $1 AND $2 AND r.quality = 1
            GROUP BY 1, 2
         ),
         out_of_range AS (
           SELECT date_trunc('day', a.raised_at AT TIME ZONE 'Asia/Bangkok') AS day, a.tag,
                  count(*)::int AS alarm_count,
                  COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(a.cleared_at, now()) - a.raised_at))), 0) AS out_sec
             FROM alarms a
            WHERE a.raised_at BETWEEN $1 AND $2
            GROUP BY 1, 2
         )
         SELECT d.day, d.tag, s.name AS sensor_name, s.pond_id, s.unit,
                d.min_val, d.max_val, d.avg_val, d.n,
                COALESCE(o.alarm_count, 0) AS alarm_count, COALESCE(o.out_sec, 0) AS out_sec
           FROM day_stats d
           JOIN sensors s ON s.tag = d.tag
           LEFT JOIN out_of_range o ON o.day = d.day AND o.tag = d.tag
          ORDER BY d.day, d.tag`,
        [from, to]
      );
      headers = [
        "date", "tag", "pond", "sensor_name", "unit",
        "min", "max", "avg", "samples", "alarm_count", "out_of_range_minutes",
      ];
      rows = data.map((d) => [
        isoBangkok(d.day).slice(0, 10),
        d.tag, d.pond_id ?? "", d.sensor_name, d.unit,
        Number(d.min_val).toFixed(3), Number(d.max_val).toFixed(3), Number(d.avg_val).toFixed(3),
        d.n, d.alarm_count, (Number(d.out_sec) / 60).toFixed(1),
      ]);
    } else if (dataset === "employees") {
      // รายชื่อพนักงาน export ได้เฉพาะ admin (ข้อ 6)
      if (!hasRole(req.user, req.session, "admin")) {
        throw forbidden("เฉพาะผู้ดูแลระบบเท่านั้นที่ส่งออกรายชื่อพนักงานได้");
      }
      prefix = "employees";
      const data = await many(
        `SELECT e.*, l.line_user_id, l.display_name, l.is_oa_friend, l.notify_enabled,
                l.linked_at, l.last_login_at
           FROM employees e LEFT JOIN user_line_links l ON l.emp_code = e.emp_code
          ORDER BY e.emp_code`
      );
      headers = [
        "emp_code", "full_name", "position", "department", "role", "is_admin", "is_active",
        "line_linked", "line_display_name", "is_oa_friend", "notify_enabled",
        "linked_at", "last_login_at",
      ];
      rows = data.map((e) => [
        e.emp_code, e.full_name, e.position ?? "", e.department ?? "", e.role,
        e.is_admin, e.is_active, Boolean(e.line_user_id), e.display_name ?? "",
        e.is_oa_friend ?? "", e.notify_enabled ?? "",
        isoBangkok(e.linked_at), isoBangkok(e.last_login_at),
      ]);
    } else {
      throw badRequest("ชุดข้อมูลต้องเป็น readings, alarms, daily หรือ employees");
    }

    await query(
      `INSERT INTO export_log (emp_code, dataset, range_from, range_to, row_count)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.user.emp_code, dataset, from, to, rows.length]
    );
    await audit(req, {
      action: "export.download",
      target: dataset,
      newValue: { from, to, rows: rows.length },
    });

    send(res, csvFilename(prefix, from, to), buildCsv(headers, rows));
  })
);
