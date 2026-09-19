import { Router } from "express";
import { many, one } from "../db/index.js";
import { wrap, badRequest, forbidden } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { activeSensors } from "../services/sensorCache.js";
import { ingest } from "../services/ingest.js";
import { config } from "../config.js";
import { getSetting } from "../lib/settings.js";

export const router = Router();

/* ================= ค่าล่าสุดทุกจุดวัด ================= */

router.get(
  "/api/readings/latest",
  requireRole("staff"),
  wrap(async (req, res) => {
    const sensors = await activeSensors();
    // ห้ามสแกนทั้งตาราง readings (หลักล้านแถว) — ใช้ LATERAL ดึงแถวล่าสุดทีละ tag ผ่านดัชนี (tag, ts) แทน
    const rows = await many(
      `SELECT s.tag, r.ts, r.value, r.quality
         FROM sensors s
         LEFT JOIN LATERAL (
           SELECT ts, value, quality FROM readings WHERE tag = s.tag ORDER BY ts DESC LIMIT 1
         ) r ON true
        WHERE s.is_active`
    );
    const byTag = new Map(rows.filter((r) => r.ts).map((r) => [r.tag, r]));
    const noSignalSec = (await getSetting("alarm.no_signal_sec")) ?? 300;
    const now = Date.now();

    const readings = sensors.map((s) => {
      const r = byTag.get(s.tag);
      const ts = r ? new Date(r.ts) : null;
      const stale = !ts || now - ts.getTime() > noSignalSec * 1000;
      return {
        tag: s.tag,
        pond_id: s.pond_id,
        name: s.name,
        metric: s.metric,
        unit: s.unit,
        decimals: s.decimals,
        range_min: s.range_min,
        range_max: s.range_max,
        ll: s.ll,
        hh: s.hh,
        ll_critical: s.ll_critical,
        hh_critical: s.hh_critical,
        value: r ? Number(r.value) : null,
        quality: r?.quality ?? null,
        ts: ts ? ts.toISOString() : null,
        stale,
      };
    });

    const ponds = await many(
      `SELECT pond_id, name, capacity_m3, sort_order, role_note, src_note, dst_note
         FROM ponds WHERE is_active ORDER BY sort_order`
    );

    // ปริมาณน้ำรวม = ความจุ × ระดับน้ำ ของทุกบ่อ
    const levelByPond = new Map(
      readings.filter((r) => r.metric === "level" && r.value != null).map((r) => [r.pond_id, r.value])
    );
    const totalVolume = ponds.reduce((sum, p) => {
      const lvl = levelByPond.get(p.pond_id);
      return lvl == null ? sum : sum + (Number(p.capacity_m3) * lvl) / 100;
    }, 0);

    const alarm = await one(
      `SELECT count(*) FILTER (WHERE acked_at IS NULL)::int AS unacked, count(*)::int AS open
         FROM alarms WHERE cleared_at IS NULL`
    );

    // ปริมาณสะสมรายวันของ FT-600Q = อัตราไหลเฉลี่ยวันนี้ × จำนวนชั่วโมงที่ผ่านไป
    // คิดจากค่าเฉลี่ยเพื่อให้ผลไม่ผูกกับความถี่ในการส่งค่าของ gateway
    const totalizer = await one(
      `SELECT COALESCE(avg(value), 0)
              * EXTRACT(EPOCH FROM (now() - date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok')
                                    AT TIME ZONE 'Asia/Bangkok')) / 3600.0 AS total
         FROM readings
        WHERE tag = 'FT-600Q' AND quality = 1
          AND ts >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`
    );

    res.json({
      ts: new Date().toISOString(),
      ponds,
      readings,
      totalVolume,
      totalizer: Number(totalizer?.total ?? 0),
      alarms: { unacked: alarm?.unacked ?? 0, open: alarm?.open ?? 0 },
      connected: readings.some((r) => !r.stale),
    });
  })
);

