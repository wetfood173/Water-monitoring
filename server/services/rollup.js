import { query } from "../db/index.js";

/**
 * สรุปค่าลง readings_hourly เพื่อให้กราฟ 7 วัน / 30 วัน
 * ไม่ต้องอ่านข้อมูลดิบทั้งหมด (ข้อ 7 — การจัดการข้อมูล)
 * คำนวณย้อนหลัง N ชั่วโมงเสมอ เพื่อให้ชั่วโมงที่ยังไม่จบถูกอัปเดตตามข้อมูลใหม่
 */
export async function rollupHourly(hoursBack = 3) {
  await query(
    `INSERT INTO readings_hourly (bucket, tag, min_val, max_val, avg_val, n)
     SELECT date_trunc('hour', ts) AS bucket, tag,
            min(value), max(value), avg(value), count(*)::int
       FROM readings
      WHERE ts >= date_trunc('hour', now()) - ($1 || ' hours')::interval
        AND quality = 1
      GROUP BY 1, 2
     ON CONFLICT (tag, bucket) DO UPDATE SET
       min_val = EXCLUDED.min_val, max_val = EXCLUDED.max_val,
       avg_val = EXCLUDED.avg_val, n = EXCLUDED.n`,
    [String(hoursBack)]
  );
}