/* ================= ประวัติย้อนหลัง ================= */

const RANGES = {
  "1h": { minutes: 60, source: "raw", bucketMinutes: 1 },
  "24h": { minutes: 1440, source: "raw", bucketMinutes: 15 },
  "7d": { minutes: 10080, source: "hourly", bucketMinutes: 120 },
  "30d": { minutes: 43200, source: "hourly", bucketMinutes: 480 },
};

router.get(
  "/api/readings/history",
  requireRole("staff"),
  wrap(async (req, res) => {
    const tags = String(req.query.tag ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tags.length) throw badRequest("ต้องระบุ tag อย่างน้อยหนึ่งจุดวัด");

    const known = new Set((await activeSensors()).map((s) => s.tag));
    for (const t of tags) if (!known.has(t)) throw badRequest(`ไม่รู้จักจุดวัด ${t}`);

    let from;
    let to = new Date();
    let bucketMinutes;
    let source;

    if (req.query.from) {
      from = new Date(String(req.query.from));
      if (req.query.to) to = new Date(String(req.query.to));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw badRequest("ช่วงวันที่ไม่ถูกต้อง");
      }
      if (from >= to) throw badRequest("เวลาเริ่มต้นต้องอยู่ก่อนเวลาสิ้นสุด");

      // ข้อมูลดิบเก็บย้อนหลังได้ไม่เกิน retention.raw_days — ดึงก่อนหน้านั้นจะไม่มีข้อมูลเสมอ ตัดขอบเขตให้แทนที่จะคืนค่าว่างเงียบ ๆ
      const retentionDays = await getSetting("retention.raw_days");
      if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 86400000);
        if (from < cutoff) from = cutoff;
        if (from >= to) throw badRequest(`ข้อมูลดิบเก็บย้อนหลังได้ไม่เกิน ${retentionDays} วัน`);
      }
      const spanMinutes = (to - from) / 60000;
      source = spanMinutes > 48 * 60 ? "hourly" : "raw";
      bucketMinutes = Math.max(1, Math.round(spanMinutes / 120));
    } else {
      const range = RANGES[String(req.query.range ?? "1h")];
      if (!range) throw badRequest("ช่วงเวลาต้องเป็น 1h, 24h, 7d หรือ 30d");
      from = new Date(to.getTime() - range.minutes * 60_000);
      bucketMinutes = range.bucketMinutes;
      source = range.source;
    }

    const series = {};
    for (const tag of tags) {
      const rows =
        source === "hourly"
          ? await many(
              `SELECT bucket AS ts, avg_val AS value, min_val, max_val
                 FROM readings_hourly
                WHERE tag=$1 AND bucket BETWEEN $2 AND $3
                ORDER BY bucket`,
              [tag, from, to]
            )
          : await many(
              `SELECT to_timestamp(floor(extract(epoch FROM ts) / ($4::numeric * 60)) * ($4::numeric * 60)) AS ts,
                      avg(value) AS value, min(value) AS min_val, max(value) AS max_val
                 FROM readings
                WHERE tag=$1 AND ts BETWEEN $2 AND $3 AND quality = 1
                GROUP BY 1 ORDER BY 1`,
              [tag, from, to, bucketMinutes]
            );
      series[tag] = rows.map((r) => ({
        ts: new Date(r.ts).toISOString(),
        value: r.value == null ? null : Number(r.value),
        min: r.min_val == null ? null : Number(r.min_val),
        max: r.max_val == null ? null : Number(r.max_val),
      }));
    }

    res.json({ from: from.toISOString(), to: to.toISOString(), source, bucketMinutes, series });
  })
);

/* ================= รับค่าจาก PLC gateway ================= */

router.post(
  "/api/ingest",
  wrap(async (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-ingest-token"];
    if (!config.ingestToken || token !== config.ingestToken) {
      throw forbidden("service token ไม่ถูกต้อง");
    }
    const result = await ingest(req.body);
    res.json(result);
  })
);
